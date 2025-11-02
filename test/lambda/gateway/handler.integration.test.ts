import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../../../src/lambda/gateway/handler';

// Mock all external dependencies
jest.mock('../../../src/services/auth/api-key-service');
jest.mock('../../../src/services/auth/rate-limiter');
jest.mock('../../../src/services/router/provider-router');
jest.mock('../../../src/services/cache/batched-gateway-service');
jest.mock('../../../src/services/mcp/mcp-context-service');
jest.mock('../../../src/services/monitoring/metrics-service');
jest.mock('../../../src/services/monitoring/health-service');
jest.mock('../../../src/services/monitoring/tracing-service');
jest.mock('../../../src/services/monitoring/correlation-service');
jest.mock('../../../src/services/config/admin-api');

describe('Gateway Handler Integration Tests', () => {
  let mockEvent: APIGatewayProxyEvent;

  beforeEach(() => {
    // Create a base mock event
    mockEvent = {
      httpMethod: 'GET',
      path: '/api/v1/health',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'test-agent',
      },
      queryStringParameters: null,
      pathParameters: null,
      body: null,
      isBase64Encoded: false,
      requestContext: {
        requestId: 'test-request-id',
        stage: 'test',
        httpMethod: 'GET',
        path: '/api/v1/health',
        protocol: 'HTTP/1.1',
        requestTime: '01/Jan/2023:00:00:00 +0000',
        requestTimeEpoch: 1672531200000,
        identity: {
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        },
        accountId: '123456789012',
        apiId: 'test-api-id',
        resourceId: 'test-resource-id',
        resourcePath: '/api/v1/health',
      } as any,
      resource: '/api/v1/health',
      stageVariables: null,
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
    };

    // Mock correlation service
    const mockCorrelationService = {
      extractCorrelationFromHeaders: jest.fn().mockReturnValue('test-correlation-id'),
      createContext: jest.fn().mockReturnValue({
        correlationId: 'test-correlation-id',
        userId: undefined,
        sessionId: undefined,
        requestId: 'test-request-id',
        timestamp: '2023-01-01T00:00:00.000Z',
        traceId: null,
        segmentId: null,
        breadcrumbs: [],
      }),
      createContextualLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        addTraceAnnotation: jest.fn(),
        addTraceMetadata: jest.fn(),
        performance: jest.fn(),
      }),
      addBreadcrumb: jest.fn(),
      updateContext: jest.fn(),
      getCorrelationHeaders: jest.fn().mockReturnValue({}),
      cleanup: jest.fn(),
    };

    const CorrelationService = require('../../../src/services/monitoring/correlation-service').CorrelationService;
    CorrelationService.getInstance = jest.fn().mockReturnValue(mockCorrelationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Health Check Endpoints', () => {
    it('should handle basic health check', async () => {
      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');
      expect(result.headers).toHaveProperty('X-Correlation-ID');

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('version');
      expect(body).toHaveProperty('correlationId');
    });

    it('should handle detailed health check', async () => {
      mockEvent.path = '/api/v1/health/detailed';

      // Mock health service
      const mockHealthService = {
        initialize: jest.fn(),
        getDetailedHealthReport: jest.fn().mockResolvedValue({
          system: {
            status: 'healthy',
            providers: [],
            cache: { connected: true, hitRate: 0.95 },
            database: { connected: true, latency: 50 },
            timestamp: '2023-01-01T00:00:00.000Z',
          },
          environment: {
            nodeVersion: 'v18.0.0',
            platform: 'linux',
            uptime: 3600,
          },
          configuration: {},
          dependencies: {},
        }),
      };

      const HealthService = require('../../../src/services/monitoring/health-service').HealthService;
      HealthService.getInstance = jest.fn().mockReturnValue(mockHealthService);

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('system');
      expect(body).toHaveProperty('environment');
    });
  });
});  desc
ribe('Authentication Flow', () => {
    it('should require API key for protected endpoints', async () => {
      mockEvent.path = '/api/v1/completions';
      mockEvent.httpMethod = 'POST';
      mockEvent.body = JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      // Mock API key service to return invalid
      const mockApiKeyService = {
        validateApiKey: jest.fn().mockResolvedValue({
          valid: false,
          error: 'Invalid API key',
        }),
      };

      const ApiKeyService = require('../../../src/services/auth/api-key-service').ApiKeyService;
      ApiKeyService.mockImplementation(() => mockApiKeyService);

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toHaveProperty('message');
    });

    it('should process request with valid API key', async () => {
      mockEvent.path = '/api/v1/completions';
      mockEvent.httpMethod = 'POST';
      mockEvent.headers['X-API-Key'] = 'valid-api-key';
      mockEvent.body = JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      // Mock successful authentication
      const mockApiKeyService = {
        validateApiKey: jest.fn().mockResolvedValue({
          valid: true,
          userId: 'test-user',
          tier: 'premium',
          keyId: 'test-key-id',
        }),
      };

      // Mock rate limiter
      const mockRateLimiter = {
        checkRateLimit: jest.fn().mockResolvedValue({
          allowed: true,
          remaining: { requestsPerMinute: 100 },
          resetTime: { minute: Date.now() + 60000 },
        }),
        recordRequest: jest.fn().mockResolvedValue(undefined),
      };

      // Mock batched gateway service
      const mockBatchedGateway = {
        processRequest: jest.fn().mockResolvedValue({
          id: 'test-response',
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello! How can I help you?' },
              finishReason: 'stop',
            },
          ],
          usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
          cost: { total: 0.001, promptCost: 0.0003, completionCost: 0.0007, currency: 'USD' },
          latency: 1500,
          provider: 'openai',
          cached: false,
        }),
      };

      // Mock MCP context service
      const mockMcpContextService = {
        initialize: jest.fn().mockResolvedValue(undefined),
        injectMCPContext: jest.fn().mockImplementation((req) => Promise.resolve(req)),
      };

      // Mock metrics service
      const mockMetricsService = {
        recordRequestMetrics: jest.fn().mockResolvedValue(undefined),
        recordAuthMetrics: jest.fn().mockResolvedValue(undefined),
        recordRateLimitMetrics: jest.fn().mockResolvedValue(undefined),
      };

      // Apply mocks
      const ApiKeyService = require('../../../src/services/auth/api-key-service').ApiKeyService;
      ApiKeyService.mockImplementation(() => mockApiKeyService);

      const RateLimiter = require('../../../src/services/auth/rate-limiter').RateLimiter;
      RateLimiter.mockImplementation(() => mockRateLimiter);

      const BatchedGatewayService = require('../../../src/services/cache/batched-gateway-service').BatchedGatewayService;
      BatchedGatewayService.mockImplementation(() => mockBatchedGateway);

      const MCPContextService = require('../../../src/services/mcp/mcp-context-service').MCPContextService;
      MCPContextService.mockImplementation(() => mockMcpContextService);

      const MetricsService = require('../../../src/services/monitoring/metrics-service').MetricsService;
      MetricsService.getInstance = jest.fn().mockReturnValue(mockMetricsService);

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('choices');
      expect(body).toHaveProperty('usage');
    });
  });

  describe('CORS Handling', () => {
    it('should handle OPTIONS preflight requests', async () => {
      mockEvent.httpMethod = 'OPTIONS';
      mockEvent.path = '/api/v1/completions';

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Methods');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Headers');
    });
  });

  describe('Error Handling', () => {
    it('should handle validation errors gracefully', async () => {
      mockEvent.path = '/api/v1/completions';
      mockEvent.httpMethod = 'POST';
      mockEvent.body = JSON.stringify({
        // Missing required fields
        messages: [],
      });

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toHaveProperty('message');
    });

    it('should handle internal server errors', async () => {
      mockEvent.path = '/api/v1/completions';
      mockEvent.httpMethod = 'POST';
      mockEvent.headers['X-API-Key'] = 'valid-api-key';
      mockEvent.body = JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      // Mock API key service to throw error
      const mockApiKeyService = {
        validateApiKey: jest.fn().mockRejectedValue(new Error('Database connection failed')),
      };

      const ApiKeyService = require('../../../src/services/auth/api-key-service').ApiKeyService;
      ApiKeyService.mockImplementation(() => mockApiKeyService);

      const result = await handler(mockEvent);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toHaveProperty('message');
    });
  });

  describe('Admin API Integration', () => {
    it('should route admin requests to AdminApi', async () => {
      mockEvent.path = '/api/v1/admin/config';
      mockEvent.httpMethod = 'GET';
      mockEvent.headers['X-Admin-API-Key'] = 'admin-key';

      // Mock AdminApi
      const mockAdminApi = {
        handleRequest: jest.fn().mockResolvedValue({
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, data: {} }),
        }),
      };

      const AdminApi = require('../../../src/services/config/admin-api').AdminApi;
      AdminApi.getInstance = jest.fn().mockReturnValue(mockAdminApi);

      const result = await handler(mockEvent);

      expect(mockAdminApi.handleRequest).toHaveBeenCalledWith(mockEvent);
      expect(result.statusCode).toBe(200);
    });
  });

  describe('Correlation ID Tracking', () => {
    it('should maintain correlation ID throughout request', async () => {
      mockEvent.headers['X-Correlation-ID'] = 'custom-correlation-id';

      const result = await handler(mockEvent);

      expect(result.headers).toHaveProperty('X-Correlation-ID');
      // Should use the provided correlation ID or generate a new one
      expect(typeof result.headers['X-Correlation-ID']).toBe('string');
    });
  });
});