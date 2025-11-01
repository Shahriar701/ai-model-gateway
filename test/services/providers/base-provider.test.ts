import { BaseProvider, ProviderHealthStatus } from '../../../src/services/providers/base-provider';
import { LLMRequest, LLMResponse } from '../../../src/shared/types';

// Create a concrete implementation for testing
class TestProvider extends BaseProvider {
  name = 'test-provider';
  protected baseUrl = 'https://api.test.com';
  protected apiKey = 'test-key';

  async generateCompletion(request: LLMRequest): Promise<LLMResponse> {
    return {
      id: 'test-id',
      model: request.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Test response' },
          finishReason: 'stop',
        },
      ],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      cost: { total: 0.01, promptCost: 0.005, completionCost: 0.005, currency: 'USD' },
      latency: 100,
      provider: this.name,
    };
  }

  estimateCost(request: LLMRequest): number {
    return 0.01;
  }

  protected async performHealthCheck(): Promise<void> {
    // Mock health check - always passes
  }
}

describe('BaseProvider', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
  });

  describe('generateRequestId', () => {
    it('should generate unique request IDs', () => {
      const id1 = (provider as any).generateRequestId();
      const id2 = (provider as any).generateRequestId();

      expect(id1).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('calculateTokens', () => {
    it('should estimate tokens correctly', () => {
      const text = 'Hello world';
      const tokens = (provider as any).calculateTokens(text);

      expect(tokens).toBe(Math.ceil(text.length / 4));
    });
  });

  describe('isAvailable', () => {
    it('should return true when health check passes', async () => {
      const isAvailable = await provider.isAvailable();
      expect(isAvailable).toBe(true);
    });

    it('should return false when health check fails', async () => {
      jest
        .spyOn(provider as any, 'performHealthCheck')
        .mockRejectedValue(new Error('Health check failed'));

      const isAvailable = await provider.isAvailable();
      expect(isAvailable).toBe(false);
    });
  });

  describe('getHealthStatus', () => {
    it('should return healthy status when check passes', async () => {
      const status = await provider.getHealthStatus();

      expect(status.healthy).toBe(true);
      expect(status.latency).toBeGreaterThanOrEqual(0);
      expect(status.lastChecked).toBeInstanceOf(Date);
    });

    it('should return unhealthy status when check fails', async () => {
      jest
        .spyOn(provider as any, 'performHealthCheck')
        .mockRejectedValue(new Error('Health check failed'));

      const status = await provider.getHealthStatus();

      expect(status.healthy).toBe(false);
      expect(status.latency).toBeUndefined();
      expect(status.lastChecked).toBeInstanceOf(Date);
    });
  });
});
