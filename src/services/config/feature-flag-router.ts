import { FeatureFlagService, UserContext } from './feature-flag-service';
import { Logger } from '../../shared/utils';
import { ProviderType, RoutingStrategy } from '../../shared/types';

/**
 * Feature flag-enabled router for controlled provider rollouts and A/B testing
 * Integrates with FeatureFlagService to enable gradual rollouts and experiments
 */
export class FeatureFlagRouter {
  private static instance: FeatureFlagRouter;
  private featureFlagService: FeatureFlagService;
  private logger: Logger;

  private constructor() {
    this.logger = new Logger('FeatureFlagRouter');
    this.featureFlagService = FeatureFlagService.getInstance();
  }

  static getInstance(): FeatureFlagRouter {
    if (!FeatureFlagRouter.instance) {
      FeatureFlagRouter.instance = new FeatureFlagRouter();
    }
    return FeatureFlagRouter.instance;
  }

  /**
   * Get routing strategy based on feature flags and experiments
   */
  async getRoutingStrategy(userContext?: UserContext): Promise<RoutingStrategy> {
    try {
      // Check for routing strategy experiment
      const routingExperiment = await this.featureFlagService.getExperimentAssignment(
        'routing-strategy-experiment',
        userContext
      );

      if (routingExperiment.inExperiment) {
        switch (routingExperiment.variant) {
          case 'cost_optimized':
            return RoutingStrategy.COST_OPTIMIZED;
          case 'latency_optimized':
            return RoutingStrategy.LATENCY_OPTIMIZED;
          case 'round_robin':
            return RoutingStrategy.ROUND_ROBIN;
          case 'priority_based':
            return RoutingStrategy.PRIORITY_BASED;
        }
      }

      // Check individual routing feature flags
      const intelligentRoutingEnabled = await this.featureFlagService.isEnabled(
        'intelligent-routing',
        userContext
      );

      if (intelligentRoutingEnabled) {
        const costOptimizationEnabled = await this.featureFlagService.isEnabled(
          'cost-optimization',
          userContext
        );

        return costOptimizationEnabled 
          ? RoutingStrategy.COST_OPTIMIZED 
          : RoutingStrategy.LATENCY_OPTIMIZED;
      }

      // Default fallback
      return RoutingStrategy.PRIORITY_BASED;
    } catch (error) {
      this.logger.error('Failed to get routing strategy from feature flags', error as Error);
      return RoutingStrategy.PRIORITY_BASED;
    }
  }

  /**
   * Get enabled providers based on feature flags
   */
  async getEnabledProviders(userContext?: UserContext): Promise<ProviderType[]> {
    try {
      const enabledProviders: ProviderType[] = [];

      // Check OpenAI provider flag
      const openaiEnabled = await this.featureFlagService.isEnabled(
        'provider-openai',
        userContext
      );
      if (openaiEnabled) {
        enabledProviders.push(ProviderType.OPENAI);
      }

      // Check Bedrock provider flag
      const bedrockEnabled = await this.featureFlagService.isEnabled(
        'provider-bedrock',
        userContext
      );
      if (bedrockEnabled) {
        enabledProviders.push(ProviderType.BEDROCK);
      }

      // Check experimental providers
      const experimentalProvidersEnabled = await this.featureFlagService.isEnabled(
        'experimental-providers',
        userContext
      );

      if (experimentalProvidersEnabled) {
        const azureEnabled = await this.featureFlagService.isEnabled(
          'provider-azure',
          userContext
        );
        if (azureEnabled) {
          enabledProviders.push(ProviderType.AZURE);
        }

        const localEnabled = await this.featureFlagService.isEnabled(
          'provider-local',
          userContext
        );
        if (localEnabled) {
          enabledProviders.push(ProviderType.LOCAL);
        }
      }

      // Ensure at least one provider is enabled
      if (enabledProviders.length === 0) {
        this.logger.warn('No providers enabled via feature flags, falling back to OpenAI');
        enabledProviders.push(ProviderType.OPENAI);
      }

      return enabledProviders;
    } catch (error) {
      this.logger.error('Failed to get enabled providers from feature flags', error as Error);
      return [ProviderType.OPENAI]; // Safe fallback
    }
  }

