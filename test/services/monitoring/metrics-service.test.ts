import { MetricsService } from '../../../src/services/monitoring/metrics-service';
import { LLMRequest, LLMResponse } from '../../../src/shared/types';

// Mock AWS SDK
jest.mock('aws-sdk', () => ({
  CloudWatch: jest.fn().mockImplementation(() => ({
    putMetricData: jest.fn().mockReturnValue({
      promise: () => Promise.resolve({}),
    }),
  })),
}));

describe('MetricsService', () => {
  let metricsService: MetricsService;
  let mockCloudWatch: any;

  beforeEach(() => {
    // Reset singleton
    (MetricsService as any).instance = undefined;
    metricsService = MetricsService.getInstance();
    
    // Get mock CloudWatch instance
    const AWS = require('aws-sdk');
    mockCloudWatch = new AWS.CloudWatch();
    (metricsService as any).cloudWatch = mockCloudWatch;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordRequestMetrics', () => {
    it('should record comprehensive request metrics', async () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'user', content: 'Hello world' },
        ],
        temperature: 0.7,
        maxTokens: 100,
      };

      const response: LLMResponse = {
        id: 'test-response',
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello! How can I help you?' },
            finishReason: 'stop',
          },
        ],
        usage: {
          promptTokens: 10,
          completionTokens: 15,
          totalTokens: 25,
        },
        cost: {
          total: 0.001,
          promptCost: 0.0003,
          completionCost: 0.0007,
          currency: 'USD',
        },
        latency: 1500,
        provider: 'openai',
      };

      await metricsService.recordRequestMetrics(
        request,
        response,
        'test-correlation-id',
        'test-user',
        false
      );

      // Verify metrics were batched (not immediately sent)
      const batchedMetrics = (metricsService as any).batchedMetrics;
      expect(batchedMetrics.length).toBeGreaterThan(0);

      // Check that key metrics are included
      const metricNames = batchedMetrics.map((m: any) => m.MetricName);
      expect(metricNames).toContain('RequestLatency');
      expect(metricNames).toContain('RequestCount');
      expect(metricNames).toContain('TokensUsed');
      expect(metricNames).toContain('RequestCost');
      expect(metricNames).toContain('CacheMiss');
    });

    it('should record cache hit metrics when cached', async () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response: LLMResponse = {
        id: 'test-response',
        model: 'gpt-4',
        choices: [],
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
        cost: { total: 0.0005, promptCost: 0.0002, completionCost: 0.0003, currency: 'USD' },
        latency: 100,
        provider: 'openai',
      };

      await metricsService.recordRequestMetrics(
        request,
        response,
        'test-correlation-id',
        'test-user',
        true // cached
      );

      const batchedMetrics = (metricsService as any).batchedMetrics;
      const metricNames = batchedMetrics.map((m: any) => m.MetricName);
      expect(metricNames).toContain('CacheHit');
      expect(metricNames).not.toContain('CacheMiss');
    });
  });
});  desc
ribe('recordErrorMetrics', () => {
    it('should record error metrics with proper dimensions', async () => {
      await metricsService.recordErrorMetrics(
        'openai',
        'gpt-4',
        'RATE_LIMIT_EXCEEDED',
        'test-correlation-id',
        'test-user',
        2000
      );

      const batchedMetrics = (metricsService as any).batchedMetrics;
      const errorMetrics = batchedMetrics.filter((m: any) => 
        m.MetricName === 'ErrorCount' || m.MetricName === 'FailedRequests'
      );

      expect(errorMetrics.length).toBeGreaterThan(0);
      
      const errorCountMetric = batchedMetrics.find((m: any) => m.MetricName === 'ErrorCount');
      expect(errorCountMetric).toBeDefined();
      expect(errorCountMetric.Dimensions).toContainEqual({
        Name: 'ErrorType',
        Value: 'RATE_LIMIT_EXCEEDED',
      });
    });
  });

  describe('recordAuthMetrics', () => {
    it('should record successful authentication metrics', async () => {
      await metricsService.recordAuthMetrics(
        true,
        'premium',
        'test-correlation-id',
        500
      );

      const batchedMetrics = (metricsService as any).batchedMetrics;
      const authMetrics = batchedMetrics.filter((m: any) => 
        m.MetricName === 'AuthenticationAttempts'
      );

      expect(authMetrics.length).toBeGreaterThan(0);
      
      const authMetric = authMetrics[0];
      expect(authMetric.Dimensions).toContainEqual({
        Name: 'AuthResult',
        Value: 'Success',
      });
      expect(authMetric.Dimensions).toContainEqual({
        Name: 'Tier',
        Value: 'premium',
      });
    });

    it('should record failed authentication metrics', async () => {
      await metricsService.recordAuthMetrics(
        false,
        'free',
        'test-correlation-id',
        200
      );

      const batchedMetrics = (metricsService as any).batchedMetrics;
      const failureMetrics = batchedMetrics.filter((m: any) => 
        m.MetricName === 'AuthenticationFailures'
      );

      expect(failureMetrics.length).toBeGreaterThan(0);
    });
  });

  describe('batch publishing', () => {
    it('should publish metrics when batch size is reached', async () => {
      // Fill up the batch
      const batchSize = (MetricsService as any).BATCH_SIZE;
      
      for (let i = 0; i < batchSize; i++) {
        await metricsService.recordAuthMetrics(true, 'free', `correlation-${i}`);
      }

      // Should have triggered a publish
      expect(mockCloudWatch.putMetricData).toHaveBeenCalled();
    });

    it('should publish metrics on timeout', async () => {
      jest.useFakeTimers();
      
      // Add one metric
      await metricsService.recordAuthMetrics(true, 'free', 'test-correlation-id');
      
      // Fast-forward time to trigger timeout
      const batchTimeout = (MetricsService as any).BATCH_TIMEOUT_MS;
      jest.advanceTimersByTime(batchTimeout + 100);
      
      // Wait for async operations
      await new Promise(resolve => setImmediate(resolve));
      
      expect(mockCloudWatch.putMetricData).toHaveBeenCalled();
      
      jest.useRealTimers();
    });
  });

  describe('getMetricsStats', () => {
    it('should return current metrics statistics', () => {
      const stats = metricsService.getMetricsStats();
      
      expect(stats).toHaveProperty('batchedCount');
      expect(stats).toHaveProperty('namespace');
      expect(stats).toHaveProperty('batchSize');
      expect(stats).toHaveProperty('batchTimeout');
      expect(typeof stats.batchedCount).toBe('number');
      expect(typeof stats.namespace).toBe('string');
    });
  });

  describe('flush', () => {
    it('should publish remaining batched metrics', async () => {
      // Add some metrics
      await metricsService.recordAuthMetrics(true, 'free', 'test-correlation-id');
      
      // Flush should publish them
      await metricsService.flush();
      
      expect(mockCloudWatch.putMetricData).toHaveBeenCalled();
    });
  });

  describe('dimension creation', () => {
    it('should create consistent base dimensions', () => {
      const createBaseDimensions = (metricsService as any).createBaseDimensions;
      
      const dimensions = createBaseDimensions('openai', 'gpt-4', 'test-user');
      
      expect(dimensions).toContainEqual({ Name: 'Provider', Value: 'openai' });
      expect(dimensions).toContainEqual({ Name: 'Model', Value: 'gpt-4' });
      expect(dimensions).toContainEqual({ Name: 'Environment', Value: 'test' });
      
      // Should have hashed user tier
      const userTierDimension = dimensions.find((d: any) => d.Name === 'UserTier');
      expect(userTierDimension).toBeDefined();
      expect(userTierDimension.Value).toMatch(/^user_\d+$/);
    });

    it('should handle missing user ID gracefully', () => {
      const createBaseDimensions = (metricsService as any).createBaseDimensions;
      
      const dimensions = createBaseDimensions('openai', 'gpt-4');
      
      expect(dimensions).toContainEqual({ Name: 'Provider', Value: 'openai' });
      expect(dimensions).toContainEqual({ Name: 'Model', Value: 'gpt-4' });
      expect(dimensions).toContainEqual({ Name: 'Environment', Value: 'test' });
      
      // Should not have user tier dimension
      const userTierDimension = dimensions.find((d: any) => d.Name === 'UserTier');
      expect(userTierDimension).toBeUndefined();
    });
  });
});