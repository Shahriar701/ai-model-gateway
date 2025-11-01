import { CacheService, getRedisService } from './redis-service';
import { logger } from '../../shared/utils/logger';
import { createHash } from 'crypto';

export interface CacheConfig {
  defaultTtlSeconds: number;
  keyPrefix: string;
  enableCompression: boolean;
}

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  version: string;
}

export class CacheManager {
  private cacheService: CacheService | null;
  private config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      defaultTtlSeconds: 300, // 5 minutes default
      keyPrefix: 'ai-gateway',
      enableCompression: false,
      ...config,
    };
    
    this.cacheService = getRedisService();
    
    if (!this.cacheService) {
      logger.warn('Cache service not available, operations will be no-ops');
    }
  }

  /**
   * Generate a cache key from request parameters
   */
  private generateCacheKey(namespace: string, identifier: string): string {
    const hash = createHash('sha256').update(identifier).digest('hex').substring(0, 16);
    return `${this.config.keyPrefix}:${namespace}:${hash}`;
  }

  /**
   * Cache LLM response
   */
  async cacheLLMResponse(
    requestHash: string,
    response: any,
    ttlSeconds?: number
  ): Promise<void> {
    if (!this.cacheService) return;

    try {
      const cacheEntry: CacheEntry = {
        data: response,
        timestamp: Date.now(),
        version: '1.0',
      };

      const key = this.generateCacheKey('llm', requestHash);
      const value = JSON.stringify(cacheEntry);
      
      await this.cacheService.set(
        key, 
        value, 
        ttlSeconds || this.config.defaultTtlSeconds
      );

      logger.debug('Cached LLM response', { 
        requestHash: requestHash.substring(0, 8),
        ttl: ttlSeconds || this.config.defaultTtlSeconds 
      });
    } catch (error) {
      logger.error('Failed to cache LLM response', 
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Get cached LLM response
   */
  async getCachedLLMResponse(requestHash: string): Promise<any | null> {
    if (!this.cacheService) return null;

    try {
      const key = this.generateCacheKey('llm', requestHash);
      const cached = await this.cacheService.get(key);
      
      if (!cached) {
        logger.debug('Cache miss for LLM request', { 
          requestHash: requestHash.substring(0, 8) 
        });
        return null;
      }

      const cacheEntry: CacheEntry = JSON.parse(cached);
      
      logger.debug('Cache hit for LLM request', { 
        requestHash: requestHash.substring(0, 8),
        age: Date.now() - cacheEntry.timestamp 
      });

      return cacheEntry.data;
    } catch (error) {
      logger.error('Failed to get cached LLM response', 
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  /**
   * Cache product data
   */
  async cacheProductData(
    productId: string,
    productData: any,
    ttlSeconds?: number
  ): Promise<void> {
    if (!this.cacheService) return;

    try {
      const cacheEntry: CacheEntry = {
        data: productData,
        timestamp: Date.now(),
        version: '1.0',
      };

      const key = this.generateCacheKey('product', productId);
      const value = JSON.stringify(cacheEntry);
      
      await this.cacheService.set(
        key, 
        value, 
        ttlSeconds || this.config.defaultTtlSeconds
      );

      logger.debug('Cached product data', { productId, ttl: ttlSeconds || this.config.defaultTtlSeconds });
    } catch (error) {
      logger.error(`Failed to cache product data for ${productId}`, 
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Get cached product data
   */
  async getCachedProductData(productId: string): Promise<any | null> {
    if (!this.cacheService) return null;

    try {
      const key = this.generateCacheKey('product', productId);
      const cached = await this.cacheService.get(key);
      
      if (!cached) {
        logger.debug('Cache miss for product', { productId });
        return null;
      }

      const cacheEntry: CacheEntry = JSON.parse(cached);
      
      logger.debug('Cache hit for product', { 
        productId,
        age: Date.now() - cacheEntry.timestamp 
      });

      return cacheEntry.data;
    } catch (error) {
      logger.error(`Failed to get cached product data for ${productId}`, 
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  /**
   * Cache provider health status
   */
  async cacheProviderHealth(
    provider: string,
    isHealthy: boolean,
    ttlSeconds: number = 60
  ): Promise<void> {
    if (!this.cacheService) return;

    try {
      const healthData = {
        healthy: isHealthy,
        lastCheck: Date.now(),
      };

      const key = this.generateCacheKey('provider-health', provider);
      await this.cacheService.set(key, JSON.stringify(healthData), ttlSeconds);

      logger.debug('Cached provider health', { provider, healthy: isHealthy });
    } catch (error) {
      logger.error(`Failed to cache provider health for ${provider}`, 
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Get cached provider health status
   */
  async getCachedProviderHealth(provider: string): Promise<{ healthy: boolean; lastCheck: number } | null> {
    if (!this.cacheService) return null;

    try {
      const key = this.generateCacheKey('provider-health', provider);
      const cached = await this.cacheService.get(key);
      
      if (!cached) {
        return null;
      }

      return JSON.parse(cached);
    } catch (error) {
      logger.error(`Failed to get cached provider health for ${provider}`, 
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  /**
   * Invalidate cache entries by pattern
   */
  async invalidateCache(namespace: string, pattern?: string): Promise<void> {
    if (!this.cacheService) return;

    try {
      // Note: This is a simplified implementation
      // In production, you might want to use Redis SCAN with pattern matching
      logger.info('Cache invalidation requested', { namespace, pattern });
      
      // For now, we'll just log the request
      // Full implementation would require Redis SCAN or keeping track of keys
    } catch (error) {
      logger.error(`Failed to invalidate cache for namespace ${namespace}`, 
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Generate hash for request caching
   */
  generateRequestHash(request: any): string {
    const requestString = JSON.stringify(request, Object.keys(request).sort());
    return createHash('sha256').update(requestString).digest('hex');
  }

  /**
   * Get cache statistics (if supported by cache service)
   */
  async getCacheStats(): Promise<any> {
    if (!this.cacheService) {
      return { available: false };
    }

    return {
      available: true,
      // Additional stats could be added here if Redis service supports them
    };
  }
}

// Singleton instance
let cacheManagerInstance: CacheManager | null = null;

export function getCacheManager(config?: Partial<CacheConfig>): CacheManager {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager(config);
  }
  return cacheManagerInstance;
}