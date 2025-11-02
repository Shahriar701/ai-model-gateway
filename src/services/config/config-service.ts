import { ConfigurationManager, ValidationResult } from './configuration-manager';
import { AI_GATEWAY_CONFIG_SCHEMA, DEFAULT_CONFIGURATIONS, RESTART_REQUIRED_CONFIGS, SENSITIVE_CONFIGS } from './config-schema';
import { Logger } from '../../shared/utils';

/**
 * Application-specific configuration service
 * Provides typed configuration access and validation for AI Model Gateway
 */
export class ConfigService {
  private static instance: ConfigService;
  private configManager: ConfigurationManager;
  private logger: Logger;
  private environment: string;
  private changeListeners: Map<string, ConfigChangeListener[]> = new Map();

  private constructor() {
    this.logger = new Logger('ConfigService');
    this.configManager = ConfigurationManager.getInstance();
    this.environment = process.env.NODE_ENV || 'development';
  }

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  /**
   * Initialize configuration service with defaults
   */
  async initialize(): Promise<void> {
    try {
      await this.configManager.initialize();
      await this.loadDefaultConfigurations();
      await this.validateAllConfigurations();
      
      this.logger.info('Configuration service initialized', {
        environment: this.environment,
      });
    } catch (error) {
      this.logger.error('Failed to initialize configuration service', error as Error);
      throw error;
    }
  }

  // Typed configuration getters

  /**
   * Get API configuration
   */
  async getApiConfig(): Promise<ApiConfig> {
    return {
      corsEnabled: await this.configManager.get('api/cors/enabled', true),
      corsOrigins: await this.configManager.get('api/cors/origins', ['*']),
      rateLimitEnabled: await this.configManager.get('api/rate-limit/enabled', true),
      requestTimeout: await this.configManager.get('api/request-timeout', 30000),
    };
  }

  /**
   * Get authentication configuration
   */
  async getAuthConfig(): Promise<AuthConfig> {
    return {
      apiKeyRequired: await this.configManager.get('auth/api-key/required', true),
      jwtEnabled: await this.configManager.get('auth/jwt/enabled', false),
      jwtSecret: await this.configManager.get('auth/jwt/secret'),
      sessionTimeout: await this.configManager.get('auth/session-timeout', 3600000),
    };
  }

  /**
   * Get rate limiting configuration
   */
  async getRateLimitConfig(): Promise<RateLimitConfig> {
    return {
      free: {
        requestsPerMinute: await this.configManager.get('rate-limit/free/requests-per-minute', 10),
        requestsPerHour: await this.configManager.get('rate-limit/free/requests-per-hour', 100),
      },
      basic: {
        requestsPerMinute: await this.configManager.get('rate-limit/basic/requests-per-minute', 50),
        requestsPerHour: await this.configManager.get('rate-limit/basic/requests-per-hour', 1000),
      },
      premium: {
        requestsPerMinute: await this.configManager.get('rate-limit/premium/requests-per-minute', 200),
        requestsPerHour: await this.configManager.get('rate-limit/premium/requests-per-hour', 5000),
      },
    };
  }

  /**
   * Get provider configuration
   */
  async getProviderConfig(): Promise<ProviderConfig> {
    return {
      openai: {
        enabled: await this.configManager.get('providers/openai/enabled', true),
        apiKey: await this.configManager.get('providers/openai/api-key'),
        baseUrl: await this.configManager.get('providers/openai/base-url', 'https://api.openai.com/v1'),
        timeout: await this.configManager.get('providers/openai/timeout', 30000),
        maxRetries: await this.configManager.get('providers/openai/max-retries', 3),
        priority: await this.configManager.get('providers/openai/priority', 1),
      },
      bedrock: {
        enabled: await this.configManager.get('providers/bedrock/enabled', true),
        region: await this.configManager.get('providers/bedrock/region', 'us-east-1'),
        timeout: await this.configManager.get('providers/bedrock/timeout', 30000),
        maxRetries: await this.configManager.get('providers/bedrock/max-retries', 2),
        priority: await this.configManager.get('providers/bedrock/priority', 2),
      },
    };
  }

  /**
   * Get routing configuration
   */
  async getRoutingConfig(): Promise<RoutingConfig> {
    return {
      strategy: await this.configManager.get('routing/strategy', 'cost_optimized'),
      failoverEnabled: await this.configManager.get('routing/failover-enabled', true),
      circuitBreakerEnabled: await this.configManager.get('routing/circuit-breaker-enabled', true),
      healthCheckInterval: await this.configManager.get('routing/health-check-interval', 60000),
    };
  }

