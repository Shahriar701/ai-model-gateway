import { APIGatewayProxyEvent } from 'aws-lambda';
import { SecurityMiddleware } from '../../../src/shared/middleware/security-middleware';
import { SecurityEventType } from '../../../src/shared/types/security-types';

describe('SecurityMiddleware', () => {
  const mockCorrelationId = 'test-correlation-id';

  const createMockEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
    httpMethod: 'POST',
    path: '/api/v1/test',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': '100',
    },
    body: '{"test": "data"}',
    queryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: mockCorrelationId,
      stage: 'test',
      resourceId: 'test',
      resourcePath: '/test',
      httpMethod: 'POST',
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

  describe('applySecurityMiddleware', () => {
    it('should successfully process valid request', async () => {
      const event = createMockEvent();
      const result = await SecurityMiddleware.applySecurityMiddleware(event, mockCorrelationId);

      expect(result.success).toBe(true);
      expect(result.sanitizedEvent).toBeDefined();
      expect(result.sanitizedEvent?.body).toBe('{"test": "data"}');
    });

    it('should reject request with oversized content', async () => {
      const event = createMockEvent({
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '20971520', // 20MB
        },
      });

      const result = await SecurityMiddleware.applySecurityMiddleware(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request payload too large');
    });

    it('should reject request with dangerous script patterns', async () => {
      const event = createMockEvent({
        body: '{"test": "<script>alert(\\"xss\\")</script>"}',
      });

      const result = await SecurityMiddleware.applySecurityMiddleware(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input content detected');
    });

    it('should reject request with SQL injection patterns', async () => {
      const event = createMockEvent({
        body: '{"test": "SELECT * FROM users WHERE id = 1; DROP TABLE users;"}',
      });

      const result = await SecurityMiddleware.applySecurityMiddleware(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid input content detected');
    });

    it('should sanitize query parameters with dangerous content', async () => {
      const event = createMockEvent({
        queryStringParameters: {
          safe: 'normal-value',
          dangerous: '<script>alert("xss")</script>',
        },
      });

      const result = await SecurityMiddleware.applySecurityMiddleware(event, mockCorrelationId);

      expect(result.success).toBe(true);
      expect(result.sanitizedEvent?.queryStringParameters?.safe).toBe('normal-value');
      expect(result.sanitizedEvent?.queryStringParameters?.dangerous).toBeUndefined();
    });

    it('should reject request with oversized headers', async () => {
      const largeHeaderValue = 'x'.repeat(10000);
      const event = createMockEvent({
        headers: {
          'Content-Type': 'application/json',
          'X-Large-Header': largeHeaderValue,
        },
      });

      const result = await SecurityMiddleware.applySecurityMiddleware(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request header too large');
    });
  });

  describe('addSecurityHeaders', () => {
    it('should add all required security headers', () => {
      const response = {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: '{"success": true}',
      };

      const result = SecurityMiddleware.addSecurityHeaders(response, mockCorrelationId);

      expect(result.headers).toMatchObject({
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Content-Security-Policy': "default-src 'none'; script-src 'none'; object-src 'none';",
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Correlation-ID': mockCorrelationId,
      });
    });

    it('should preserve existing headers', () => {
      const response = {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
        },
        body: '{"success": true}',
      };

      const result = SecurityMiddleware.addSecurityHeaders(response, mockCorrelationId);

      expect(result.headers?.['Content-Type']).toBe('application/json');
      expect(result.headers?.['X-Custom-Header']).toBe('custom-value');
      expect(result.headers?.['X-Content-Type-Options']).toBe('nosniff');
    });
  });

  describe('shouldLogSecurityEvent', () => {
    beforeEach(() => {
      // Clear any existing state
      (SecurityMiddleware as any).securityEventCounts.clear();
    });

    it('should allow logging within rate limit', () => {
      const eventType = SecurityEventType.DANGEROUS_PATTERN_DETECTED;
      
      for (let i = 0; i < 10; i++) {
        const shouldLog = SecurityMiddleware.shouldLogSecurityEvent(eventType, mockCorrelationId);
        expect(shouldLog).toBe(true);
      }
    });

    it('should prevent logging when rate limit exceeded', () => {
      const eventType = SecurityEventType.DANGEROUS_PATTERN_DETECTED;
      
      // Exceed the rate limit
      for (let i = 0; i < 11; i++) {
        SecurityMiddleware.shouldLogSecurityEvent(eventType, mockCorrelationId);
      }
      
      const shouldLog = SecurityMiddleware.shouldLogSecurityEvent(eventType, mockCorrelationId);
      expect(shouldLog).toBe(false);
    });
  });
});