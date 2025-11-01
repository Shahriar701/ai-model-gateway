import { APIGatewayProxyEvent } from 'aws-lambda';
import { CorsMiddleware } from '../../../src/shared/middleware/cors-middleware';

describe('CorsMiddleware', () => {
  const mockCorrelationId = 'test-correlation-id';

  const createMockEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
    httpMethod: 'OPTIONS',
    path: '/api/v1/test',
    headers: {},
    body: null,
    queryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: mockCorrelationId,
      stage: 'test',
      resourceId: 'test',
      resourcePath: '/test',
      httpMethod: 'OPTIONS',
      requestTime: '2023-01-01T00:00:00Z',
      requestTimeEpoch: 1672531200000,
      path: '/test',
      accountId: '123456789012',
      protocol: 'HTTP/1.1',
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent',
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        user: null,
        userArn: null,
        clientCert: null,
        vpcId: null,
        vpceId: null,
      },
      apiId: 'test-api',
      domainName: 'test.example.com',
      domainPrefix: 'test',
      authorizer: {},
    },
    resource: '/test',
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    ...overrides,
  });

  describe('handlePreflightRequest', () => {
    it('should handle valid preflight request from allowed origin', () => {
      const event = createMockEvent({
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });

      const result = CorsMiddleware.handlePreflightRequest(event, mockCorrelationId);

      expect(result.statusCode).toBe(204);
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('https://app.example.com');
      expect(result.headers?.['Access-Control-Allow-Methods']).toContain('POST');
      expect(result.headers?.['Access-Control-Allow-Headers']).toContain('Content-Type');
      expect(result.headers?.['Access-Control-Allow-Headers']).toContain('Authorization');
    });

    it('should handle preflight request without origin header', () => {
      const event = createMockEvent({
        headers: {
          'Access-Control-Request-Method': 'GET',
        },
      });

      const result = CorsMiddleware.handlePreflightRequest(event, mockCorrelationId);

      expect(result.statusCode).toBe(204);
      expect(result.headers?.['Access-Control-Allow-Origin']).toBeUndefined();
      expect(result.headers?.['Access-Control-Allow-Credentials']).toBe('true');
    });

    it('should reject preflight request with disallowed method', () => {
      const event = createMockEvent({
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'TRACE',
        },
      });

      const result = CorsMiddleware.handlePreflightRequest(event, mockCorrelationId);

      expect(result.statusCode).toBe(405);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Method not allowed',
        allowedMethods: expect.arrayContaining(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']),
      });
    });

    it('should reject preflight request with disallowed headers', () => {
      const event = createMockEvent({
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, X-Dangerous-Header',
        },
      });

      const result = CorsMiddleware.handlePreflightRequest(event, mockCorrelationId);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({
        error: 'Headers not allowed',
        invalidHeaders: ['X-Dangerous-Header'],
      });
    });

    it('should allow all requested headers if they are in allowed list', () => {
      const event = createMockEvent({
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization, X-API-Key',
        },
      });

      const result = CorsMiddleware.handlePreflightRequest(event, mockCorrelationId);

      expect(result.statusCode).toBe(204);
      expect(result.headers?.['Access-Control-Allow-Headers']).toContain('Content-Type');
      expect(result.headers?.['Access-Control-Allow-Headers']).toContain('Authorization');
      expect(result.headers?.['Access-Control-Allow-Headers']).toContain('X-API-Key');
    });
  });

  describe('addCorsHeaders', () => {
    it('should add CORS headers to response for allowed origin', () => {
      const response = {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"success": true}',
      };

      const event = createMockEvent({
        headers: {
          'Origin': 'https://app.example.com',
        },
      });

      const result = CorsMiddleware.addCorsHeaders(response, event, mockCorrelationId);

      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('https://app.example.com');
      expect(result.headers?.['Access-Control-Allow-Credentials']).toBe('true');
      expect(result.headers?.['Access-Control-Expose-Headers']).toContain('X-Correlation-ID');
      expect(result.headers?.['Vary']).toBe('Origin');
    });

    it('should not set Allow-Origin header for disallowed origin', () => {
      const response = {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"success": true}',
      };

      const event = createMockEvent({
        headers: {
          'Origin': 'https://malicious.com',
        },
      });

      const result = CorsMiddleware.addCorsHeaders(response, event, mockCorrelationId);

      expect(result.headers?.['Access-Control-Allow-Origin']).toBeUndefined();
      expect(result.headers?.['Access-Control-Allow-Credentials']).toBe('true');
      expect(result.headers?.['Vary']).toBe('Origin');
    });

    it('should handle request without origin header', () => {
      const response = {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"success": true}',
      };

      const event = createMockEvent({
        headers: {},
      });

      const result = CorsMiddleware.addCorsHeaders(response, event, mockCorrelationId);

      expect(result.headers?.['Access-Control-Allow-Origin']).toBeUndefined();
      expect(result.headers?.['Access-Control-Allow-Credentials']).toBe('true');
      expect(result.headers?.['Vary']).toBe('Origin');
    });

    it('should preserve existing response headers', () => {
      const response = {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
        },
        body: '{"success": true}',
      };

      const event = createMockEvent({
        headers: {
          'Origin': 'https://app.example.com',
        },
      });

      const result = CorsMiddleware.addCorsHeaders(response, event, mockCorrelationId);

      expect(result.headers?.['Content-Type']).toBe('application/json');
      expect(result.headers?.['X-Custom-Header']).toBe('custom-value');
      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    });
  });

  describe('validateCorsConfiguration', () => {
    it('should validate default CORS configuration', () => {
      const result = CorsMiddleware.validateCorsConfiguration();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('getCorsConfiguration', () => {
    it('should return current CORS configuration', () => {
      const config = CorsMiddleware.getCorsConfiguration();

      expect(config).toMatchObject({
        allowedOrigins: expect.arrayContaining(['https://app.example.com']),
        allowedMethods: expect.arrayContaining(['GET', 'POST', 'PUT', 'DELETE']),
        allowedHeaders: expect.arrayContaining(['Content-Type', 'Authorization']),
        exposedHeaders: expect.arrayContaining(['X-Correlation-ID']),
        maxAge: expect.any(Number),
      });
    });
  });

  describe('development environment origin handling', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should allow localhost origins in development', () => {
      process.env.NODE_ENV = 'development';

      const response = {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"success": true}',
      };

      const event = createMockEvent({
        headers: { 'Origin': 'http://localhost:3000' },
      });

      const result = CorsMiddleware.addCorsHeaders(response, event, mockCorrelationId);

      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    });

    it('should allow local IP addresses in development', () => {
      process.env.NODE_ENV = 'development';

      const response = {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"success": true}',
      };

      const event = createMockEvent({
        headers: { 'Origin': 'http://192.168.1.100:3000' },
      });

      const result = CorsMiddleware.addCorsHeaders(response, event, mockCorrelationId);

      expect(result.headers?.['Access-Control-Allow-Origin']).toBe('http://192.168.1.100:3000');
    });
  });
});