  /**
   * Get caching configuration
   */
  async getCacheConfig(): Promise<CacheConfig> {
    return {
      enabled: await this.configManager.get('cache/enabled', true),
      redis: {
        host: await this.configManager.get('cache/redis/host'),
        port: await this.configManager.get('cache/redis/port', 6379),
        password: await this.configManager.get('cache/redis/password'),
      },
      ttl: {
        default: await this.configManager.get('cache/ttl/default', 3600),
        llmResponses: await this.configManager.get('cache/ttl/llm-responses', 1800),
      },
      maxSize: await this.configManager.get('cache/max-size', 1000),
    };
  }

  /**
   * Get MCP configuration
   */
  async getMcpConfig(): Promise<McpConfig> {
    return {
      enabled: await this.configManager.get('mcp/enabled', true),
      port: await this.configManager.get('mcp/port', 3001),
      maxConnections: await this.configManager.get('mcp/max-connections', 100),
      contextInjectionEnabled: await this.configManager.get('mcp/context-injection-enabled', true),
    };
  }

  /**
   * Get observability configuration
   */
  async getObservabilityConfig(): Promise<ObservabilityConfig> {
    return {
      metrics: {
        enabled: await this.configManager.get('observability/metrics/enabled', true),
        namespace: await this.configManager.get('observability/metrics/namespace', 'AIModelGateway'),
      },
      tracing: {
        enabled: await this.configManager.get('observability/tracing/enabled', true),
        sampleRate: await this.configManager.get('observability/tracing/sample-rate', 0.1),
      },
      logging: {
        level: await this.configManager.get('observability/logging/level', 'INFO'),
      },
      correlationTracking: await this.configManager.get('observability/correlation-tracking', true),
    };
  }

  /**
   * Get security configuration
   */
  async getSecurityConfig(): Promise<SecurityConfig> {
    return {
      encryptionEnabled: await this.configManager.get('security/encryption/enabled', true),
      requestSigningEnabled: await this.configManager.get('security/request-signing/enabled', false),
      ipWhitelist: {
        enabled: await this.configManager.get('security/ip-whitelist/enabled', false),
        addresses: await this.configManager.get('security/ip-whitelist/addresses', []),
      },
      monitoring: {
        enabled: await this.configManager.get('security/monitoring/enabled', true),
        incidentResponseEnabled: await this.configManager.get('security/incident-response/enabled', true),
      },
    };
  }

  /**
   * Get cost management configuration
   */
  async getCostConfig(): Promise<CostConfig> {
    return {
      trackingEnabled: await this.configManager.get('cost/tracking/enabled', true),
      optimizationEnabled: await this.configManager.get('cost/optimization/enabled', true),
      alerts: {
        dailyThreshold: await this.configManager.get('cost/alerts/daily-threshold', 100),
        monthlyThreshold: await this.configManager.get('cost/alerts/monthly-threshold', 1000),
      },
    };
  }

  /**
   * Get batching configuration
   */
  async getBatchingConfig(): Promise<BatchingConfig> {
    return {
      enabled: await this.configManager.get('batching/enabled', true),
      maxBatchSize: await this.configManager.get('batching/max-batch-size', 5),
      timeout: await this.configManager.get('batching/timeout', 100),
      deduplicationEnabled: await this.configManager.get('batching/deduplication-enabled', true),
    };
  }

  /**
   * Get feature flags
   */
  async getFeatureFlags(): Promise<FeatureFlags> {
    return {
      intelligentRouting: await this.configManager.get('features/intelligent-routing', true),
      advancedCaching: await this.configManager.get('features/advanced-caching', true),
      costOptimization: await this.configManager.get('features/cost-optimization', true),
      securityMonitoring: await this.configManager.get('features/security-monitoring', true),
    };
  }

  // Configuration management methods

  /**
   * Update configuration value
   */
  async updateConfig(key: string, value: any): Promise<void> {
    try {
      const oldValue = await this.configManager.get(key);
      
      await this.configManager.set(key, value, {
        secure: SENSITIVE_CONFIGS.includes(key),
        description: `Updated by ConfigService at ${new Date().toISOString()}`,
      });

      // Notify listeners
      await this.notifyConfigChange(key, oldValue, value);

      this.logger.info('Configuration updated', {
        key,
        requiresRestart: RESTART_REQUIRED_CONFIGS.includes(key),
        sensitive: SENSITIVE_CONFIGS.includes(key),
      });

    } catch (error) {
      this.logger.error('Failed to update configuration', error as Error, { key });
      throw error;
    }
  }

