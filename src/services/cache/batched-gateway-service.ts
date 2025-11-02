import { LLMRequest, LLMResponse, ProviderSelectionCriteria } from '../../shared/types';
import { Logger } from '../../shared/utils';
import { RequestBatcher, BatchConfig } from './request-batcher';
import { CacheManager, getCacheManager } from './cache-manager';
import { ProviderRouter } from '../router/provider-router';

const logger = new Logger('BatchedGatewayService');

export interface GatewayConfig {
  batchConfig: Partial<BatchConfig>;
  cacheConfig?: any;
  enableIntelligentRouting: boolean;
  costOptimizationThreshold: number;
}

/**
 * Enhanced gateway service with request batching and optimization
 */
export class BatchedGatewayService {
  private requestBatcher: RequestBatcher;
  private cacheManager: CacheManager;
  private providerRouter: ProviderRouter;
  private config: GatewayConfig;
  private requestMetrics: Map<string, RequestMetrics> = new Map();

  constructor(
    providerRouter: ProviderRouter,
    config: Partial<GatewayConfig> = {}
  ) {
    this.config = {
      batchConfig: {
        maxBatchSize: 5,
        batchTimeoutMs: 100,
        similarityThreshold: 0.8,
        enableDeduplication: true,
      },
      enableIntelligentRouting: true,
      costOptimizationThreshold: 0.001, // $0.001 threshold for cost optimization
      ...config,
    };

    this.providerRouter = providerRouter;
    this.cacheManager = getCacheManager(this.config.cacheConfig);
    this.requestBatcher = new RequestBatcher(this.config.batchConfig, this.cacheManager);

    // Set the request executor for the batcher
    this.requestBatcher.setRequestExecutor(this.executeRequest.bind(this));

    logger.info('Batched gateway service initialized', {
      batchingEnabled: true,
      intelligentRouting: this.config.enableIntelligentRouting,
      costThreshold: this.config.costOptimizationThreshold,
    });
  }

  /**
   * Process LLM request with batching and optimization
   */
  async processRequest(
    request: LLMRequest,
    criteria?: ProviderSelectionCriteria
  ): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    logger.info('Processing request with batching', {
      requestId,
      model: request.model,
      batchingEnabled: true,
    });

