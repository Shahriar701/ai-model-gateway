import { LLMRequest, LLMResponse } from '../../shared/types';
import { Logger } from '../../shared/utils';
import { CacheManager } from './cache-manager';
import { createHash } from 'crypto';

const logger = new Logger('RequestBatcher');

export interface BatchConfig {
  maxBatchSize: number;
  batchTimeoutMs: number;
  similarityThreshold: number;
  enableDeduplication: boolean;
}

export interface BatchedRequest {
  id: string;
  request: LLMRequest;
  resolve: (response: LLMResponse) => void;
  reject: (error: Error) => void;
  timestamp: number;
  hash: string;
}

export interface BatchGroup {
  requests: BatchedRequest[];
  timer: NodeJS.Timeout | null;
  representative: LLMRequest;
}

/**
 * Request batching service for optimizing LLM requests
 * Groups similar requests and implements deduplication
 */
export class RequestBatcher {
  private config: BatchConfig;
  private cacheManager: CacheManager;
  private pendingBatches: Map<string, BatchGroup> = new Map();
  private requestQueue: Map<string, BatchedRequest[]> = new Map();
  private usageAnalytics: Map<string, RequestPattern> = new Map();

  constructor(config: Partial<BatchConfig>, cacheManager: CacheManager) {
    this.config = {
      maxBatchSize: 5,
      batchTimeoutMs: 100,
      similarityThreshold: 0.8,
      enableDeduplication: true,
      ...config,
    };
    this.cacheManager = cacheManager;

    logger.info('Request batcher initialized', {
      maxBatchSize: this.config.maxBatchSize,
      batchTimeoutMs: this.config.batchTimeoutMs,
      deduplicationEnabled: this.config.enableDeduplication,
    });
  }

  /**
   * Process a request with batching and deduplication
   */
  async processRequest(request: LLMRequest): Promise<LLMResponse> {
    const requestId = this.generateRequestId();
    const requestHash = this.generateRequestHash(request);

    logger.debug('Processing request for batching', {
      requestId,
      model: request.model,
      hash: requestHash.substring(0, 8),
    });

    // Check for cached response first (deduplication)
    if (this.config.enableDeduplication) {
      const cachedResponse = await this.cacheManager.getCachedLLMResponse(requestHash);
      if (cachedResponse) {
        logger.info('Request served from cache (deduplication)', {
          requestId,
          hash: requestHash.substring(0, 8),
        });
        this.updateUsageAnalytics(requestHash, true);
        return { ...cachedResponse, cached: true };
      }
    }

    // Update usage analytics
    this.updateUsageAnalytics(requestHash, false);

    // Create batched request
    return new Promise<LLMResponse>((resolve, reject) => {
      const batchedRequest: BatchedRequest = {
        id: requestId,
        request,
        resolve,
        reject,
        timestamp: Date.now(),
        hash: requestHash,
      };

      // Find or create batch group
      const batchKey = this.findBatchGroup(request);
      this.addToBatch(batchKey, batchedRequest);
    });
  }

  /**
   * Find appropriate batch group for request
   */
  private findBatchGroup(request: LLMRequest): string {
    // Create batch key based on model and similar parameters
    const batchKey = this.generateBatchKey(request);

    // Check if we have an existing batch for this key
    if (this.pendingBatches.has(batchKey)) {
      const batch = this.pendingBatches.get(batchKey)!;
      
      // Check if batch is full
      if (batch.requests.length >= this.config.maxBatchSize) {
        // Create new batch with incremented suffix
        return `${batchKey}_${Date.now()}`;
      }
      
      return batchKey;
    }

    return batchKey;
  }

