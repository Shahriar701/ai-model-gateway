import { RequestBatcher } from '../../../src/services/cache/request-batcher';
import { CacheManager } from '../../../src/services/cache/cache-manager';
import { LLMRequest, LLMResponse } from '../../../src/shared/types';

describe('RequestBatcher', () => {
  let batcher: RequestBatcher;
  let cacheManager: CacheManager;
  let mockExecutor: jest.Mock;

  beforeEach(() => {
    // Mock cache manager
    cacheManager = {
      getCachedLLMResponse: jest.fn().mockResolvedValue(null),
      cacheLLMResponse: jest.fn().mockResolvedValue(undefined),
      generateRequestHash: jest.fn().mockImplementation((req) => 
        `hash_${req.model}_${JSON.stringify(req.messages)}`
      ),
    } as any;

    // Mock executor
    mockExecutor = jest.fn().mockImplementation(async (request: LLMRequest): Promise<LLMResponse> => ({
      id: 'test-response',
      model: request.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Test response' },
        finishReason: 'stop',
      }],
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      cost: { total: 0.001, promptCost: 0.0005, completionCost: 0.0005, currency: 'USD' },
      latency: 100,
      provider: 'test-provider',
    }));

    batcher = new RequestBatcher({
      maxBatchSize: 3,
      batchTimeoutMs: 50,
      enableDeduplication: true,
    }, cacheManager);

    batcher.setRequestExecutor(mockExecutor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should process single request', async () => {
    const request: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const response = await batcher.processRequest(request);

    expect(response).toBeDefined();
    expect(response.model).toBe('gpt-4');
    expect(mockExecutor).toHaveBeenCalledTimes(1);
  });

  it('should batch identical requests', async () => {
    const request1: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const request2: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    // Process requests simultaneously
    const [response1, response2] = await Promise.all([
      batcher.processRequest(request1),
      batcher.processRequest(request2),
    ]);

    expect(response1).toBeDefined();
    expect(response2).toBeDefined();
    expect(mockExecutor).toHaveBeenCalledTimes(1); // Should only execute once for identical requests
  });

  it('should serve from cache when deduplication is enabled', async () => {
    const cachedResponse = {
      id: 'cached-response',
      model: 'gpt-4',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Cached' }, finishReason: 'stop' }],
      usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
      cost: { total: 0.0005, promptCost: 0.00025, completionCost: 0.00025, currency: 'USD' },
      latency: 50,
      provider: 'cache',
    };

    (cacheManager.getCachedLLMResponse as jest.Mock).mockResolvedValueOnce(cachedResponse);

    const request: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const response = await batcher.processRequest(request);

    expect(response.cached).toBe(true);
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  it('should handle different requests in parallel', async () => {
    const request1: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const request2: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Goodbye' }],
    };

    const [response1, response2] = await Promise.all([
      batcher.processRequest(request1),
      batcher.processRequest(request2),
    ]);

    expect(response1).toBeDefined();
    expect(response2).toBeDefined();
    expect(mockExecutor).toHaveBeenCalledTimes(2); // Should execute both different requests
  });

  it('should provide batching statistics', () => {
    const stats = batcher.getBatchingStats();

    expect(stats).toHaveProperty('pendingBatches');
    expect(stats).toHaveProperty('totalPatterns');
    expect(stats).toHaveProperty('config');
    expect(stats.config.maxBatchSize).toBe(3);
  });
});