import { 
  LLMRequest, 
  LLMResponse, 
  ProviderConfig, 
  ProviderSelectionCriteria,
  RoutingStrategy,
  ProviderType
} from '../../shared/types';
import { ProviderAdapter } from '../providers/base-provider';
import { Logger } from '../../shared/utils';

const logger = new Logger('ProviderRouter');

/**
 * Provider router for intelligent LLM request routing
 * Implements cost optimization, failover, and load balancing
 */
export class ProviderRouter {
  private providers: Map<string, ProviderAdapter> = new Map();
  private providerConfigs: Map<string, ProviderConfig> = new Map();
  private providerMetrics: Map<string, ProviderMetrics> = new Map();

  constructor(providers: ProviderAdapter[], configs: ProviderConfig[]) {
    // Register providers
    providers.forEach(provider => {
      this.providers.set(provider.name, provider);
      this.providerMetrics.set(provider.name, {
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        totalLatency: 0,
        totalCost: 0,
        lastUsed: new Date()
      });
    });

    // Register configs
    configs.forEach(config => {
      this.providerConfigs.set(config.name, config);
    });

    logger.info('Provider router initialized', {
      providerCount: providers.length,
      configCount: configs.length
    });
  }

  /**
   * Route request to the best available provider
   */
  async routeRequest(
    request: LLMRequest,
    criteria?: ProviderSelectionCriteria
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    logger.info('Routing LLM request', {
      requestId,
      model: request.model,
      strategy: criteria?.strategy || 'default'
    });

    try {
      // Select provider based on criteria
      const provider = await this.selectProvider(request, criteria);

      if (!provider) {
        throw new Error('No available providers for this request');
      }

      logger.info('Provider selected', {
        requestId,
        provider: provider.name
      });

      // Execute request with retry logic
      const response = await this.executeWithRetry(provider, request, requestId);

      // Update metrics
      this.updateMetrics(provider.name, true, Date.now() - startTime, response.cost.total);

      logger.info('Request completed successfully', {
        requestId,
        provider: provider.name,
        latency: response.latency,
        cost: response.cost.total
      });

      return response;
    } catch (error) {
      logger.error('Request routing failed', error as Error, { requestId });
      throw error;
    }
  }

  /**
   * Select the best provider based on criteria
   */
  private async selectProvider(
    request: LLMRequest,
    criteria?: ProviderSelectionCriteria
  ): Promise<ProviderAdapter | null> {
    const strategy = criteria?.strategy || RoutingStrategy.COST_OPTIMIZED;

    // Get available providers that support the requested model
    const availableProviders = await this.getAvailableProviders(request.model);

    if (availableProviders.length === 0) {
      return null;
    }

    // Apply exclusions
    let candidates = availableProviders;
    if (criteria?.excludedProviders) {
      candidates = candidates.filter(
        p => !criteria.excludedProviders!.includes(p.name)
      );
    }

    // Apply preferences
    if (criteria?.preferredProviders && criteria.preferredProviders.length > 0) {
      const preferred = candidates.filter(
        p => criteria.preferredProviders!.includes(p.name)
      );
      if (preferred.length > 0) {
        candidates = preferred;
      }
    }

    // Select based on strategy
    switch (strategy) {
      case RoutingStrategy.COST_OPTIMIZED:
        return this.selectByCost(candidates, request);
      
      case RoutingStrategy.LATENCY_OPTIMIZED:
        return this.selectByLatency(candidates);
      
      case RoutingStrategy.PRIORITY_BASED:
        return this.selectByPriority(candidates);
      
      case RoutingStrategy.ROUND_ROBIN:
        return this.selectRoundRobin(candidates);
      
      default:
        return candidates[0];
    }
  }

  /**
   * Get providers that are available and support the model
   */
  private async getAvailableProviders(model: string): Promise<ProviderAdapter[]> {
    const available: ProviderAdapter[] = [];

    for (const [name, provider] of this.providers) {
      const config = this.providerConfigs.get(name);
      
      if (!config || !config.enabled) {
        continue;
      }

      // Check if provider supports the model
      if (!config.models.includes(model) && !config.models.includes('*')) {
        continue;
      }

      // Check provider health
      const isAvailable = await provider.isAvailable();
      if (isAvailable) {
        available.push(provider);
      }
    }

    return available;
  }

