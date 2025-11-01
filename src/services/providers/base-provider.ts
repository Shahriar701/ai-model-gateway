import { LLMRequest, LLMResponse } from '../../shared/types';

/**
 * Base interface for LLM provider adapters
 * Ensures consistent implementation across all providers
 */
export interface ProviderAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  generateCompletion(request: LLMRequest): Promise<LLMResponse>;
  estimateCost(request: LLMRequest): number;
  getHealthStatus(): Promise<ProviderHealthStatus>;
}

export interface ProviderHealthStatus {
  healthy: boolean;
  latency?: number;
  errorRate?: number;
  lastChecked: Date;
}

/**
 * Abstract base class for provider implementations
 * Provides common functionality and error handling patterns
 */
export abstract class BaseProvider implements ProviderAdapter {
  abstract name: string;
  protected abstract baseUrl: string;
  protected abstract apiKey: string;

  abstract generateCompletion(request: LLMRequest): Promise<LLMResponse>;
  abstract estimateCost(request: LLMRequest): number;

  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.getHealthStatus();
      return health.healthy;
    } catch {
      return false;
    }
  }

  async getHealthStatus(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();
    
    try {
      // Implement provider-specific health check
      await this.performHealthCheck();
      
      return {
        healthy: true,
        latency: Date.now() - startTime,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        healthy: false,
        lastChecked: new Date()
      };
    }
  }

  protected abstract performHealthCheck(): Promise<void>;

  protected generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  protected calculateTokens(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}