  /**
   * Add request to batch group
   */
  private addToBatch(batchKey: string, batchedRequest: BatchedRequest): void {
    let batch = this.pendingBatches.get(batchKey);

    if (!batch) {
      // Create new batch
      batch = {
        requests: [],
        timer: null,
        representative: batchedRequest.request,
      };
      this.pendingBatches.set(batchKey, batch);
    }

    batch.requests.push(batchedRequest);

    logger.debug('Request added to batch', {
      batchKey,
      requestId: batchedRequest.id,
      batchSize: batch.requests.length,
    });

    // Set timer for batch execution if not already set
    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        this.executeBatch(batchKey);
      }, this.config.batchTimeoutMs);
    }

    // Execute immediately if batch is full
    if (batch.requests.length >= this.config.maxBatchSize) {
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
      this.executeBatch(batchKey);
    }
  }

  /**
   * Execute batch of requests
   */
  private async executeBatch(batchKey: string): Promise<void> {
    const batch = this.pendingBatches.get(batchKey);
    if (!batch) return;

    // Remove batch from pending
    this.pendingBatches.delete(batchKey);

    logger.info('Executing batch', {
      batchKey,
      requestCount: batch.requests.length,
    });

    try {
      // Check if all requests in batch are identical (perfect deduplication)
      const uniqueHashes = new Set(batch.requests.map(r => r.hash));
      
      if (uniqueHashes.size === 1 && this.config.enableDeduplication) {
        // All requests are identical - execute once and share result
        await this.executeIdenticalBatch(batch);
      } else {
        // Execute requests individually but in parallel
        await this.executeParallelBatch(batch);
      }
    } catch (error) {
      logger.error('Batch execution failed', error as Error, { batchKey });
      
      // Reject all requests in batch
      batch.requests.forEach(req => {
        req.reject(error as Error);
      });
    }
  }

  /**
   * Execute batch where all requests are identical
   */
  private async executeIdenticalBatch(batch: BatchGroup): Promise<void> {
    const representative = batch.requests[0];
    
    try {
      // Execute single request
      const response = await this.executeSingleRequest(representative.request);
      
      // Cache the response for deduplication
      if (this.config.enableDeduplication) {
        await this.cacheManager.cacheLLMResponse(
          representative.hash,
          response,
          this.calculateCacheTTL(representative.hash)
        );
      }

      // Resolve all requests with the same response
      batch.requests.forEach(req => {
        req.resolve({ ...response, cached: false });
      });

      logger.info('Identical batch executed successfully', {
        requestCount: batch.requests.length,
        model: representative.request.model,
        cost: response.cost.total,
      });
    } catch (error) {
      batch.requests.forEach(req => {
        req.reject(error as Error);
      });
      throw error;
    }
  }

  /**
   * Execute batch with different requests in parallel
   */
  private async executeParallelBatch(batch: BatchGroup): Promise<void> {
    const promises = batch.requests.map(async (req) => {
      try {
        const response = await this.executeSingleRequest(req.request);
        
        // Cache individual responses
        if (this.config.enableDeduplication) {
          await this.cacheManager.cacheLLMResponse(
            req.hash,
            response,
            this.calculateCacheTTL(req.hash)
          );
        }
        
        req.resolve(response);
        return response;
      } catch (error) {
        req.reject(error as Error);
        throw error;
      }
    });

    await Promise.allSettled(promises);
    
    logger.info('Parallel batch executed', {
      requestCount: batch.requests.length,
    });
  }

  private requestExecutor?: (request: LLMRequest) => Promise<LLMResponse>;

  /**
   * Execute single request using the injected executor
   */
  private async executeSingleRequest(request: LLMRequest): Promise<LLMResponse> {
    if (!this.requestExecutor) {
      throw new Error('Request executor not set. Call setRequestExecutor() first.');
    }
    return this.requestExecutor(request);
  }

  /**
   * Set the request executor function
   */
  setRequestExecutor(executor: (request: LLMRequest) => Promise<LLMResponse>): void {
    this.requestExecutor = executor;
  }

  /**
   * Generate batch key for grouping similar requests
   */
  private generateBatchKey(request: LLMRequest): string {
    // Group by model and key parameters that affect cost/routing
    const keyComponents = {
      model: request.model,
      temperature: request.temperature || 0.7,
      maxTokens: request.maxTokens || 1000,
      // Don't include messages in batch key as they're likely different
    };

    const keyString = JSON.stringify(keyComponents, Object.keys(keyComponents).sort());
    return createHash('md5').update(keyString).digest('hex').substring(0, 16);
  }

  /**
   * Generate request hash for deduplication
   */
  private generateRequestHash(request: LLMRequest): string {
    return this.cacheManager.generateRequestHash(request);
  }

  /**
   * Calculate cache TTL based on request patterns
   */
  private calculateCacheTTL(requestHash: string): number {
    const pattern = this.usageAnalytics.get(requestHash);
    
    if (!pattern) {
      return 300; // Default 5 minutes
    }

    // Increase TTL for frequently requested items
    if (pattern.frequency > 10) {
      return 1800; // 30 minutes for popular requests
    } else if (pattern.frequency > 5) {
      return 900; // 15 minutes for moderately popular
    }

    return 300; // 5 minutes for infrequent requests
  }

  /**
   * Update usage analytics for intelligent caching
   */
  private updateUsageAnalytics(requestHash: string, cacheHit: boolean): void {
    let pattern = this.usageAnalytics.get(requestHash);
    
    if (!pattern) {
      pattern = {
        hash: requestHash,
        frequency: 0,
        lastAccessed: Date.now(),
        cacheHits: 0,
        totalRequests: 0,
      };
      this.usageAnalytics.set(requestHash, pattern);
    }

    pattern.frequency++;
    pattern.totalRequests++;
    pattern.lastAccessed = Date.now();
    
    if (cacheHit) {
      pattern.cacheHits++;
    }

    // Clean up old patterns periodically
    if (this.usageAnalytics.size > 10000) {
      this.cleanupOldPatterns();
    }
  }

  /**
   * Clean up old usage patterns
   */
  private cleanupOldPatterns(): void {
    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [hash, pattern] of this.usageAnalytics.entries()) {
      if (pattern.lastAccessed < cutoffTime) {
        this.usageAnalytics.delete(hash);
      }
    }

    logger.debug('Cleaned up old usage patterns', {
      remainingPatterns: this.usageAnalytics.size,
    });
  }

  /**
   * Get usage analytics for monitoring
   */
  getUsageAnalytics(): RequestPattern[] {
    return Array.from(this.usageAnalytics.values());
  }

  /**
   * Get batching statistics
   */
  getBatchingStats(): BatchingStats {
    return {
      pendingBatches: this.pendingBatches.size,
      totalPatterns: this.usageAnalytics.size,
      config: this.config,
    };
  }

  private generateRequestId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Request pattern for analytics
 */
interface RequestPattern {
  hash: string;
  frequency: number;
  lastAccessed: number;
  cacheHits: number;
  totalRequests: number;
}

/**
 * Batching statistics
 */
export interface BatchingStats {
  pendingBatches: number;
  totalPatterns: number;
  config: BatchConfig;
}