  /**
   * Select provider with lowest cost
   */
  private selectByCost(providers: ProviderAdapter[], request: LLMRequest): ProviderAdapter {
    return providers.reduce((best, current) => {
      const bestCost = best.estimateCost(request);
      const currentCost = current.estimateCost(request);
      return currentCost < bestCost ? current : best;
    });
  }

  /**
   * Select provider with lowest average latency
   */
  private selectByLatency(providers: ProviderAdapter[]): ProviderAdapter {
    return providers.reduce((best, current) => {
      const bestMetrics = this.providerMetrics.get(best.name)!;
      const currentMetrics = this.providerMetrics.get(current.name)!;
      
      const bestAvgLatency = bestMetrics.requestCount > 0
        ? bestMetrics.totalLatency / bestMetrics.requestCount
        : Infinity;
      
      const currentAvgLatency = currentMetrics.requestCount > 0
        ? currentMetrics.totalLatency / currentMetrics.requestCount
        : Infinity;
      
      return currentAvgLatency < bestAvgLatency ? current : best;
    });
  }

  /**
   * Select provider by priority
   */
  private selectByPriority(providers: ProviderAdapter[]): ProviderAdapter {
    return providers.reduce((best, current) => {
      const bestConfig = this.providerConfigs.get(best.name)!;
      const currentConfig = this.providerConfigs.get(current.name)!;
      return currentConfig.priority > bestConfig.priority ? current : best;
    });
  }

  /**
   * Select provider using round-robin
   */
  private selectRoundRobin(providers: ProviderAdapter[]): ProviderAdapter {
    // Find least recently used provider
    return providers.reduce((best, current) => {
      const bestMetrics = this.providerMetrics.get(best.name)!;
      const currentMetrics = this.providerMetrics.get(current.name)!;
      return currentMetrics.lastUsed < bestMetrics.lastUsed ? current : best;
    });
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry(
    provider: ProviderAdapter,
    request: LLMRequest,
    requestId: string,
    attempt: number = 1
  ): Promise<LLMResponse> {
    const config = this.providerConfigs.get(provider.name)!;

    try {
      const response = await provider.generateCompletion(request);
      return response;
    } catch (error) {
      logger.warn('Provider request failed', {
        requestId,
        provider: provider.name,
        attempt,
        error: (error as Error).message
      });

      // Update failure metrics
      this.updateMetrics(provider.name, false, 0, 0);

      // Retry if attempts remaining
      if (attempt < config.retryAttempts) {
        await this.delay(config.retryDelay * attempt); // Exponential backoff
        return this.executeWithRetry(provider, request, requestId, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Update provider metrics
   */
  private updateMetrics(
    providerName: string,
    success: boolean,
    latency: number,
    cost: number
  ): void {
    const metrics = this.providerMetrics.get(providerName);
    if (!metrics) return;

    metrics.requestCount++;
    if (success) {
      metrics.successCount++;
      metrics.totalLatency += latency;
      metrics.totalCost += cost;
    } else {
      metrics.failureCount++;
    }
    metrics.lastUsed = new Date();
  }

  /**
   * Get provider metrics for monitoring
   */
  getProviderMetrics(): Map<string, ProviderMetrics> {
    return new Map(this.providerMetrics);
  }

  /**
   * Get provider statistics
   */
  getProviderStats(providerName: string): ProviderStats | null {
    const metrics = this.providerMetrics.get(providerName);
    if (!metrics) return null;

    const successRate = metrics.requestCount > 0
      ? (metrics.successCount / metrics.requestCount) * 100
      : 0;

    const avgLatency = metrics.successCount > 0
      ? metrics.totalLatency / metrics.successCount
      : 0;

    const avgCost = metrics.successCount > 0
      ? metrics.totalCost / metrics.successCount
      : 0;

    return {
      providerName,
      requestCount: metrics.requestCount,
      successCount: metrics.successCount,
      failureCount: metrics.failureCount,
      successRate,
      avgLatency,
      avgCost,
      totalCost: metrics.totalCost,
      lastUsed: metrics.lastUsed
    };
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Internal provider metrics
 */
interface ProviderMetrics {
  requestCount: number;
  successCount: number;
  failureCount: number;
  totalLatency: number;
  totalCost: number;
  lastUsed: Date;
}

/**
 * Provider statistics for monitoring
 */
export interface ProviderStats {
  providerName: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatency: number;
  avgCost: number;
  totalCost: number;
  lastUsed: Date;
}