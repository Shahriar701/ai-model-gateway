import { ProviderAdapter } from './base-provider';
import { Logger } from '../../shared/utils/logger';
import { ProviderMonitor, ProviderHealthStatus } from './provider-monitor';

const logger = new Logger('ProviderHealth');

/**
 * Provider health management service
 * Manages health checks, circuit breakers, and provider availability
 */
export class ProviderHealthService {
  private providers: Map<string, ProviderAdapter> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private healthStatuses: Map<string, ProviderHealthStatus> = new Map();
  private monitor: ProviderMonitor;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(monitor: ProviderMonitor) {
    this.monitor = monitor;
  }

  /**
   * Register a provider for health monitoring
   */
  registerProvider(provider: ProviderAdapter, config?: CircuitBreakerConfig): void {
    this.providers.set(provider.name, provider);
    
    const circuitBreakerConfig: CircuitBreakerConfig = {
      failureThreshold: config?.failureThreshold || 5,
      recoveryTimeout: config?.recoveryTimeout || 60000, // 1 minute
      monitoringPeriod: config?.monitoringPeriod || 300000, // 5 minutes
      ...config,
    };

    this.circuitBreakers.set(provider.name, new CircuitBreaker(provider.name, circuitBreakerConfig));

    logger.info('Registered provider for health monitoring', {
      provider: provider.name,
      circuitBreakerConfig,
    });
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(intervalMs: number = 30000): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.performAllHealthChecks();
    }, intervalMs);

    logger.info('Started periodic health checks', { intervalMs });
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    logger.info('Stopped periodic health checks');
  }

  /**
   * Check if a provider is available (healthy and circuit breaker closed)
   */
  isProviderAvailable(providerName: string): boolean {
    const health = this.healthStatuses.get(providerName);
    const circuitBreaker = this.circuitBreakers.get(providerName);

    if (!health || !circuitBreaker) {
      return false;
    }

    return health.healthy && circuitBreaker.getState() === CircuitBreakerState.CLOSED;
  }

  /**
   * Get provider health status
   */
  getProviderHealth(providerName: string): ProviderHealthStatus | null {
    return this.healthStatuses.get(providerName) || null;
  }

  /**
   * Get all provider health statuses
   */
  getAllProviderHealth(): ProviderHealthStatus[] {
    return Array.from(this.healthStatuses.values());
  }

  /**
   * Record a provider request result for circuit breaker
   */
  recordProviderResult(providerName: string, success: boolean): void {
    const circuitBreaker = this.circuitBreakers.get(providerName);
    if (circuitBreaker) {
      if (success) {
        circuitBreaker.recordSuccess();
      } else {
        circuitBreaker.recordFailure();
      }
    }
  }

  /**
   * Get circuit breaker state for a provider
   */
  getCircuitBreakerState(providerName: string): CircuitBreakerState {
    const circuitBreaker = this.circuitBreakers.get(providerName);
    return circuitBreaker ? circuitBreaker.getState() : CircuitBreakerState.OPEN;
  }

  /**
   * Manually open circuit breaker for a provider
   */
  openCircuitBreaker(providerName: string): void {
    const circuitBreaker = this.circuitBreakers.get(providerName);
    if (circuitBreaker) {
      circuitBreaker.open();
      logger.warn('Manually opened circuit breaker', { provider: providerName });
    }
  }

  /**
   * Manually close circuit breaker for a provider
   */
  closeCircuitBreaker(providerName: string): void {
    const circuitBreaker = this.circuitBreakers.get(providerName);
    if (circuitBreaker) {
      circuitBreaker.close();
      logger.info('Manually closed circuit breaker', { provider: providerName });
    }
  }

  /**
   * Get detailed health report for all providers
   */
  getHealthReport(): ProviderHealthReport {
    const providers: ProviderHealthDetail[] = [];

    for (const [name, provider] of this.providers) {
      const health = this.healthStatuses.get(name);
      const circuitBreaker = this.circuitBreakers.get(name);
      const stats = this.monitor.getProviderStats(name);

      providers.push({
        name,
        type: provider.name, // Assuming provider has type property
        healthy: health?.healthy || false,
        available: this.isProviderAvailable(name),
        circuitBreakerState: circuitBreaker?.getState() || CircuitBreakerState.OPEN,
        lastHealthCheck: health?.lastCheck || new Date(0),
        latency: health?.latency || 0,
        successRate: stats?.successRate || 0,
        errorRate: stats ? ((stats.failedRequests / stats.totalRequests) * 100) : 0,
        totalRequests: stats?.totalRequests || 0,
        details: health?.details || {},
      });
    }

    return {
      timestamp: new Date(),
      overallHealth: this.calculateOverallHealth(providers),
      providers,
    };
  }

  private async performAllHealthChecks(): Promise<void> {
    const healthCheckPromises = Array.from(this.providers.values()).map(async (provider) => {
      try {
        const health = await this.monitor.performHealthCheck(provider);
        this.healthStatuses.set(provider.name, health);
        
        // Update circuit breaker based on health
        if (health.healthy) {
          this.recordProviderResult(provider.name, true);
        } else {
          this.recordProviderResult(provider.name, false);
        }
      } catch (error) {
        logger.error('Health check failed', error as Error, { provider: provider.name });
        this.recordProviderResult(provider.name, false);
      }
    });

    await Promise.allSettled(healthCheckPromises);
  }

  private calculateOverallHealth(providers: ProviderHealthDetail[]): OverallHealthStatus {
    if (providers.length === 0) {
      return OverallHealthStatus.UNKNOWN;
    }

    const healthyCount = providers.filter(p => p.healthy && p.available).length;
    const healthyPercentage = (healthyCount / providers.length) * 100;

    if (healthyPercentage >= 80) {
      return OverallHealthStatus.HEALTHY;
    } else if (healthyPercentage >= 50) {
      return OverallHealthStatus.DEGRADED;
    } else {
      return OverallHealthStatus.UNHEALTHY;
    }
  }
}

