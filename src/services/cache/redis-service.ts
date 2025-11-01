import { createClient, RedisClientType } from 'redis';
import { logger } from '../../shared/utils/logger';

export interface CacheService {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  disconnect(): Promise<void>;
}

export class RedisService implements CacheService {
  private client: RedisClientType | null = null;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(
    private readonly endpoint: string,
    private readonly port: number = 6379,
    private readonly connectTimeoutMs: number = 5000
  ) {}

  private async connect(): Promise<void> {
    if (this.isConnected && this.client) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.doConnect();
    return this.connectionPromise;
  }

  private async doConnect(): Promise<void> {
    try {
      logger.info('Connecting to Redis', { 
        endpoint: this.endpoint, 
        port: this.port 
      });

      this.client = createClient({
        socket: {
          host: this.endpoint,
          port: this.port,
          connectTimeout: this.connectTimeoutMs,
          // Enable TLS for ElastiCache in-transit encryption
          ...(process.env.REDIS_TLS_ENABLED === 'true' && {
            tls: true,
          }),
        },
      });

      this.client.on('error', (error) => {
        logger.error('Redis client error', error);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis client connected');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        logger.info('Redis client disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
      this.isConnected = true;
      
      logger.info('Successfully connected to Redis');
    } catch (error) {
      logger.error('Failed to connect to Redis', 
        error instanceof Error ? error : new Error(String(error))
      );
      this.isConnected = false;
      this.connectionPromise = null;
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      await this.connect();
      if (!this.client) {
        throw new Error('Redis client not initialized');
      }

      const value = await this.client.get(key);
      logger.debug('Redis GET', { key, found: value !== null });
      return value;
    } catch (error) {
      logger.error(`Redis GET error for key ${key}`, 
        error instanceof Error ? error : new Error(String(error))
      );
      return null; // Graceful degradation
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      await this.connect();
      if (!this.client) {
        throw new Error('Redis client not initialized');
      }

      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }

      logger.debug('Redis SET', { key, ttl: ttlSeconds });
    } catch (error) {
      logger.error(`Redis SET error for key ${key}`, 
        error instanceof Error ? error : new Error(String(error))
      );
      // Don't throw - allow operation to continue without caching
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.connect();
      if (!this.client) {
        throw new Error('Redis client not initialized');
      }

      await this.client.del(key);
      logger.debug('Redis DEL', { key });
    } catch (error) {
      logger.error(`Redis DEL error for key ${key}`, 
        error instanceof Error ? error : new Error(String(error))
      );
      // Don't throw - allow operation to continue
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.connect();
      if (!this.client) {
        throw new Error('Redis client not initialized');
      }

      const result = await this.client.exists(key);
      logger.debug('Redis EXISTS', { key, exists: result === 1 });
      return result === 1;
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}`, 
        error instanceof Error ? error : new Error(String(error))
      );
      return false; // Graceful degradation
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      try {
        await this.client.disconnect();
        logger.info('Redis client disconnected');
      } catch (error) {
        logger.error('Error disconnecting Redis client', 
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
    this.client = null;
    this.isConnected = false;
    this.connectionPromise = null;
  }
}

// Singleton instance for Lambda functions
let redisServiceInstance: RedisService | null = null;

export function getRedisService(): RedisService | null {
  const endpoint = process.env.REDIS_ENDPOINT;
  const port = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379;

  if (!endpoint) {
    logger.warn('Redis endpoint not configured, caching disabled');
    return null;
  }

  if (!redisServiceInstance) {
    redisServiceInstance = new RedisService(endpoint, port);
  }

  return redisServiceInstance;
}

// Graceful shutdown for Lambda
export async function closeRedisConnection(): Promise<void> {
  if (redisServiceInstance) {
    await redisServiceInstance.disconnect();
    redisServiceInstance = null;
  }
}