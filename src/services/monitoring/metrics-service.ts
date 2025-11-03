import { CloudWatch } from 'aws-sdk';
import { Logger } from '../../shared/utils';
import { LLMRequest, LLMResponse, ProviderType, RequestMetrics } from '../../shared/types';

/**
 * CloudWatch metrics service for comprehensive observability
 * Tracks latency, throughput, costs, and custom business metrics
 */
export class MetricsService {
  private static instance: MetricsService;
  private cloudWatch: CloudWatch;
  private logger: Logger;
  private namespace: string;
  private batchedMetrics: CloudWatch.MetricDatum[] = [];
  private batchTimer?: NodeJS.Timeout;

  // Batch configuration
  private static readonly BATCH_SIZE = 20;
  private static readonly BATCH_TIMEOUT_MS = 5000;

  private constructor() {
    this.cloudWatch = new CloudWatch({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.logger = new Logger('MetricsService');
    this.namespace = process.env.CLOUDWATCH_NAMESPACE || 'AIModelGateway';
  }

  static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  /**
   * Record request metrics for a completed LLM request
   */
  async recordRequestMetrics(
    request: LLMRequest,
    response: LLMResponse,
    correlationId: string,
    userId?: string,
    cached: boolean = false
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = this.createBaseDimensions(response.provider, request.model, userId);

      // Core performance metrics
      this.addMetric('RequestLatency', response.latency, 'Milliseconds', dimensions, timestamp);
      this.addMetric('RequestCount', 1, 'Count', dimensions, timestamp);
      this.addMetric('TokensUsed', response.usage.totalTokens, 'Count', dimensions, timestamp);
      this.addMetric('PromptTokens', response.usage.promptTokens, 'Count', dimensions, timestamp);
      this.addMetric('CompletionTokens', response.usage.completionTokens, 'Count', dimensions, timestamp);

      // Cost metrics
      this.addMetric('RequestCost', response.cost.total, 'None', dimensions, timestamp);
      this.addMetric('PromptCost', response.cost.promptCost, 'None', dimensions, timestamp);
      this.addMetric('CompletionCost', response.cost.completionCost, 'None', dimensions, timestamp);

      // Cache metrics
      if (cached) {
        this.addMetric('CacheHit', 1, 'Count', dimensions, timestamp);
      } else {
        this.addMetric('CacheMiss', 1, 'Count', dimensions, timestamp);
      }

      // Request characteristics
      const messageCount = request.messages.length;
      const totalMessageLength = request.messages.reduce((sum, msg) => sum + msg.content.length, 0);
      
      this.addMetric('MessageCount', messageCount, 'Count', dimensions, timestamp);
      this.addMetric('MessageLength', totalMessageLength, 'Count', dimensions, timestamp);

      // MCP context metrics
      if (request.mcpContext) {
        const mcpDimensions = [...dimensions, { Name: 'MCPEnabled', Value: 'true' }];
        this.addMetric('MCPContextRequests', 1, 'Count', mcpDimensions, timestamp);
        
        if (request.metadata?.mcpToolCalls?.length) {
          this.addMetric('MCPToolCalls', request.metadata.mcpToolCalls.length, 'Count', mcpDimensions, timestamp);
        }
      }

      // Success metrics
      this.addMetric('SuccessfulRequests', 1, 'Count', dimensions, timestamp);

      this.logger.debug('Request metrics recorded', {
        correlationId,
        provider: response.provider,
        model: request.model,
        latency: response.latency,
        cost: response.cost.total,
        tokens: response.usage.totalTokens,
        cached,
      });

    } catch (error) {
      this.logger.error('Failed to record request metrics', error as Error, { correlationId });
    }
  }

  /**
   * Record error metrics for failed requests
   */
  async recordErrorMetrics(
    provider: string,
    model: string,
    errorType: string,
    correlationId: string,
    userId?: string,
    latency?: number
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = this.createBaseDimensions(provider, model, userId);
      const errorDimensions = [...dimensions, { Name: 'ErrorType', Value: errorType }];

      this.addMetric('ErrorCount', 1, 'Count', errorDimensions, timestamp);
      this.addMetric('FailedRequests', 1, 'Count', dimensions, timestamp);

      if (latency !== undefined) {
        this.addMetric('ErrorLatency', latency, 'Milliseconds', errorDimensions, timestamp);
      }

      this.logger.debug('Error metrics recorded', {
        correlationId,
        provider,
        model,
        errorType,
        latency,
      });

    } catch (error) {
      this.logger.error('Failed to record error metrics', error as Error, { correlationId });
    }
  }