/**
 * Circuit breaker implementation
 */
class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private lastFailureTime: Date | null = null;
  private successCount = 0;

  constructor(
    private providerName: string,
    private config: CircuitBreakerConfig
  ) {}

  recordSuccess(): void {
    this.successCount++;
    
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // If we're in half-open state and got a success, close the circuit
      this.close();
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === CircuitBreakerState.CLOSED && 
        this.failureCount >= this.config.failureThreshold) {
      this.open();
    } else if (this.state === CircuitBreakerState.HALF_OPEN) {
      // If we're in half-open state and got a failure, open the circuit
      this.open();
    }
  }

  getState(): CircuitBreakerState {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === CircuitBreakerState.OPEN && this.shouldAttemptReset()) {
      this.state = CircuitBreakerState.HALF_OPEN;
      logger.info('Circuit breaker transitioned to HALF_OPEN', { 
        provider: this.providerName 
      });
    }

    return this.state;
  }

  open(): void {
    this.state = CircuitBreakerState.OPEN;
    logger.warn('Circuit breaker opened', { 
      provider: this.providerName,
      failureCount: this.failureCount,
    });
  }

  close(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    logger.info('Circuit breaker closed', { 
      provider: this.providerName 
    });
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) {
      return false;
    }

    const timeSinceLastFailure = Date.now() - this.lastFailureTime.getTime();
    return timeSinceLastFailure >= this.config.recoveryTimeout;
  }
}

// Types and interfaces
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
}

export enum OverallHealthStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNHEALTHY = 'UNHEALTHY',
  UNKNOWN = 'UNKNOWN',
}

export interface ProviderHealthDetail {
  name: string;
  type: string;
  healthy: boolean;
  available: boolean;
  circuitBreakerState: CircuitBreakerState;
  lastHealthCheck: Date;
  latency: number;
  successRate: number;
  errorRate: number;
  totalRequests: number;
  details: Record<string, any>;
}

export interface ProviderHealthReport {
  timestamp: Date;
  overallHealth: OverallHealthStatus;
  providers: ProviderHealthDetail[];
}