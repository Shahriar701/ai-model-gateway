import { OpenAIProvider } from './openai-provider';
import { BedrockProvider } from './bedrock-provider';
import { ProviderMonitor } from './provider-monitor';
import { ProviderHealthService } from './provider-health';
import { ProviderDashboard } from './provider-dashboard';
import { ProviderRouter } from '../router/provider-router';
import { LLMRequest, ProviderConfig, ProviderType } from '../../shared/types';
import { Logger } from '../../shared/utils/logger';

const logger = new Logger('ProviderIntegrationExample');

/**
 * Example integration showing how to set up the complete provider monitoring system
 * This demonstrates the integration of all provider components
 */
export class ProviderIntegrationExample {
  private monitor: ProviderMonitor;
  private healthService: ProviderHealthService;
  private dashboard: ProviderDashboard;
  private router: ProviderRouter;

  constructor() {
    // Initialize monitoring components
    this.monitor = new ProviderMonitor();
    this.healthService = new ProviderHealthService(this.monitor);
    this.dashboard = new ProviderDashboard(this.monitor, this.healthService);

    // Initialize providers
    const providers = [
      new OpenAIProvider(),
      new BedrockProvider(),
    ];

    // Configure providers
    const configs: ProviderConfig[] = [
      {
        name: 'openai',
        type: ProviderType.OPENAI,
        enabled: true,
        priority: 1,
        maxConcurrency: 10,
        timeout: 30000,
        retryAttempts: 3,
        retryDelay: 1000,
        healthCheckInterval: 30000,
        costPerInputToken: 0.0015,
        costPerOutputToken: 0.002,
        models: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'],
      },
      {
        name: 'bedrock',
        type: ProviderType.BEDROCK,
        enabled: true,
        priority: 2,
        maxConcurrency: 5,
        timeout: 45000,
        retryAttempts: 2,
        retryDelay: 2000,
        healthCheckInterval: 60000,
        costPerInputToken: 0.008,
        costPerOutputToken: 0.024,
        models: [
          'anthropic.claude-v2',
          'anthropic.claude-3-sonnet-20240229-v1:0',
          'anthropic.claude-3-haiku-20240307-v1:0',
          'meta.llama2-70b-chat-v1',
          'amazon.titan-text-express-v1',
        ],
      },
    ];

    // Initialize router with monitoring
    this.router = new ProviderRouter(providers, configs, this.monitor, this.healthService);

    logger.info('Provider integration initialized', {
      providers: providers.length,
      configs: configs.length,
    });
  }

  /**
   * Example: Process a request with full monitoring
   */
  async processRequest(request: LLMRequest): Promise<any> {
    try {
      logger.info('Processing request with monitoring', {
        model: request.model,
        messageCount: request.messages.length,
      });

      // Route request through the monitored system
      const response = await this.router.routeRequest(request);

      // Get real-time metrics
      const dashboardData = this.dashboard.getDashboardData();
      
      logger.info('Request processed successfully', {
        provider: response.provider,
        latency: response.latency,
        cost: response.cost.total,
        activeProviders: dashboardData.summary.activeProviders,
      });

      return {
        response,
        metrics: {
          latency: response.latency,
          cost: response.cost.total,
          provider: response.provider,
        },
      };
    } catch (error) {
      logger.error('Request processing failed', error as Error);
      throw error;
    }
  }

  /**
   * Example: Get comprehensive monitoring data
   */
  getMonitoringData() {
    return {
      dashboard: this.dashboard.getDashboardData(),
      performance: this.dashboard.getPerformanceMetrics(),
      costAnalysis: this.dashboard.getCostAnalysis(),
      reliability: this.dashboard.getReliabilityReport(),
      healthReport: this.healthService.getHealthReport(),
    };
  }

  /**
   * Example: Get cost optimization recommendations
   */
  getCostOptimizations(request: LLMRequest) {
    const providers = Array.from(this.router['providers'].values());
    return this.monitor.getCostOptimizationRecommendations(providers, request);
  }

  /**
   * Example: Simulate load testing with monitoring
   */
  async simulateLoad(requestCount: number = 100): Promise<void> {
    logger.info('Starting load simulation', { requestCount });

    const testRequest: LLMRequest = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: 'Hello, this is a test message for load testing.' },
      ],
      maxTokens: 50,
      temperature: 0.7,
    };

    const promises = Array.from({ length: requestCount }, async (_, i) => {
      try {
        await this.processRequest({
          ...testRequest,
          messages: [
            { 
              role: 'user', 
              content: `Test message ${i + 1}: ${testRequest.messages[0].content}` 
            },
          ],
        });
      } catch (error) {
        logger.warn('Load test request failed', { requestIndex: i, error: (error as Error).message });
      }
    });

    await Promise.allSettled(promises);

    // Get final metrics
    const finalMetrics = this.getMonitoringData();
    
    logger.info('Load simulation completed', {
      requestCount,
      totalRequests: finalMetrics.dashboard.summary.totalRequests,
      successRate: finalMetrics.dashboard.summary.overallSuccessRate,
      totalCost: finalMetrics.dashboard.summary.totalCost,
      avgLatency: finalMetrics.dashboard.summary.avgLatency,
    });
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    this.healthService.stopHealthChecks();
    logger.info('Provider integration shutdown completed');
  }
}

/**
 * Example usage function
 */
export async function runProviderIntegrationExample(): Promise<void> {
  const integration = new ProviderIntegrationExample();

  try {
    // Example request
    const testRequest: LLMRequest = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
      maxTokens: 100,
      temperature: 0.7,
    };

    // Process single request
    const result = await integration.processRequest(testRequest);
    console.log('Single request result:', result);

    // Get monitoring data
    const monitoringData = integration.getMonitoringData();
    console.log('Monitoring data:', JSON.stringify(monitoringData, null, 2));

    // Get cost optimizations
    const optimizations = integration.getCostOptimizations(testRequest);
    console.log('Cost optimizations:', optimizations);

    // Run load test (optional - uncomment to run)
    // await integration.simulateLoad(10);

  } catch (error) {
    console.error('Integration example failed:', error);
  } finally {
    await integration.shutdown();
  }
}

// Export for use in other modules
export default ProviderIntegrationExample;