  /**
   * Record authentication metrics
   */
  async recordAuthMetrics(
    success: boolean,
    tier: string,
    correlationId: string,
    latency?: number
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [
        { Name: 'Tier', Value: tier },
        { Name: 'AuthResult', Value: success ? 'Success' : 'Failure' },
      ];

      this.addMetric('AuthenticationAttempts', 1, 'Count', dimensions, timestamp);

      if (latency !== undefined) {
        this.addMetric('AuthenticationLatency', latency, 'Milliseconds', dimensions, timestamp);
      }

      if (!success) {
        this.addMetric('AuthenticationFailures', 1, 'Count', dimensions, timestamp);
      }

    } catch (error) {
      this.logger.error('Failed to record auth metrics', error as Error, { correlationId });
    }
  }

  /**
   * Record rate limiting metrics
   */
  async recordRateLimitMetrics(
    userId: string,
    tier: string,
    allowed: boolean,
    remaining: number,
    correlationId: string
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [
        { Name: 'Tier', Value: tier },
        { Name: 'RateLimitResult', Value: allowed ? 'Allowed' : 'Exceeded' },
      ];

      this.addMetric('RateLimitChecks', 1, 'Count', dimensions, timestamp);
      this.addMetric('RateLimitRemaining', remaining, 'Count', dimensions, timestamp);

      if (!allowed) {
        this.addMetric('RateLimitExceeded', 1, 'Count', dimensions, timestamp);
      }

    } catch (error) {
      this.logger.error('Failed to record rate limit metrics', error as Error, { correlationId });
    }
  }

  /**
   * Record provider health metrics
   */
  async recordProviderHealthMetrics(
    provider: string,
    healthy: boolean,
    latency: number,
    errorRate: number,
    correlationId: string
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [
        { Name: 'Provider', Value: provider },
        { Name: 'HealthStatus', Value: healthy ? 'Healthy' : 'Unhealthy' },
      ];

      this.addMetric('ProviderHealth', healthy ? 1 : 0, 'None', dimensions, timestamp);
      this.addMetric('ProviderLatency', latency, 'Milliseconds', dimensions, timestamp);
      this.addMetric('ProviderErrorRate', errorRate, 'Percent', dimensions, timestamp);

    } catch (error) {
      this.logger.error('Failed to record provider health metrics', error as Error, { correlationId });
    }
  }

  /**
   * Record cache performance metrics
   */
  async recordCacheMetrics(
    operation: 'hit' | 'miss' | 'set' | 'evict',
    latency: number,
    correlationId: string
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [{ Name: 'CacheOperation', Value: operation }];

      this.addMetric('CacheOperations', 1, 'Count', dimensions, timestamp);
      this.addMetric('CacheLatency', latency, 'Milliseconds', dimensions, timestamp);

    } catch (error) {
      this.logger.error('Failed to record cache metrics', error as Error, { correlationId });
    }
  }

  /**
   * Record business metrics for cost optimization
   */
  async recordBusinessMetrics(
    totalCost: number,
    requestCount: number,
    averageLatency: number,
    period: 'hour' | 'day',
    correlationId: string
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [{ Name: 'Period', Value: period }];

      this.addMetric('TotalCost', totalCost, 'None', dimensions, timestamp);
      this.addMetric('TotalRequests', requestCount, 'Count', dimensions, timestamp);
      this.addMetric('AverageLatency', averageLatency, 'Milliseconds', dimensions, timestamp);
      this.addMetric('CostPerRequest', totalCost / Math.max(requestCount, 1), 'None', dimensions, timestamp);

    } catch (error) {
      this.logger.error('Failed to record business metrics', error as Error, { correlationId });
    }
  }

  /**
   * Record security metrics
   */
  async recordSecurityMetrics(
    eventType: string,
    severity: string,
    sourceIp?: string,
    correlationId?: string
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [
        { Name: 'SecurityEventType', Value: eventType },
        { Name: 'Severity', Value: severity },
      ];

      if (sourceIp) {
        // Anonymize IP for privacy while maintaining geographic info
        const anonymizedIp = this.anonymizeIp(sourceIp);
        dimensions.push({ Name: 'SourceRegion', Value: anonymizedIp });
      }

      this.addMetric('SecurityEvents', 1, 'Count', dimensions, timestamp);

    } catch (error) {
      this.logger.error('Failed to record security metrics', error as Error, { correlationId });
    }
  }

  /**
   * Add metric to batch for efficient publishing
   */
  private addMetric(
    metricName: string,
    value: number,
    unit: string,
    dimensions: CloudWatch.Dimension[],
    timestamp: Date
  ): void {
    const metric: CloudWatch.MetricDatum = {
      MetricName: metricName,
      Value: value,
      Unit: unit as CloudWatch.StandardUnit,
      Dimensions: dimensions,
      Timestamp: timestamp,
    };

    this.batchedMetrics.push(metric);

    // Publish batch if it's full
    if (this.batchedMetrics.length >= MetricsService.BATCH_SIZE) {
      this.publishBatch();
    } else if (!this.batchTimer) {
      // Set timer to publish batch after timeout
      this.batchTimer = setTimeout(() => {
        this.publishBatch();
      }, MetricsService.BATCH_TIMEOUT_MS);
    }
  }

  /**
   * Publish batched metrics to CloudWatch
   */
  private async publishBatch(): Promise<void> {
    if (this.batchedMetrics.length === 0) {
      return;
    }

    const metricsToPublish = [...this.batchedMetrics];
    this.batchedMetrics = [];

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    try {
      await this.cloudWatch.putMetricData({
        Namespace: this.namespace,
        MetricData: metricsToPublish,
      }).promise();

      this.logger.debug('Published metrics batch', {
        count: metricsToPublish.length,
        namespace: this.namespace,
      });

    } catch (error) {
      this.logger.error('Failed to publish metrics batch', error as Error, {
        count: metricsToPublish.length,
        namespace: this.namespace,
      });

      // Re-add failed metrics to batch for retry
      this.batchedMetrics.unshift(...metricsToPublish);
    }
  }

  /**
   * Create base dimensions for consistent metric tagging
   */
  private createBaseDimensions(
    provider: string,
    model: string,
    userId?: string
  ): CloudWatch.Dimension[] {
    const dimensions: CloudWatch.Dimension[] = [
      { Name: 'Provider', Value: provider },
      { Name: 'Model', Value: model },
      { Name: 'Environment', Value: process.env.NODE_ENV || 'development' },
    ];

    if (userId) {
      // Hash user ID for privacy while maintaining uniqueness
      const hashedUserId = this.hashUserId(userId);
      dimensions.push({ Name: 'UserTier', Value: hashedUserId });
    }

    return dimensions;
  }

  /**
   * Hash user ID for privacy-preserving metrics
   */
  private hashUserId(userId: string): string {
    // Simple hash for demo - in production use proper crypto
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `user_${Math.abs(hash) % 1000}`;
  }

  /**
   * Anonymize IP address for privacy
   */
  private anonymizeIp(ip: string): string {
    const parts = ip.split('.');
    if (parts.length === 4) {
      // IPv4: Keep first two octets, zero out last two
      return `${parts[0]}.${parts[1]}.0.0`;
    }
    // For IPv6 or other formats, return generic region
    return 'unknown';
  }

  /**
   * Flush any remaining metrics on shutdown
   */
  async flush(): Promise<void> {
    if (this.batchedMetrics.length > 0) {
      await this.publishBatch();
    }
  }

  /**
   * Get current metrics statistics for debugging
   */
  /**
   * Record MCP tool execution metrics
   */
  async recordMCPToolMetrics(
    toolName: string,
    success: boolean,
    executionTime: number,
    correlationId?: string
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [
        { Name: 'ToolName', Value: toolName },
        { Name: 'Success', Value: success.toString() },
      ];

      this.addMetric('MCPToolExecutions', 1, 'Count', dimensions, timestamp);
      this.addMetric('MCPToolExecutionTime', executionTime, 'Milliseconds', dimensions, timestamp);

      if (!success) {
        this.addMetric('MCPToolFailures', 1, 'Count', dimensions, timestamp);
      }

    } catch (error) {
      this.logger.error('Failed to record MCP tool metrics', error as Error, { correlationId });
    }
  }

  /**
   * Record MCP context injection metrics
   */
  async recordMCPContextMetrics(
    totalTools: number,
    executedTools: number,
    failedTools: number,
    executionTime: number,
    correlationId?: string
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [
        { Name: 'ContextInjection', Value: 'true' },
      ];

      this.addMetric('MCPContextInjections', 1, 'Count', dimensions, timestamp);
      this.addMetric('MCPContextExecutionTime', executionTime, 'Milliseconds', dimensions, timestamp);
      this.addMetric('MCPToolsExecuted', executedTools, 'Count', dimensions, timestamp);
      this.addMetric('MCPToolsFailed', failedTools, 'Count', dimensions, timestamp);
      this.addMetric('MCPSuccessRate', executedTools / Math.max(totalTools, 1), 'Percent', dimensions, timestamp);

    } catch (error) {
      this.logger.error('Failed to record MCP context metrics', error as Error, { correlationId });
    }
  }

  /**
   * Record MCP error metrics
   */
  async recordMCPErrorMetrics(
    errorType: string,
    errorMessage: string,
    correlationId?: string
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [
        { Name: 'MCPErrorType', Value: errorType },
      ];

      this.addMetric('MCPErrors', 1, 'Count', dimensions, timestamp);

    } catch (error) {
      this.logger.error('Failed to record MCP error metrics', error as Error, { correlationId });
    }
  }

  getMetricsStats(): {
    batchedCount: number;
    namespace: string;
    batchSize: number;
    batchTimeout: number;
  } {
    return {
      batchedCount: this.batchedMetrics.length,
      namespace: this.namespace,
      batchSize: MetricsService.BATCH_SIZE,
      batchTimeout: MetricsService.BATCH_TIMEOUT_MS,
    };
  }

  /**
   * Record MCP tool execution metrics
   */
  async recordMCPToolMetrics(
    toolName: string,
    success: boolean,
    executionTime: number,
    correlationId?: string
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [
        { Name: 'ToolName', Value: toolName },
        { Name: 'Success', Value: success.toString() },
      ];

      this.addMetric('MCPToolExecutions', 1, 'Count', dimensions, timestamp);
      this.addMetric('MCPToolExecutionTime', executionTime, 'Milliseconds', dimensions, timestamp);

      if (!success) {
        this.addMetric('MCPToolErrors', 1, 'Count', dimensions, timestamp);
      }

    } catch (error) {
      this.logger.error('Failed to record MCP tool metrics', error as Error, { correlationId });
    }
  }

  /**
   * Record MCP context injection metrics
   */
  async recordMCPContextMetrics(
    totalTools: number,
    executedTools: number,
    failedTools: number,
    executionTime: number,
    correlationId?: string
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [{ Name: 'MCPOperation', Value: 'ContextInjection' }];

      this.addMetric('MCPContextInjections', 1, 'Count', dimensions, timestamp);
      this.addMetric('MCPContextExecutionTime', executionTime, 'Milliseconds', dimensions, timestamp);
      this.addMetric('MCPToolsExecuted', executedTools, 'Count', dimensions, timestamp);
      this.addMetric('MCPToolsFailed', failedTools, 'Count', dimensions, timestamp);
      this.addMetric('MCPSuccessRate', (executedTools / Math.max(totalTools, 1)) * 100, 'Percent', dimensions, timestamp);

    } catch (error) {
      this.logger.error('Failed to record MCP context metrics', error as Error, { correlationId });
    }
  }

  /**
   * Record MCP error metrics
   */
  async recordMCPErrorMetrics(
    errorType: string,
    errorMessage: string,
    correlationId?: string
  ): Promise<void> {
    try {
      const timestamp = new Date();
      const dimensions = [
        { Name: 'MCPErrorType', Value: errorType },
        { Name: 'ErrorCategory', Value: this.categorizeError(errorMessage) },
      ];

      this.addMetric('MCPErrors', 1, 'Count', dimensions, timestamp);

    } catch (error) {
      this.logger.error('Failed to record MCP error metrics', error as Error, { correlationId });
    }
  }

  /**
   * Categorize error for better metrics grouping
   */
  private categorizeError(errorMessage: string): string {
    if (errorMessage.includes('timeout')) return 'Timeout';
    if (errorMessage.includes('network') || errorMessage.includes('connection')) return 'Network';
    if (errorMessage.includes('validation')) return 'Validation';
    if (errorMessage.includes('authentication')) return 'Authentication';
    return 'Unknown';
  }
}