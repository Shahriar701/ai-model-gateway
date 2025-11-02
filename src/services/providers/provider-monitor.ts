import { ProviderAdapter } from './base-provider';
import { LLMRequest, LLMResponse } from '../../shared/types';
import { Logger } from '../../shared/utils/logger';
import { CloudWatchClient, PutMetricDataCommand, MetricDatum } from '@aws-sdk/client-cloudwatch';

const logger = new Logger('ProviderMonitor');

/**
 * Provider performance monitoring and optimization service
 * Tracks metrics, health, and provides cost optimization recommendations
 */
export class ProviderMonitor {
  private cloudWatch: CloudWatchClient;
  private metrics: Map<string, ProviderMetrics> = new Map();
  private healthChecks: Map<string, ProviderHealthCheck> = new Map();
  private costOptimizer: CostOptimizer;

  constructor() {
    this.cloudWatch = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-east-1' });
    this.costOptimizer = new CostOptimizer();
  }

  /**
   * Record request metrics for a provider
   */
  async recordRequest(
    provider: string,
    request: LLMRequest,
    response: LLMResponse,
    success: boolean,
    error?: Error
  ): Promise<void> {
    const metrics = this.getOrCreateMetrics(provider);
    
    // Update basic metrics
    metrics.totalRequests++;
    metrics.lastRequestTime = new Date();
    
    if (success) {
      metrics.successfulRequests++;
      metrics.totalLatency += response.latency;
      metrics.totalCost += response.cost.total;
      metrics.totalTokens += response.usage.totalTokens;
      
      // Update latency percentiles
      this.updateLatencyPercentiles(metrics, response.latency);
    } else {
      metrics.failedRequests++;
      if (error) {
        metrics.errorsByType.set(error.name, (metrics.errorsByType.get(error.name) || 0) + 1);
      }
    }

    // Send metrics to CloudWatch
    await this.sendCloudWatchMetrics(provider, metrics, response, success);

    logger.debug('Recorded provider metrics', {
      provider,
      success,
      latency: response?.latency,
      cost: response?.cost?.total,
      tokens: response?.usage?.totalTokens,
    });
  }

  /**
   * Perform health check for a provider
   */
  async performHealthCheck(provider: ProviderAdapter): Promise<ProviderHealthStatus> {
    const startTime = Date.now();
    const healthCheck: ProviderHealthCheck = {
      provider: provider.name,
      timestamp: new Date(),
      healthy: false,
      latency: 0,
      details: {},
    };

    try {
      const health = await provider.getHealthStatus();
      healthCheck.healthy = health.healthy;
      healthCheck.latency = Date.now() - startTime;
      healthCheck.details = {
        providerLatency: health.latency,
        errorRate: health.errorRate,
        lastChecked: health.lastChecked,
      };

      // Update health metrics
      this.healthChecks.set(provider.name, healthCheck);

      // Send health metrics to CloudWatch
      await this.sendHealthMetrics(provider.name, healthCheck);

      logger.info('Provider health check completed', {
        provider: provider.name,
        healthy: healthCheck.healthy,
        latency: healthCheck.latency,
      });

      return {
        provider: provider.name,
        healthy: healthCheck.healthy,
        latency: healthCheck.latency,
        lastCheck: healthCheck.timestamp,
        details: healthCheck.details,
      };
    } catch (error) {
      healthCheck.healthy = false;
      healthCheck.latency = Date.now() - startTime;
      healthCheck.details = { error: (error as Error).message };

      this.healthChecks.set(provider.name, healthCheck);

      logger.error('Provider health check failed', error as Error, {
        provider: provider.name,
      });

      return {
        provider: provider.name,
        healthy: false,
        latency: healthCheck.latency,
        lastCheck: healthCheck.timestamp,
        details: healthCheck.details,
      };
    }
  }

  /**
   * Get cost optimization recommendations
   */
  getCostOptimizationRecommendations(
    providers: ProviderAdapter[],
    request: LLMRequest
  ): CostOptimizationRecommendation[] {
    return this.costOptimizer.getRecommendations(providers, request, this.metrics);
  }

