import { Logger } from '../../shared/utils';
import { SystemHealth, ProviderHealthMetrics } from '../../shared/types';
import { ProviderRouter } from '../router';
import { CacheManager } from '../cache/cache-manager';
import { ProductService } from '../mcp/product-service';

/**
 * Comprehensive health check service for all system components
 * Provides detailed health status for operational monitoring
 */
export class HealthService {
  private static instance: HealthService;
  private logger: Logger;
  private providerRouter?: ProviderRouter;
  private cacheManager?: CacheManager;
  private productService?: ProductService;

  private constructor() {
    this.logger = new Logger('HealthService');
  }

  static getInstance(): HealthService {
    if (!HealthService.instance) {
      HealthService.instance = new HealthService();
    }
    return HealthService.instance;
  }

  /**
   * Initialize health service with dependencies
   */
  initialize(
    providerRouter?: ProviderRouter,
    cacheManager?: CacheManager,
    productService?: ProductService
  ): void {
    this.providerRouter = providerRouter;
    this.cacheManager = cacheManager;
    this.productService = productService;
  }

  /**
   * Get comprehensive system health status
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const startTime = Date.now();
    
    try {
      const [providerHealth, cacheHealth, databaseHealth] = await Promise.allSettled([
        this.checkProviderHealth(),
        this.checkCacheHealth(),
        this.checkDatabaseHealth(),
      ]);

      const providers = providerHealth.status === 'fulfilled' ? providerHealth.value : [];
      const cache = cacheHealth.status === 'fulfilled' ? cacheHealth.value : { connected: false, hitRate: 0 };
      const database = databaseHealth.status === 'fulfilled' ? databaseHealth.value : { connected: false, latency: -1 };

      const overallStatus = this.determineOverallStatus(providers, cache, database);

      const health: SystemHealth = {
        status: overallStatus,
        providers,
        cache,
        database,
        timestamp: new Date().toISOString(),
      };

      const checkDuration = Date.now() - startTime;
      this.logger.info('System health check completed', {
        status: overallStatus,
        duration: checkDuration,
        providerCount: providers.length,
        healthyProviders: providers.filter(p => p.healthy).length,
      });

      return health;
    } catch (error) {
      this.logger.error('System health check failed', error as Error);
      
      return {
        status: 'unhealthy',
        providers: [],
        cache: { connected: false, hitRate: 0 },
        database: { connected: false, latency: -1 },
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get basic health status for load balancer checks
   */
  async getBasicHealth(): Promise<{ status: string; timestamp: string }> {
    try {
      // Quick health checks for essential services
      const essentialChecks = await Promise.allSettled([
        this.quickProviderCheck(),
        this.quickCacheCheck(),
      ]);

      const allHealthy = essentialChecks.every(
        check => check.status === 'fulfilled' && check.value
      );

      return {
        status: allHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Basic health check failed', error as Error);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Check health of all LLM providers
   */
  private async checkProviderHealth(): Promise<ProviderHealthMetrics[]> {
    if (!this.providerRouter) {
      this.logger.warn('Provider router not initialized for health check');
      return [];
    }

    const healthMetrics: ProviderHealthMetrics[] = [];

    try {
      const providers = this.providerRouter.getProviders();
      
      for (const provider of providers) {
        const startTime = Date.now();
        
        try {
          const isHealthy = await provider.isAvailable();
          const latency = Date.now() - startTime;

          // Get additional metrics if available
          const metrics = await this.getProviderMetrics(provider.name);

          healthMetrics.push({
            provider: provider.name,
            healthy: isHealthy,
            latency,
            errorRate: metrics.errorRate,
            requestCount: metrics.requestCount,
            successRate: metrics.successRate,
            lastChecked: new Date(),
            consecutiveFailures: metrics.consecutiveFailures,
          });

        } catch (error) {
          const latency = Date.now() - startTime;
          
          healthMetrics.push({
            provider: provider.name,
            healthy: false,
            latency,
            errorRate: 100,
            requestCount: 0,
            successRate: 0,
            lastChecked: new Date(),
            consecutiveFailures: -1,
          });

          this.logger.warn('Provider health check failed', {
            provider: provider.name,
            error: (error as Error).message,
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to check provider health', error as Error);
    }

    return healthMetrics;
  }

  /**
   * Check cache system health
   */
  private async checkCacheHealth(): Promise<{ connected: boolean; hitRate: number }> {
    if (!this.cacheManager) {
      return { connected: false, hitRate: 0 };
    }

    try {
      // Test cache connectivity with a simple operation
      const testKey = `health_check_${Date.now()}`;
      const testValue = 'health_test';
      
      await this.cacheManager.set(testKey, testValue, 10); // 10 second TTL
      const retrieved = await this.cacheManager.get(testKey);
      
      if (retrieved !== testValue) {
        throw new Error('Cache read/write test failed');
      }

      // Clean up test key
      await this.cacheManager.delete(testKey);

      // Get cache hit rate if available
      const stats = this.cacheManager.getStats();
      const hitRate = stats.hits / Math.max(stats.hits + stats.misses, 1) * 100;

      return {
        connected: true,
        hitRate: Math.round(hitRate * 100) / 100, // Round to 2 decimal places
      };

    } catch (error) {
      this.logger.warn('Cache health check failed', { error: (error as Error).message });
      return { connected: false, hitRate: 0 };
    }
  }

  /**
   * Check database health
   */
  private async checkDatabaseHealth(): Promise<{ connected: boolean; latency: number }> {
    if (!this.productService) {
      return { connected: false, latency: -1 };
    }

    try {
      const startTime = Date.now();
      
      // Test database connectivity with a simple query
      await this.productService.searchProducts('health_check', {}, 1);
      
      const latency = Date.now() - startTime;

      return {
        connected: true,
        latency,
      };

    } catch (error) {
      this.logger.warn('Database health check failed', { error: (error as Error).message });
      return { connected: false, latency: -1 };
    }
  }

  /**
   * Quick provider health check for basic health endpoint
   */
  private async quickProviderCheck(): Promise<boolean> {
    if (!this.providerRouter) {
      return false;
    }

    try {
      const providers = this.providerRouter.getProviders();
      
      // Check if at least one provider is available
      for (const provider of providers) {
        try {
          const isAvailable = await Promise.race([
            provider.isAvailable(),
            new Promise<boolean>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 2000)
            ),
          ]);
          
          if (isAvailable) {
            return true;
          }
        } catch {
          // Continue to next provider
        }
      }
      
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Quick cache health check
   */
  private async quickCacheCheck(): Promise<boolean> {
    if (!this.cacheManager) {
      return true; // Cache is optional, don't fail health check
    }

    try {
      const testKey = `quick_health_${Date.now()}`;
      await Promise.race([
        this.cacheManager.set(testKey, 'test', 5),
        new Promise<void>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 1000)
        ),
      ]);
      
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get provider-specific metrics
   */
  private async getProviderMetrics(providerName: string): Promise<{
    errorRate: number;
    requestCount: number;
    successRate: number;
    consecutiveFailures: number;
  }> {
    // In a real implementation, this would query metrics from CloudWatch or internal metrics store
    // For now, return default values
    return {
      errorRate: 0,
      requestCount: 0,
      successRate: 100,
      consecutiveFailures: 0,
    };
  }

  /**
   * Determine overall system status based on component health
   */
  private determineOverallStatus(
    providers: ProviderHealthMetrics[],
    cache: { connected: boolean; hitRate: number },
    database: { connected: boolean; latency: number }
  ): 'healthy' | 'degraded' | 'unhealthy' {
    // Check if any providers are healthy
    const healthyProviders = providers.filter(p => p.healthy);
    
    if (healthyProviders.length === 0) {
      return 'unhealthy';
    }

    // Check for degraded conditions
    const degradedConditions = [
      healthyProviders.length < providers.length, // Some providers unhealthy
      !cache.connected, // Cache unavailable
      !database.connected, // Database unavailable
      cache.hitRate < 50, // Low cache hit rate
      database.latency > 5000, // High database latency
    ];

    const degradedCount = degradedConditions.filter(Boolean).length;

    if (degradedCount === 0) {
      return 'healthy';
    } else if (degradedCount <= 2) {
      return 'degraded';
    } else {
      return 'unhealthy';
    }
  }

  /**
   * Get detailed health report for debugging
   */
  async getDetailedHealthReport(): Promise<{
    system: SystemHealth;
    environment: Record<string, any>;
    configuration: Record<string, any>;
    dependencies: Record<string, any>;
  }> {
    const system = await this.getSystemHealth();

    const environment = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      env: process.env.NODE_ENV || 'unknown',
      region: process.env.AWS_REGION || 'unknown',
    };

    const configuration = {
      namespace: process.env.CLOUDWATCH_NAMESPACE || 'AIModelGateway',
      logLevel: process.env.LOG_LEVEL || 'INFO',
      batchSize: process.env.BATCH_SIZE || '5',
      batchTimeout: process.env.BATCH_TIMEOUT_MS || '100',
      enableDeduplication: process.env.ENABLE_DEDUPLICATION !== 'false',
      enableIntelligentRouting: process.env.ENABLE_INTELLIGENT_ROUTING !== 'false',
    };

    const dependencies = {
      providerRouter: !!this.providerRouter,
      cacheManager: !!this.cacheManager,
      productService: !!this.productService,
    };

    return {
      system,
      environment,
      configuration,
      dependencies,
    };
  }
}