export { RedisService, getRedisService, closeRedisConnection } from './redis-service';
export type { CacheService } from './redis-service';
export { CacheManager, getCacheManager } from './cache-manager';
export type { CacheConfig, CacheEntry } from './cache-manager';
export { RequestBatcher } from './request-batcher';
export type { BatchConfig, BatchingStats } from './request-batcher';
export { BatchedGatewayService } from './batched-gateway-service';
export type { OptimizationStats } from './batched-gateway-service';