    try {
      // Apply intelligent routing criteria if enabled
      const optimizedCriteria = this.config.enableIntelligentRouting
        ? this.optimizeRoutingCriteria(request, criteria)
        : criteria;

      // Store routing criteria in request metadata for the batcher
      const enhancedRequest = {
        ...request,
        metadata: {
          ...request.metadata,
          routingCriteria: optimizedCriteria,
          requestId,
        },
      };

      // Process through batcher
      const response = await this.requestBatcher.processRequest(enhancedRequest);

      // Record metrics
      this.recordRequestMetrics(requestId, request, response, Date.now() - startTime);

      logger.info('Request processed successfully', {
        requestId,
        provider: response.provider,
        cached: response.cached,
        latency: response.latency,
        cost: response.cost.total,
      });

      return response;
    } catch (error) {
      logger.error('Request processing failed', error as Error, { requestId });
      throw error;
    }
  }

  /**
   * Execute individual request through provider router
   */
  private async executeRequest(request: LLMRequest): Promise<LLMResponse> {
    const criteria = (request.metadata as any)?.routingCriteria;
    
    // Route through provider router
    const response = await this.providerRouter.routeRequest(request, criteria);
    
    return response;
  }

  /**
   * Optimize routing criteria based on request patterns and cost analysis
   */
  private optimizeRoutingCriteria(
    request: LLMRequest,
    baseCriteria?: ProviderSelectionCriteria
  ): ProviderSelectionCriteria {
    const requestHash = this.cacheManager.generateRequestHash(request);
    const metrics = this.requestMetrics.get(requestHash);

    // Default to cost optimization
    let optimizedCriteria: ProviderSelectionCriteria = {
      strategy: 'cost_optimized' as any,
      ...baseCriteria,
    };

    // Analyze historical performance for this request pattern
    if (metrics && metrics.requestCount > 5) {
      const avgCost = metrics.totalCost / metrics.requestCount;
      const avgLatency = metrics.totalLatency / metrics.requestCount;

      // Switch to latency optimization for expensive requests
      if (avgCost > this.config.costOptimizationThreshold) {
        optimizedCriteria.strategy = 'latency_optimized' as any;
        logger.debug('Switching to latency optimization for expensive request', {
          avgCost,
          threshold: this.config.costOptimizationThreshold,
        });
      }

      // Exclude consistently slow providers
      if (avgLatency > 5000) { // 5 seconds
        const slowProviders = this.identifySlowProviders(requestHash);
        if (slowProviders.length > 0) {
          optimizedCriteria.excludedProviders = [
            ...(optimizedCriteria.excludedProviders || []),
            ...slowProviders,
          ];
        }
      }
    }

    // Apply cost-based provider preferences
    const costAnalysis = this.analyzeCostPatterns(request);
    if (costAnalysis.preferredProviders.length > 0) {
      optimizedCriteria.preferredProviders = costAnalysis.preferredProviders;
    }

    return optimizedCriteria;
  }

  /**
   * Analyze cost patterns for provider selection
   */
  private analyzeCostPatterns(request: LLMRequest): CostAnalysis {
    const analysis: CostAnalysis = {
      preferredProviders: [],
      estimatedCosts: new Map(),
    };

    // Get provider stats from router
    const providerStats = this.providerRouter.getProviderMetrics();

    for (const [providerName, metrics] of providerStats) {
      if (metrics.requestCount > 0) {
        const avgCost = metrics.totalCost / metrics.requestCount;
        analysis.estimatedCosts.set(providerName, avgCost);
      }
    }

    // Sort providers by cost efficiency
    const sortedProviders = Array.from(analysis.estimatedCosts.entries())
      .sort(([, costA], [, costB]) => costA - costB)
      .map(([provider]) => provider);

    // Prefer top 2 most cost-effective providers
    analysis.preferredProviders = sortedProviders.slice(0, 2);

    return analysis;
  }

  /**
   * Identify consistently slow providers for a request pattern
   */
  private identifySlowProviders(requestHash: string): string[] {
    // This would analyze provider performance for specific request patterns
    // For now, return empty array - could be enhanced with more detailed metrics
    return [];
  }

  /**
   * Record request metrics for optimization
   */
  private recordRequestMetrics(
    requestId: string,
    request: LLMRequest,
    response: LLMResponse,
    totalLatency: number
  ): void {
    const requestHash = this.cacheManager.generateRequestHash(request);
    let metrics = this.requestMetrics.get(requestHash);

    if (!metrics) {
      metrics = {
        requestHash,
        requestCount: 0,
        totalLatency: 0,
        totalCost: 0,
        cacheHitRate: 0,
        cacheHits: 0,
        lastUpdated: Date.now(),
      };
      this.requestMetrics.set(requestHash, metrics);
    }

    metrics.requestCount++;
    metrics.totalLatency += totalLatency;
    metrics.totalCost += response.cost.total;
    metrics.lastUpdated = Date.now();

    if (response.cached) {
      metrics.cacheHits++;
    }

    metrics.cacheHitRate = (metrics.cacheHits / metrics.requestCount) * 100;

    // Clean up old metrics periodically
    if (this.requestMetrics.size > 5000) {
      this.cleanupOldMetrics();
    }
  }

  /**
   * Clean up old request metrics
   */
  private cleanupOldMetrics(): void {
    const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days

    for (const [hash, metrics] of this.requestMetrics.entries()) {
      if (metrics.lastUpdated < cutoffTime) {
        this.requestMetrics.delete(hash);
      }
    }

    logger.debug('Cleaned up old request metrics', {
      remainingMetrics: this.requestMetrics.size,
    });
  }

  /**
   * Get optimization statistics
   */
  getOptimizationStats(): OptimizationStats {
    const batchingStats = this.requestBatcher.getBatchingStats();
    const usageAnalytics = this.requestBatcher.getUsageAnalytics();

    const totalRequests = Array.from(this.requestMetrics.values())
      .reduce((sum, metrics) => sum + metrics.requestCount, 0);

    const totalCacheHits = Array.from(this.requestMetrics.values())
      .reduce((sum, metrics) => sum + metrics.cacheHits, 0);

    const overallCacheHitRate = totalRequests > 0 ? (totalCacheHits / totalRequests) * 100 : 0;

    return {
      batching: batchingStats,
      caching: {
        overallHitRate: overallCacheHitRate,
        totalRequests,
        totalCacheHits,
        uniquePatterns: usageAnalytics.length,
      },
      optimization: {
        intelligentRoutingEnabled: this.config.enableIntelligentRouting,
        costThreshold: this.config.costOptimizationThreshold,
        metricsTracked: this.requestMetrics.size,
      },
    };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(newConfig: Partial<GatewayConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    logger.info('Gateway configuration updated', {
      batchingEnabled: true,
      intelligentRouting: this.config.enableIntelligentRouting,
    });
  }

  private generateRequestId(): string {
    return `gw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Request metrics for optimization
 */
interface RequestMetrics {
  requestHash: string;
  requestCount: number;
  totalLatency: number;
  totalCost: number;
  cacheHitRate: number;
  cacheHits: number;
  lastUpdated: number;
}

/**
 * Cost analysis results
 */
interface CostAnalysis {
  preferredProviders: string[];
  estimatedCosts: Map<string, number>;
}

/**
 * Optimization statistics
 */
export interface OptimizationStats {
  batching: {
    pendingBatches: number;
    totalPatterns: number;
    config: any;
  };
  caching: {
    overallHitRate: number;
    totalRequests: number;
    totalCacheHits: number;
    uniquePatterns: number;
  };
  optimization: {
    intelligentRoutingEnabled: boolean;
    costThreshold: number;
    metricsTracked: number;
  };
}