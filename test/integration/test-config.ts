import { ConfigurationManager } from '../../src/services/config/configuration-manager';
import { FeatureFlagService } from '../../src/services/config/feature-flag-service';
import { ApiKeyService } from '../../src/services/auth/api-key-service';
import { RateLimitTier } from '../../src/shared/types';

/**
 * Test configuration setup for integration tests
 * Provides utilities to set up and tear down test environments
 */
export class TestConfig {
  private static instance: TestConfig;
  private configManager: ConfigurationManager;
  private featureFlagService: FeatureFlagService;
  private apiKeyService: ApiKeyService;
  private testApiKeys: string[] = [];
  private testFlags: string[] = [];
  private testConfigs: string[] = [];

  private constructor() {
    this.configManager = ConfigurationManager.getInstance();
    this.featureFlagService = FeatureFlagService.getInstance();
    this.apiKeyService = new ApiKeyService();
  }

  static getInstance(): TestConfig {
    if (!TestConfig.instance) {
      TestConfig.instance = new TestConfig();
    }
    return TestConfig.instance;
  }

  /**
   * Set up test environment with default configurations
   */
  async setupTestEnvironment(): Promise<void> {
    // Initialize services
    await this.configManager.initialize();
    await this.featureFlagService.initialize();

    // Set up default test configurations
    await this.setTestConfig('providers/openai/enabled', true);
    await this.setTestConfig('providers/bedrock/enabled', true);
    await this.setTestConfig('cache/redis/enabled', true);
    await this.setTestConfig('mcp/enabled', true);
    await this.setTestConfig('auth/api-keys/enabled', true);
    await this.setTestConfig('observability/tracing/enabled', true);
    await this.setTestConfig('observability/metrics/enabled', true);
    await this.setTestConfig('security/request-signing/required', false);
    await this.setTestConfig('rate-limiting/enabled', true);

    // Provider configurations
    await this.setTestConfig('providers/openai/api-key', 'test-openai-key');
    await this.setTestConfig('providers/openai/models', ['gpt-3.5-turbo', 'gpt-4']);
    await this.setTestConfig('providers/openai/max-concurrency', 10);
    await this.setTestConfig('providers/openai/timeout', 30000);
    await this.setTestConfig('providers/openai/retry-attempts', 3);

    await this.setTestConfig('providers/bedrock/region', 'us-east-1');
    await this.setTestConfig('providers/bedrock/models', ['claude-3', 'llama-2']);
    await this.setTestConfig('providers/bedrock/max-concurrency', 5);
    await this.setTestConfig('providers/bedrock/timeout', 30000);
    await this.setTestConfig('providers/bedrock/retry-attempts', 2);

    // Cache configurations
    await this.setTestConfig('cache/redis/host', 'localhost');
    await this.setTestConfig('cache/redis/port', 6379);
    await this.setTestConfig('cache/redis/ttl', 300);
    await this.setTestConfig('cache/redis/max-connections', 10);

    // MCP configurations
    await this.setTestConfig('mcp/server/port', 3001);
    await this.setTestConfig('mcp/server/host', 'localhost');
    await this.setTestConfig('mcp/product-data/enabled', true);
    await this.setTestConfig('mcp/context-injection/enabled', true);

    // Rate limiting configurations
    await this.setTestConfig('rate-limiting/basic/requests-per-minute', 60);
    await this.setTestConfig('rate-limiting/premium/requests-per-minute', 300);
    await this.setTestConfig('rate-limiting/enterprise/requests-per-minute', 1000);

    // Set up default feature flags
    await this.createTestFeatureFlag('mcp-integration', {
      enabled: true,
      description: 'Enable MCP integration for product data',
      rolloutPercentage: 100,
    });

    await this.createTestFeatureFlag('request-batching', {
      enabled: true,
      description: 'Enable request batching optimization',
      rolloutPercentage: 100,
    });

    await this.createTestFeatureFlag('cost-optimization', {
      enabled: true,
      description: 'Enable cost optimization routing',
      rolloutPercentage: 100,
    });

    await this.createTestFeatureFlag('provider-failover', {
      enabled: true,
      description: 'Enable automatic provider failover',
      rolloutPercentage: 100,
    });

    await this.createTestFeatureFlag('intelligent-caching', {
      enabled: true,
      description: 'Enable intelligent response caching',
      rolloutPercentage: 50, // Partial rollout for testing
    });

    console.log('Test environment setup completed');
  }

  /**
   * Create test API key for integration tests
   */
  async createTestApiKey(userId: string, tier: 'basic' | 'premium' | 'enterprise' = 'premium'): Promise<string> {
    const rateLimitTier = tier === 'basic' ? RateLimitTier.BASIC : 
                         tier === 'premium' ? RateLimitTier.PREMIUM : 
                         RateLimitTier.ENTERPRISE;

    const apiKeyData = await this.apiKeyService.createApiKey(
      userId,
      `Integration test key for ${userId}`,
      rateLimitTier,
      [], // permissions
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
    );

    this.testApiKeys.push(apiKeyData.id);
    return apiKeyData.key;
  }

  /**
   * Create test user context for feature flag testing
   */
  createTestUserContext(userId: string, attributes?: Record<string, string>, segments?: string[]) {
    return {
      userId,
      attributes: attributes || {
        tier: 'premium',
        region: 'us-east-1',
        environment: 'test',
      },
      segments: segments || ['beta-users', 'integration-test'],
    };
  }

