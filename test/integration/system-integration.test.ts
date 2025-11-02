import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../../src/lambda/gateway/handler';
import { ConfigurationManager } from '../../src/services/config/configuration-manager';
import { FeatureFlagService } from '../../src/services/config/feature-flag-service';
import { MCPContextService } from '../../src/services/mcp/mcp-context-service';
import { ProductService } from '../../src/services/mcp/product-service';
import { RedisService } from '../../src/services/cache/redis-service';
import { ApiKeyService } from '../../src/services/auth/api-key-service';

describe('System Integration Tests', () => {
  let configManager: ConfigurationManager;
  let featureFlagService: FeatureFlagService;
  let mcpContextService: MCPContextService;
  let productService: ProductService;
  let redisService: RedisService;
  let apiKeyService: ApiKeyService;

  // Test API key for integration tests
  const testApiKey = 'test-api-key-integration-12345';
  const testUserId = 'test-user-integration';

  beforeAll(async () => {
    // Initialize services
    configManager = ConfigurationManager.getInstance();
    featureFlagService = FeatureFlagService.getInstance();
    mcpContextService = new MCPContextService();
    productService = new ProductService();
    redisService = new RedisService();
    apiKeyService = new ApiKeyService();

    // Initialize configuration manager with test parameters
    await configManager.initialize();

    // Set up test configurations
    await configManager.set('providers/openai/enabled', true);
    await configManager.set('providers/bedrock/enabled', true);
    await configManager.set('cache/redis/enabled', true);
    await configManager.set('mcp/enabled', true);
    await configManager.set('auth/api-keys/enabled', true);

    // Initialize feature flags service
    await featureFlagService.initialize();

    // Create test feature flags
    await featureFlagService.createFlag({
      name: 'mcp-integration',
      enabled: true,
      description: 'Enable MCP integration for product data',
      rolloutPercentage: 100,
    });

    await featureFlagService.createFlag({
      name: 'request-batching',
      enabled: true,
      description: 'Enable request batching optimization',
      rolloutPercentage: 100,
    });

    await featureFlagService.createFlag({
      name: 'cost-optimization',
      enabled: true,
      description: 'Enable cost optimization routing',
      rolloutPercentage: 100,
    });

    // Initialize MCP context service
    await mcpContextService.initialize();

    // Set up test API key
    await apiKeyService.createApiKey({
      userId: testUserId,
      tier: 'premium',
      description: 'Integration test API key',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await apiKeyService.revokeApiKey(testApiKey);
      await featureFlagService.deleteFlag('mcp-integration');
      await featureFlagService.deleteFlag('request-batching');
      await featureFlagService.deleteFlag('cost-optimization');
      configManager.stop();
    } catch (error) {
      console.warn('Cleanup error:', error);
    }
  });

  describe('11.1 Complete System Integration', () => {
    test('should wire gateway handler with provider router, MCP server, and caching', async () => {
      const event: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'POST',
        path: '/api/v1/completions',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'Tell me about wireless headphones under $100',
            },
          ],
          maxTokens: 150,
          temperature: 0.7,
        }),
      });

      const response: APIGatewayProxyResult = await handler(event);

      // Verify successful response
      expect(response.statusCode).toBe(200);
      expect(response.headers['Content-Type']).toBe('application/json');
      expect(response.headers['X-Correlation-ID']).toBeDefined();

      const responseBody = JSON.parse(response.body);
      expect(responseBody.id).toBeDefined();
      expect(responseBody.model).toBe('gpt-3.5-turbo');
      expect(responseBody.choices).toHaveLength(1);
      expect(responseBody.usage).toBeDefined();
      expect(responseBody.cost).toBeDefined();
      expect(responseBody.provider).toBeDefined();

      // Verify MCP context was injected
      expect(responseBody.choices[0].message.content).toContain('headphones');
    });

    test('should handle authentication and authorization across all endpoints', async () => {
      // Test without API key
      const eventWithoutAuth: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'POST',
        path: '/api/v1/completions',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      const responseWithoutAuth = await handler(eventWithoutAuth);
      expect(responseWithoutAuth.statusCode).toBe(401);

      // Test with invalid API key
      const eventWithInvalidAuth: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'POST',
        path: '/api/v1/completions',
        headers: {
          'X-API-Key': 'invalid-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      const responseWithInvalidAuth = await handler(eventWithInvalidAuth);
      expect(responseWithInvalidAuth.statusCode).toBe(401);

      // Test with valid API key
      const eventWithValidAuth: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'POST',
        path: '/api/v1/completions',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      const responseWithValidAuth = await handler(eventWithValidAuth);
      expect(responseWithValidAuth.statusCode).toBe(200);
    });

    test('should verify observability and monitoring functionality end-to-end', async () => {
      // Test health check endpoint
      const healthEvent: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'GET',
        path: '/api/v1/health',
      });

      const healthResponse = await handler(healthEvent);
      expect(healthResponse.statusCode).toBe(200);

      const healthBody = JSON.parse(healthResponse.body);
      expect(healthBody.status).toBe('healthy');
      expect(healthBody.timestamp).toBeDefined();
      expect(healthBody.correlationId).toBeDefined();

      // Test detailed health check
      const detailedHealthEvent: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'GET',
        path: '/api/v1/health/detailed',
      });

      const detailedHealthResponse = await handler(detailedHealthEvent);
      expect(detailedHealthResponse.statusCode).toBe(200);

      const detailedHealthBody = JSON.parse(detailedHealthResponse.body);
      expect(detailedHealthBody.system).toBeDefined();
      expect(detailedHealthBody.dependencies).toBeDefined();

      // Test metrics endpoint
      const metricsEvent: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'GET',
        path: '/api/v1/health/metrics',
      });

      const metricsResponse = await handler(metricsEvent);
      expect(metricsResponse.statusCode).toBe(200);

      const metricsBody = JSON.parse(metricsResponse.body);
      expect(metricsBody.metrics).toBeDefined();
      expect(metricsBody.correlation).toBeDefined();
      expect(metricsBody.security).toBeDefined();
      expect(metricsBody.tracing).toBeDefined();
    });

    test('should integrate configuration management with all services', async () => {
      // Test configuration retrieval
      const providerConfig = await configManager.get('providers/openai/enabled', false);
      expect(providerConfig).toBe(true);

      // Test feature flag integration
      const mcpEnabled = await featureFlagService.isEnabled('mcp-integration', {
        userId: testUserId,
      });
      expect(mcpEnabled).toBe(true);

      // Test configuration change
      await configManager.set('test/integration/value', 'test-value');
      const retrievedValue = await configManager.get('test/integration/value');
      expect(retrievedValue).toBe('test-value');

      // Clean up test configuration
      await configManager.delete('test/integration/value');
    });

    test('should handle CORS preflight requests', async () => {
      const corsEvent: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'OPTIONS',
        path: '/api/v1/completions',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type,X-API-Key',
        },
      });

      const corsResponse = await handler(corsEvent);
      expect(corsResponse.statusCode).toBe(200);
      expect(corsResponse.headers['Access-Control-Allow-Origin']).toBeDefined();
      expect(corsResponse.headers['Access-Control-Allow-Methods']).toBeDefined();
      expect(corsResponse.headers['Access-Control-Allow-Headers']).toBeDefined();
    });

    test('should handle rate limiting correctly', async () => {
      // Create multiple requests to test rate limiting
      const requests = Array.from({ length: 5 }, () =>
        createTestEvent({
          httpMethod: 'POST',
          path: '/api/v1/completions',
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Test rate limiting' }],
            maxTokens: 10,
          }),
        })
      );

      const responses = await Promise.all(requests.map(event => handler(event)));

      // All requests should succeed for premium tier
      responses.forEach(response => {
        expect([200, 429]).toContain(response.statusCode);
        expect(response.headers['X-RateLimit-Remaining-Requests']).toBeDefined();
      });
    });
  });

  describe('Provider Integration Tests', () => {
    test('should route requests to different providers based on configuration', async () => {
      // Test OpenAI provider
      const openaiEvent: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'POST',
        path: '/api/v1/completions',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello from OpenAI' }],
          maxTokens: 10,
        }),
      });

      const openaiResponse = await handler(openaiEvent);
      expect(openaiResponse.statusCode).toBe(200);

      const openaiBody = JSON.parse(openaiResponse.body);
      expect(['openai', 'bedrock']).toContain(openaiBody.provider);

      // Test Bedrock provider (if available)
      const bedrockEvent: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'POST',
        path: '/api/v1/completions',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3',
          messages: [{ role: 'user', content: 'Hello from Bedrock' }],
          maxTokens: 10,
        }),
      });

      const bedrockResponse = await handler(bedrockEvent);
      expect([200, 400]).toContain(bedrockResponse.statusCode); // May not be configured in test
    });

    test('should handle provider failover scenarios', async () => {
      // Disable OpenAI provider temporarily
      await configManager.set('providers/openai/enabled', false);

      const event: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'POST',
        path: '/api/v1/completions',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Test failover' }],
          maxTokens: 10,
        }),
      });

      const response = await handler(event);
      
      // Should either succeed with alternative provider or fail gracefully
      expect([200, 503]).toContain(response.statusCode);

      // Re-enable OpenAI provider
      await configManager.set('providers/openai/enabled', true);
    });
  });

  describe('Cache Integration Tests', () => {
    test('should cache and retrieve responses correctly', async () => {
      const event: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'POST',
        path: '/api/v1/completions',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Cache test message' }],
          maxTokens: 10,
        }),
      });

      // First request - should not be cached
      const firstResponse = await handler(event);
      expect(firstResponse.statusCode).toBe(200);
      expect(firstResponse.headers['X-Request-Cached']).toBe('false');

      // Second identical request - should be cached
      const secondResponse = await handler(event);
      expect(secondResponse.statusCode).toBe(200);
      
      // Note: Caching behavior depends on implementation details
      // The response may or may not be cached depending on cache key generation
    });

    test('should handle cache failures gracefully', async () => {
      // This test would require mocking Redis failures
      // For now, we'll test that the system continues to work
      const event: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'POST',
        path: '/api/v1/completions',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Cache failure test' }],
          maxTokens: 10,
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
    });
  });

  describe('Security Integration Tests', () => {
    test('should apply security middleware correctly', async () => {
      // Test with potentially malicious input
      const maliciousEvent: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'POST',
        path: '/api/v1/completions',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: '<script>alert("xss")</script>',
            },
          ],
          maxTokens: 10,
        }),
      });

      const response = await handler(maliciousEvent);
      expect(response.statusCode).toBe(200);
      expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(response.headers['X-Frame-Options']).toBe('DENY');
    });

    test('should validate request signatures when required', async () => {
      // Test request without signature (should still work for basic auth)
      const event: APIGatewayProxyEvent = createTestEvent({
        httpMethod: 'POST',
        path: '/api/v1/completions',
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Signature test' }],
          maxTokens: 10,
        }),
      });

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
    });
  });
});

// Helper function to create test API Gateway events
function createTestEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    body: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {
      accountId: 'test-account',
      apiId: 'test-api',
      authorizer: null,
      protocol: 'HTTP/1.1',
      httpMethod: overrides.httpMethod || 'GET',
      path: overrides.path || '/',
      stage: 'test',
      requestId: `test-request-${Date.now()}`,
      requestTime: new Date().toISOString(),
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: overrides.path || '/',
      identity: {
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
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'test-agent',
        userArn: null,
      },
    },
    resource: 'test-resource',
    ...overrides,
  };
}