  /**
   * Get provider priority based on feature flags and experiments
   */
  async getProviderPriority(
    provider: ProviderType,
    userContext?: UserContext
  ): Promise<number> {
    try {
      // Check for provider priority experiment
      const priorityExperiment = await this.featureFlagService.getExperimentAssignment(
        'provider-priority-experiment',
        userContext
      );

      if (priorityExperiment.inExperiment) {
        const priorities = priorityExperiment.metadata?.priorities as Record<string, number>;
        if (priorities && priorities[provider]) {
          return priorities[provider];
        }
      }

      // Check individual provider priority flags
      const priorityFlagName = `provider-${provider.toLowerCase()}-priority`;
      const priorityVariant = await this.featureFlagService.getVariant(
        priorityFlagName,
        userContext
      );

      switch (priorityVariant) {
        case 'high':
          return 1;
        case 'medium':
          return 2;
        case 'low':
          return 3;
        default:
          return this.getDefaultProviderPriority(provider);
      }
    } catch (error) {
      this.logger.error('Failed to get provider priority from feature flags', error as Error);
      return this.getDefaultProviderPriority(provider);
    }
  }

  /**
   * Check if advanced caching is enabled for user
   */
  async isAdvancedCachingEnabled(userContext?: UserContext): Promise<boolean> {
    try {
      return await this.featureFlagService.isEnabled('advanced-caching', userContext);
    } catch (error) {
      this.logger.error('Failed to check advanced caching flag', error as Error);
      return true; // Default to enabled
    }
  }

  /**
   * Check if request batching is enabled for user
   */
  async isBatchingEnabled(userContext?: UserContext): Promise<boolean> {
    try {
      return await this.featureFlagService.isEnabled('request-batching', userContext);
    } catch (error) {
      this.logger.error('Failed to check batching flag', error as Error);
      return true; // Default to enabled
    }
  }

  /**
   * Get batching configuration based on feature flags
   */
  async getBatchingConfig(userContext?: UserContext): Promise<BatchingConfig> {
    try {
      const batchingEnabled = await this.isBatchingEnabled(userContext);
      if (!batchingEnabled) {
        return {
          enabled: false,
          maxBatchSize: 1,
          timeoutMs: 0,
          deduplicationEnabled: false,
        };
      }

      // Check for batching experiment
      const batchingExperiment = await this.featureFlagService.getExperimentAssignment(
        'batching-optimization-experiment',
        userContext
      );

      if (batchingExperiment.inExperiment) {
        const config = batchingExperiment.metadata?.config as BatchingConfig;
        if (config) {
          return config;
        }
      }

      // Get variant for batch size
      const batchSizeVariant = await this.featureFlagService.getVariant(
        'batch-size-optimization',
        userContext
      );

      let maxBatchSize = 5; // default
      switch (batchSizeVariant) {
        case 'small':
          maxBatchSize = 3;
          break;
        case 'medium':
          maxBatchSize = 5;
          break;
        case 'large':
          maxBatchSize = 10;
          break;
      }

      return {
        enabled: true,
        maxBatchSize,
        timeoutMs: 100,
        deduplicationEnabled: true,
      };
    } catch (error) {
      this.logger.error('Failed to get batching config from feature flags', error as Error);
      return {
        enabled: true,
        maxBatchSize: 5,
        timeoutMs: 100,
        deduplicationEnabled: true,
      };
    }
  }

  /**
   * Check if cost optimization is enabled for user
   */
  async isCostOptimizationEnabled(userContext?: UserContext): Promise<boolean> {
    try {
      return await this.featureFlagService.isEnabled('cost-optimization', userContext);
    } catch (error) {
      this.logger.error('Failed to check cost optimization flag', error as Error);
      return true; // Default to enabled
    }
  }