  /**
   * Set test configuration value
   */
  private async setTestConfig(key: string, value: any): Promise<void> {
    await this.configManager.set(key, value, {
      description: `Test configuration for ${key}`,
    });
    this.testConfigs.push(key);
  }

  /**
   * Create test feature flag
   */
  private async createTestFeatureFlag(name: string, config: {
    enabled: boolean;
    description: string;
    rolloutPercentage?: number;
    targeting?: any;
    variants?: any[];
  }): Promise<void> {
    await this.featureFlagService.createFlag({
      name,
      enabled: config.enabled,
      description: config.description,
      rolloutPercentage: config.rolloutPercentage || 100,
      targeting: config.targeting || {},
      variants: config.variants,
    });
    this.testFlags.push(name);
  }

  /**
   * Clean up test environment
   */
  async cleanupTestEnvironment(): Promise<void> {
    try {
      // Revoke test API keys
      for (const keyId of this.testApiKeys) {
        try {
          // We need to find the userId for each keyId to revoke properly
          // For now, we'll skip revocation in cleanup as it requires userId
          console.log(`Skipping revocation of API key ${keyId} - requires userId`);
        } catch (error) {
          console.warn(`Failed to revoke API key ${keyId}:`, error);
        }
      }

      // Delete test feature flags
      for (const flagName of this.testFlags) {
        try {
          await this.featureFlagService.deleteFlag(flagName);
        } catch (error) {
          console.warn(`Failed to delete feature flag ${flagName}:`, error);
        }
      }

      // Delete test configurations
      for (const configKey of this.testConfigs) {
        try {
          await this.configManager.delete(configKey);
        } catch (error) {
          console.warn(`Failed to delete configuration ${configKey}:`, error);
        }
      }

      // Stop configuration manager
      this.configManager.stop();

      console.log('Test environment cleanup completed');
    } catch (error) {
      console.error('Error during test environment cleanup:', error);
    }
  }

  /**
   * Get test configuration for specific scenarios
   */
  getTestScenarioConfig(scenario: 'basic' | 'premium' | 'enterprise' | 'failover' | 'cache-test') {
    const configs = {
      basic: {
        tier: 'basic',
        rateLimitRpm: 60,
        features: ['mcp-integration'],
      },
      premium: {
        tier: 'premium',
        rateLimitRpm: 300,
        features: ['mcp-integration', 'request-batching', 'cost-optimization'],
      },
      enterprise: {
        tier: 'enterprise',
        rateLimitRpm: 1000,
        features: ['mcp-integration', 'request-batching', 'cost-optimization', 'provider-failover'],
      },
      failover: {
        tier: 'premium',
        rateLimitRpm: 300,
        features: ['provider-failover'],
        providerConfig: {
          openai: { enabled: false },
          bedrock: { enabled: true },
        },
      },
      'cache-test': {
        tier: 'premium',
        rateLimitRpm: 300,
        features: ['intelligent-caching'],
        cacheConfig: {
          ttl: 60,
          enabled: true,
        },
      },
    };

    return configs[scenario];
  }

  /**
   * Wait for configuration propagation
   */
  async waitForConfigPropagation(timeoutMs: number = 5000): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, 1000)));
  }

  /**
   * Verify system health before tests
   */
  async verifySystemHealth(): Promise<boolean> {
    try {
      // Check if configuration manager is initialized
      const testConfig = await this.configManager.get('providers/openai/enabled', false);
      
      // Check if feature flags are working
      const testFlag = await this.featureFlagService.isEnabled('mcp-integration');
      
      return testConfig === true && testFlag === true;
    } catch (error) {
      console.error('System health check failed:', error);
      return false;
    }
  }
}

/**
 * Test data generators for integration tests
 */
export class TestDataGenerator {
  /**
   * Generate test LLM request
   */
  static generateLLMRequest(overrides: any = {}) {
    return {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'user',
          content: 'Tell me about wireless headphones under $100',
        },
      ],
      maxTokens: 150,
      temperature: 0.7,
      ...overrides,
    };
  }

  /**
   * Generate test product search request
   */
  static generateProductSearchRequest(overrides: any = {}) {
    return {
      query: 'wireless headphones',
      category: 'electronics',
      priceRange: { min: 0, max: 100 },
      limit: 10,
      ...overrides,
    };
  }

  /**
   * Generate test API Gateway event
   */
  static generateAPIGatewayEvent(overrides: any = {}) {
    return {
      httpMethod: 'POST',
      path: '/api/v1/completions',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      headers: {
        'Content-Type': 'application/json',
      },
      multiValueHeaders: {},
      body: null,
      isBase64Encoded: false,
      stageVariables: null,
      requestContext: {
        accountId: 'test-account',
        apiId: 'test-api',
        authorizer: null,
        protocol: 'HTTP/1.1',
        httpMethod: overrides.httpMethod || 'POST',
        path: overrides.path || '/api/v1/completions',
        stage: 'test',
        requestId: `test-request-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        requestTime: new Date().toISOString(),
        requestTimeEpoch: Date.now(),
        resourceId: 'test-resource',
        resourcePath: overrides.path || '/api/v1/completions',
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
          userAgent: 'integration-test-agent/1.0',
          userArn: null,
        },
      },
      resource: 'test-resource',
      ...overrides,
    };
  }

  /**
   * Generate test correlation ID
   */
  static generateCorrelationId(): string {
    return `test-correlation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate test user ID
   */
  static generateUserId(prefix: string = 'test-user'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }
}