  /**
   * Validate all configurations against schema
   */
  async validateAllConfigurations(): Promise<ValidationResult> {
    try {
      const allConfigs = await this.configManager.getAll();
      const result = this.configManager.validateConfiguration(allConfigs, AI_GATEWAY_CONFIG_SCHEMA);

      if (!result.valid) {
        this.logger.error('Configuration validation failed', undefined, {
          errors: result.errors,
          warnings: result.warnings,
        });
      } else if (result.warnings.length > 0) {
        this.logger.warn('Configuration validation warnings', {
          warnings: result.warnings,
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to validate configurations', error as Error);
      throw error;
    }
  }

  /**
   * Register configuration change listener
   */
  onConfigChange(key: string, listener: ConfigChangeListener): void {
    if (!this.changeListeners.has(key)) {
      this.changeListeners.set(key, []);
    }
    this.changeListeners.get(key)!.push(listener);
  }

  /**
   * Remove configuration change listener
   */
  removeConfigChangeListener(key: string, listener: ConfigChangeListener): void {
    const listeners = this.changeListeners.get(key);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Get configuration statistics
   */
  getStatistics() {
    return this.configManager.getStatistics();
  }

  /**
   * Refresh configurations from Parameter Store
   */
  async refresh(): Promise<void> {
    await this.configManager.refresh();
  }

  /**
   * Stop configuration service
   */
  stop(): void {
    this.configManager.stop();
  }

  // Private methods

  private async loadDefaultConfigurations(): Promise<void> {
    const defaults = DEFAULT_CONFIGURATIONS[this.environment as keyof typeof DEFAULT_CONFIGURATIONS] || {};
    
    for (const [key, value] of Object.entries(defaults)) {
      try {
        // Only set if not already exists
        const existing = await this.configManager.get(key);
        if (existing === undefined) {
          await this.configManager.set(key, value, {
            description: `Default value for ${this.environment} environment`,
          });
        }
      } catch (error) {
        this.logger.warn('Failed to set default configuration', {
          key,
          value,
          error: (error as Error).message,
        });
      }
    }
  }

  private async notifyConfigChange(key: string, oldValue: any, newValue: any): Promise<void> {
    const listeners = this.changeListeners.get(key) || [];
    
    for (const listener of listeners) {
      try {
        await listener(key, oldValue, newValue);
      } catch (error) {
        this.logger.error('Configuration change listener failed', error as Error, { key });
      }
    }
  }
}

// Configuration interfaces

export interface ApiConfig {
  corsEnabled: boolean;
  corsOrigins: string[];
  rateLimitEnabled: boolean;
  requestTimeout: number;
}

export interface AuthConfig {
  apiKeyRequired: boolean;
  jwtEnabled: boolean;
  jwtSecret?: string;
  sessionTimeout: number;
}

export interface RateLimitConfig {
  free: {
    requestsPerMinute: number;
    requestsPerHour: number;
  };
  basic: {
    requestsPerMinute: number;
    requestsPerHour: number;
  };
  premium: {
    requestsPerMinute: number;
    requestsPerHour: number;
  };
}

export interface ProviderConfig {
  openai: {
    enabled: boolean;
    apiKey?: string;
    baseUrl: string;
    timeout: number;
    maxRetries: number;
    priority: number;
  };
  bedrock: {
    enabled: boolean;
    region: string;
    timeout: number;
    maxRetries: number;
    priority: number;
  };
}

export interface RoutingConfig {
  strategy: string;
  failoverEnabled: boolean;
  circuitBreakerEnabled: boolean;
  healthCheckInterval: number;
}

export interface CacheConfig {
  enabled: boolean;
  redis: {
    host?: string;
    port: number;
    password?: string;
  };
  ttl: {
    default: number;
    llmResponses: number;
  };
  maxSize: number;
}

export interface McpConfig {
  enabled: boolean;
  port: number;
  maxConnections: number;
  contextInjectionEnabled: boolean;
}

export interface ObservabilityConfig {
  metrics: {
    enabled: boolean;
    namespace: string;
  };
  tracing: {
    enabled: boolean;
    sampleRate: number;
  };
  logging: {
    level: string;
  };
  correlationTracking: boolean;
}

export interface SecurityConfig {
  encryptionEnabled: boolean;
  requestSigningEnabled: boolean;
  ipWhitelist: {
    enabled: boolean;
    addresses: string[];
  };
  monitoring: {
    enabled: boolean;
    incidentResponseEnabled: boolean;
  };
}

export interface CostConfig {
  trackingEnabled: boolean;
  optimizationEnabled: boolean;
  alerts: {
    dailyThreshold: number;
    monthlyThreshold: number;
  };
}

export interface BatchingConfig {
  enabled: boolean;
  maxBatchSize: number;
  timeout: number;
  deduplicationEnabled: boolean;
}

export interface FeatureFlags {
  intelligentRouting: boolean;
  advancedCaching: boolean;
  costOptimization: boolean;
  securityMonitoring: boolean;
}

export type ConfigChangeListener = (key: string, oldValue: any, newValue: any) => Promise<void> | void;