  /**
   * Get cost optimization threshold based on feature flags
   */
  async getCostOptimizationThreshold(userContext?: UserContext): Promise<number> {
    try {
      const costOptimizationEnabled = await this.isCostOptimizationEnabled(userContext);
      if (!costOptimizationEnabled) {
        return Infinity; // No cost optimization
      }

      // Check for cost threshold experiment
      const thresholdExperiment = await this.featureFlagService.getExperimentAssignment(
        'cost-threshold-experiment',
        userContext
      );

      if (thresholdExperiment.inExperiment) {
        const threshold = thresholdExperiment.metadata?.threshold as number;
        if (threshold) {
          return threshold;
        }
      }

      // Get variant for cost threshold
      const thresholdVariant = await this.featureFlagService.getVariant(
        'cost-threshold-optimization',
        userContext
      );

      switch (thresholdVariant) {
        case 'aggressive':
          return 0.001; // $0.001
        case 'moderate':
          return 0.01;  // $0.01
        case 'conservative':
          return 0.1;   // $0.10
        default:
          return 0.01;  // Default
      }
    } catch (error) {
      this.logger.error('Failed to get cost optimization threshold from feature flags', error as Error);
      return 0.01; // Default threshold
    }
  }

  /**
   * Check if security monitoring is enabled for user
   */
  async isSecurityMonitoringEnabled(userContext?: UserContext): Promise<boolean> {
    try {
      return await this.featureFlagService.isEnabled('security-monitoring', userContext);
    } catch (error) {
      this.logger.error('Failed to check security monitoring flag', error as Error);
      return true; // Default to enabled for security
    }
  }

  /**
   * Get MCP integration configuration based on feature flags
   */
  async getMcpConfig(userContext?: UserContext): Promise<McpFeatureConfig> {
    try {
      const mcpEnabled = await this.featureFlagService.isEnabled('mcp-integration', userContext);
      if (!mcpEnabled) {
        return {
          enabled: false,
          contextInjectionEnabled: false,
          toolExecutionEnabled: false,
        };
      }

      const contextInjectionEnabled = await this.featureFlagService.isEnabled(
        'mcp-context-injection',
        userContext
      );

      const toolExecutionEnabled = await this.featureFlagService.isEnabled(
        'mcp-tool-execution',
        userContext
      );

      return {
        enabled: true,
        contextInjectionEnabled,
        toolExecutionEnabled,
      };
    } catch (error) {
      this.logger.error('Failed to get MCP config from feature flags', error as Error);
      return {
        enabled: true,
        contextInjectionEnabled: true,
        toolExecutionEnabled: true,
      };
    }
  }

  /**
   * Create user context from request information
   */
  createUserContext(
    userId: string,
    tier?: string,
    region?: string,
    userAgent?: string
  ): UserContext {
    const attributes: Record<string, string> = {};
    const segments: string[] = [];

    if (tier) {
      attributes.tier = tier;
      segments.push(`tier_${tier}`);
    }

    if (region) {
      attributes.region = region;
      segments.push(`region_${region}`);
    }

    if (userAgent) {
      // Simple user agent parsing
      if (userAgent.includes('Mobile')) {
        segments.push('mobile_users');
      } else {
        segments.push('desktop_users');
      }
    }

    return {
      userId,
      attributes,
      segments,
    };
  }

  // Private methods

  private getDefaultProviderPriority(provider: ProviderType): number {
    switch (provider) {
      case ProviderType.OPENAI:
        return 1;
      case ProviderType.BEDROCK:
        return 2;
      case ProviderType.AZURE:
        return 3;
      case ProviderType.LOCAL:
        return 4;
      default:
        return 5;
    }
  }
}

// Interfaces

export interface BatchingConfig {
  enabled: boolean;
  maxBatchSize: number;
  timeoutMs: number;
  deduplicationEnabled: boolean;
}

export interface McpFeatureConfig {
  enabled: boolean;
  contextInjectionEnabled: boolean;
  toolExecutionEnabled: boolean;
}