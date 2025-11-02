import { BatchedGatewayService } from '../../../src/services/cache/batched-gateway-service';
import { ProviderRouter } from '../../../src/services/router/provider-router';
import { LLMRequest, LLMResponse, RoutingStrategy } from '../../../src/shared/types';

describe('BatchedGatewayService', () => {
  let gatewayService: BatchedGatewayService;
  let mockProviderRouter: jest.Mocked<ProviderRouter>;

  beforeEach(() => {
    // Mock provider router
    mockProviderRouter = {
      routeRequest: jest.fn().mockImplementation(async (request: LLMRequest): Promise<LLMResponse> => ({
        id: 'test-response',
        model: request.model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Test response' },
          finishReason: 'stop',
        }],
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        cost: { total: 0.002, promptCost: 0.001, completionCost: 0.001, currency: 'USD' },
        latency: 150,
        provider: 'test-provider',
      })),
      getProviderMetrics: jest.fn().mockReturnValue(new Map([
        ['openai', { requestCount: 10, totalCost: 0.05, totalLatency: 1000 }],
        ['bedrock', { requestCount: 5, totalCost: 0.02, totalLatency: 800 }],
      ])),
    } as any;

    gatewayService = new BatchedGatewayService(mockProviderRouter, {
      batchConfig: {
        maxBatchSize: 3,
        batchTimeoutMs: 50,
        enableDeduplication: true,
      },
      enableIntelligentRouting: true,
      costOptimizationThreshold: 0.001,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should process request with batching', async () => {
    const request: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const response = await gatewayService.processRequest(request);

    expect(response).toBeDefined();
    expect(response.model).toBe('gpt-4');
    expect(mockProviderRouter.routeRequest).toHaveBeenCalledTimes(1);
  });

  it('should apply intelligent routing criteria', async () => {
    const request: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 400,
    };

    await gatewayService.processRequest(request);

    const routerCall = mockProviderRouter.routeRequest.mock.calls[0];
    const criteria = routerCall[1];

    expect(criteria).toBeDefined();
    expect(criteria.strategy).toBe(RoutingStrategy.COST_OPTIMIZED); // Default strategy when no historical data
    expect(criteria.preferredProviders).toBeDefined(); // Should have cost-based preferences
  });

  it('should provide optimization statistics', () => {
    const stats = gatewayService.getOptimizationStats();

    expect(stats).toHaveProperty('batching');
    expect(stats).toHaveProperty('caching');
    expect(stats).toHaveProperty('optimization');
    expect(stats.optimization.intelligentRoutingEnabled).toBe(true);
  });

  it('should handle cost optimization for expensive requests', async () => {
    // First, make a request to establish metrics
    const expensiveRequest: LLMRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'This is a longer message that might be more expensive to process' }],
      maxTokens: 2000,
    };

    // Mock expensive response
    mockProviderRouter.routeRequest.mockResolvedValueOnce({
      id: 'expensive-response',
      model: 'gpt-4',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Expensive response' }, finishReason: 'stop' }],
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
      cost: { total: 0.01, promptCost: 0.005, completionCost: 0.005, currency: 'USD' },
      latency: 300,
      provider: 'openai',
    });

    const response = await gatewayService.processRequest(expensiveRequest);

    expect(response.cost.total).toBeGreaterThan(0.001); // Above threshold
    expect(mockProviderRouter.routeRequest).toHaveBeenCalledTimes(1);
  });

  it('should update configuration at runtime', () => {
    const newConfig = {
      enableIntelligentRouting: false,
      costOptimizationThreshold: 0.005,
    };

    gatewayService.updateConfig(newConfig);

    const stats = gatewayService.getOptimizationStats();
    expect(stats.optimization.intelligentRoutingEnabled).toBe(false);
    expect(stats.optimization.costThreshold).toBe(0.005);
  });
});