  /**
   * Get provider performance statistics
   */
  getProviderStats(provider: string): ProviderStats | null {
    const metrics = this.metrics.get(provider);
    if (!metrics) return null;

    const successRate = metrics.totalRequests > 0 
      ? (metrics.successfulRequests / metrics.totalRequests) * 100 
      : 0;

    const avgLatency = metrics.successfulRequests > 0 
      ? metrics.totalLatency / metrics.successfulRequests 
      : 0;

    const avgCost = metrics.successfulRequests > 0 
      ? metrics.totalCost / metrics.successfulRequests 
      : 0;

    const avgTokens = metrics.successfulRequests > 0 
      ? metrics.totalTokens / metrics.successfulRequests 
      : 0;

    return {
      provider,
      totalRequests: metrics.totalRequests,
      successfulRequests: metrics.successfulRequests,
      failedRequests: metrics.failedRequests,
      successRate,
      avgLatency,
      p95Latency: metrics.p95Latency,
      p99Latency: metrics.p99Latency,
      avgCost,
      totalCost: metrics.totalCost,
      avgTokens,
      totalTokens: metrics.totalTokens,
      errorsByType: Object.fromEntries(metrics.errorsByType),
      lastRequestTime: metrics.lastRequestTime,
    };
  }

  /**
   * Get all provider statistics
   */
  getAllProviderStats(): ProviderStats[] {
    return Array.from(this.metrics.keys())
      .map(provider => this.getProviderStats(provider))
      .filter((stats): stats is ProviderStats => stats !== null);
  }

  /**
   * Reset metrics for a provider
   */
  resetMetrics(provider: string): void {
    this.metrics.delete(provider);
    this.healthChecks.delete(provider);
    logger.info('Reset metrics for provider', { provider });
  }

  private getOrCreateMetrics(provider: string): ProviderMetrics {
    if (!this.metrics.has(provider)) {
      this.metrics.set(provider, {
        provider,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalLatency: 0,
        totalCost: 0,
        totalTokens: 0,
        latencyHistory: [],
        p95Latency: 0,
        p99Latency: 0,
        errorsByType: new Map(),
        lastRequestTime: new Date(),
      });
    }
    return this.metrics.get(provider)!;
  }

  private updateLatencyPercentiles(metrics: ProviderMetrics, latency: number): void {
    metrics.latencyHistory.push(latency);
    
    // Keep only last 1000 latency measurements
    if (metrics.latencyHistory.length > 1000) {
      metrics.latencyHistory = metrics.latencyHistory.slice(-1000);
    }

    // Calculate percentiles
    const sorted = [...metrics.latencyHistory].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);
    
    metrics.p95Latency = sorted[p95Index] || 0;
    metrics.p99Latency = sorted[p99Index] || 0;
  }

  private async sendCloudWatchMetrics(
    provider: string,
    metrics: ProviderMetrics,
    response: LLMResponse,
    success: boolean
  ): Promise<void> {
    try {
      const metricData: MetricDatum[] = [
        {
          MetricName: 'RequestCount',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Provider', Value: provider },
            { Name: 'Success', Value: success.toString() },
          ],
        },
      ];

      if (success && response) {
        metricData.push(
          {
            MetricName: 'Latency',
            Value: response.latency,
            Unit: 'Milliseconds',
            Dimensions: [{ Name: 'Provider', Value: provider }],
          },
          {
            MetricName: 'Cost',
            Value: response.cost.total,
            Unit: 'None',
            Dimensions: [{ Name: 'Provider', Value: provider }],
          },
          {
            MetricName: 'TokenCount',
            Value: response.usage.totalTokens,
            Unit: 'Count',
            Dimensions: [{ Name: 'Provider', Value: provider }],
          }
        );
      }

      const command = new PutMetricDataCommand({
        Namespace: 'AIModelGateway/Providers',
        MetricData: metricData,
      });

      await this.cloudWatch.send(command);
    } catch (error) {
      logger.warn('Failed to send CloudWatch metrics', {
        provider,
        error: (error as Error).message,
      });
    }
  }

  private async sendHealthMetrics(
    provider: string,
    healthCheck: ProviderHealthCheck
  ): Promise<void> {
    try {
      const command = new PutMetricDataCommand({
        Namespace: 'AIModelGateway/Health',
        MetricData: [
          {
            MetricName: 'HealthStatus',
            Value: healthCheck.healthy ? 1 : 0,
            Unit: 'None',
            Dimensions: [{ Name: 'Provider', Value: provider }],
          },
          {
            MetricName: 'HealthCheckLatency',
            Value: healthCheck.latency,
            Unit: 'Milliseconds',
            Dimensions: [{ Name: 'Provider', Value: provider }],
          },
        ],
      });

      await this.cloudWatch.send(command);
    } catch (error) {
      logger.warn('Failed to send health metrics', {
        provider,
        error: (error as Error).message,
      });
    }
  }
}

