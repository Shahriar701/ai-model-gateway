import { APIGatewayProxyEvent } from 'aws-lambda';
import { ValidationMiddleware } from '../../../src/shared/middleware/validation-middleware';

describe('ValidationMiddleware', () => {
  const mockCorrelationId = 'test-correlation-id';

  const createMockEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent => ({
    httpMethod: 'POST',
    path: '/api/v1/test',
    headers: {
      'Content-Type': 'application/json',
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

  describe('validateApiGatewayEvent', () => {
    it('should validate valid API Gateway event', () => {
      const event = createMockEvent();
      const result = ValidationMiddleware.validateApiGatewayEvent(event, mockCorrelationId);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject event without HTTP method', () => {
      const event = createMockEvent({ httpMethod: '' });
      const result = ValidationMiddleware.validateApiGatewayEvent(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('HTTP method is required');
    });

    it('should reject event without path', () => {
      const event = createMockEvent({ path: '' });
      const result = ValidationMiddleware.validateApiGatewayEvent(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request path is required');
    });

    it('should reject invalid HTTP method', () => {
      const event = createMockEvent({ httpMethod: 'INVALID' });
      const result = ValidationMiddleware.validateApiGatewayEvent(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid HTTP method');
    });

    it('should reject path without leading slash', () => {
      const event = createMockEvent({ path: 'api/v1/test' });
      const result = ValidationMiddleware.validateApiGatewayEvent(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid path format');
    });

    it('should reject overly long path', () => {
      const longPath = '/' + 'x'.repeat(2048);
      const event = createMockEvent({ path: longPath });
      const result = ValidationMiddleware.validateApiGatewayEvent(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request path too long');
    });
  });

  describe('validateRequestBody', () => {
    it('should validate valid JSON body', () => {
      const event = createMockEvent({
        body: '{"test": "data", "number": 123}',
        headers: { 'Content-Type': 'application/json' },
      });

      const result = ValidationMiddleware.validateRequestBody(event, mockCorrelationId);

      expect(result.success).toBe(true);
      expect(result.parsedBody).toEqual({ test: 'data', number: 123 });
    });

    it('should skip validation for GET requests', () => {
      const event = createMockEvent({
        httpMethod: 'GET',
        body: null,
      });

      const result = ValidationMiddleware.validateRequestBody(event, mockCorrelationId);

      expect(result.success).toBe(true);
      expect(result.parsedBody).toBeUndefined();
    });

    it('should reject missing body for POST to completions endpoint', () => {
      const event = createMockEvent({
        path: '/api/v1/completions',
        httpMethod: 'POST',
        body: null,
      });

      const result = ValidationMiddleware.validateRequestBody(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request body is required');
    });

    it('should reject non-JSON content type', () => {
      const event = createMockEvent({
        headers: { 'Content-Type': 'text/plain' },
        body: 'plain text',
      });

      const result = ValidationMiddleware.validateRequestBody(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Content-Type must be application/json');
    });

    it('should reject invalid JSON', () => {
      const event = createMockEvent({
        headers: { 'Content-Type': 'application/json' },
        body: '{"invalid": json}',
      });

      const result = ValidationMiddleware.validateRequestBody(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid JSON format');
    });

    it('should reject overly complex objects', () => {
      // Create a deeply nested object
      const createNestedObject = (depth: number): any => {
        if (depth === 0) return 'value';
        return { nested: createNestedObject(depth - 1) };
      };

      const complexObject = createNestedObject(15);
      const event = createMockEvent({
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(complexObject),
      });

      const result = ValidationMiddleware.validateRequestBody(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request body too complex');
    });
  });

  describe('validateQueryParameters', () => {
    it('should validate normal query parameters', () => {
      const event = createMockEvent({
        queryStringParameters: {
          page: '1',
          limit: '10',
          filter: 'active',
        },
      });

      const result = ValidationMiddleware.validateQueryParameters(event, mockCorrelationId);

      expect(result.success).toBe(true);
    });

    it('should handle null query parameters', () => {
      const event = createMockEvent({
        queryStringParameters: null,
      });

      const result = ValidationMiddleware.validateQueryParameters(event, mockCorrelationId);

      expect(result.success).toBe(true);
    });

    it('should reject too many query parameters', () => {
      const manyParams: Record<string, string> = {};
      for (let i = 0; i < 51; i++) {
        manyParams[`param${i}`] = `value${i}`;
      }

      const event = createMockEvent({
        queryStringParameters: manyParams,
      });

      const result = ValidationMiddleware.validateQueryParameters(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Too many query parameters');
    });

    it('should reject parameter names that are too long', () => {
      const longParamName = 'x'.repeat(101);
      const event = createMockEvent({
        queryStringParameters: {
          [longParamName]: 'value',
        },
      });

      const result = ValidationMiddleware.validateQueryParameters(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Query parameter name too long');
    });

    it('should reject parameter values that are too long', () => {
      const longParamValue = 'x'.repeat(1001);
      const event = createMockEvent({
        queryStringParameters: {
          param: longParamValue,
        },
      });

      const result = ValidationMiddleware.validateQueryParameters(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Query parameter value too long');
    });

    it('should reject invalid parameter names', () => {
      const event = createMockEvent({
        queryStringParameters: {
          'invalid@param': 'value',
        },
      });

      const result = ValidationMiddleware.validateQueryParameters(event, mockCorrelationId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid query parameter name');
    });

    it('should allow valid parameter names with allowed characters', () => {
      const event = createMockEvent({
        queryStringParameters: {
          'valid_param-name.test': 'value',
          'param123': 'value2',
        },
      });

      const result = ValidationMiddleware.validateQueryParameters(event, mockCorrelationId);

      expect(result.success).toBe(true);
    });
  });
});