/**
 * Cost optimization service
 */
class CostOptimizer {
  getRecommendations(
    providers: ProviderAdapter[],
    request: LLMRequest,
    metrics: Map<string, ProviderMetrics>
  ): CostOptimizationRecommendation[] {
    const recommendations: CostOptimizationRecommendation[] = [];

    // Calculate cost estimates for each provider
    const providerCosts = providers.map(provider => ({
      provider: provider.name,
      estimatedCost: provider.estimateCost(request),
      metrics: metrics.get(provider.name),
    }));

    // Sort by cost
    providerCosts.sort((a, b) => a.estimatedCost - b.estimatedCost);

    // Find the cheapest provider
    const cheapest = providerCosts[0];
    if (cheapest) {
      recommendations.push({
        type: 'cost_optimization',
        provider: cheapest.provider,
        estimatedSavings: 0,
        confidence: 0.9,
        reason: 'Lowest cost provider for this request',
        details: {
          estimatedCost: cheapest.estimatedCost,
          alternatives: providerCosts.slice(1, 3).map(p => ({
            provider: p.provider,
            estimatedCost: p.estimatedCost,
            additionalCost: p.estimatedCost - cheapest.estimatedCost,
          })),
        },
      });
    }

    // Check for providers with high error rates
    for (const [providerName, providerMetrics] of metrics) {
      const errorRate = providerMetrics.totalRequests > 0 
        ? (providerMetrics.failedRequests / providerMetrics.totalRequests) * 100 
        : 0;

      if (errorRate > 10) { // More than 10% error rate
        recommendations.push({
          type: 'reliability_warning',
          provider: providerName,
          estimatedSavings: 0,
          confidence: 0.8,
          reason: `High error rate detected (${errorRate.toFixed(1)}%)`,
          details: {
            errorRate,
            totalRequests: providerMetrics.totalRequests,
            failedRequests: providerMetrics.failedRequests,
          },
        });
      }
    }

    return recommendations;
  }
}

// Types
interface ProviderMetrics {
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalLatency: number;
  totalCost: number;
  totalTokens: number;
  latencyHistory: number[];
  p95Latency: number;
  p99Latency: number;
  errorsByType: Map<string, number>;
  lastRequestTime: Date;
}

interface ProviderHealthCheck {
  provider: string;
  timestamp: Date;
  healthy: boolean;
  latency: number;
  details: Record<string, any>;
}

export interface ProviderHealthStatus {
  provider: string;
  healthy: boolean;
  latency: number;
  lastCheck: Date;
  details: Record<string, any>;
}

export interface ProviderStats {
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
  avgCost: number;
  totalCost: number;
  avgTokens: number;
  totalTokens: number;
  errorsByType: Record<string, number>;
  lastRequestTime: Date;
}

export interface CostOptimizationRecommendation {
  type: 'cost_optimization' | 'reliability_warning' | 'performance_optimization';
  provider: string;
  estimatedSavings: number;
  confidence: number;
  reason: string;
  details: Record<string, any>;
}