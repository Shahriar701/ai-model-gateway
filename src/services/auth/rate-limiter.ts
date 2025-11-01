import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '../../shared/utils';
import { RateLimitTier, RateLimitConfig } from '../../shared/types';

const logger = new Logger('RateLimiter');

/**
 * Rate limiting service using DynamoDB for distributed rate limiting
 */
export class RateLimiter {
  private dynamoClient: DynamoDBDocumentClient;
  private tableName: string;

  // Rate limit configurations by tier
  private readonly rateLimits: Record<RateLimitTier, RateLimitConfig> = {
    [RateLimitTier.FREE]: {
      requestsPerMinute: 10,
      requestsPerHour: 100,
      requestsPerDay: 1000,
      burstLimit: 5,
      tokensPerMinute: 1000,
      tokensPerDay: 10000
    },
    [RateLimitTier.BASIC]: {
      requestsPerMinute: 60,
      requestsPerHour: 1000,
      requestsPerDay: 10000,
      burstLimit: 20,
      tokensPerMinute: 10000,
      tokensPerDay: 100000
    },
    [RateLimitTier.PREMIUM]: {
      requestsPerMinute: 300,
      requestsPerHour: 10000,
      requestsPerDay: 100000,
      burstLimit: 100,
      tokensPerMinute: 100000,
      tokensPerDay: 1000000
    },
    [RateLimitTier.ENTERPRISE]: {
      requestsPerMinute: 1000,
      requestsPerHour: 50000,
      requestsPerDay: 1000000,
      burstLimit: 500,
      tokensPerMinute: 1000000,
      tokensPerDay: 10000000
    }
  };

  constructor(tableName?: string) {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.dynamoClient = DynamoDBDocumentClient.from(client);
    this.tableName = tableName || process.env.REQUEST_LOGS_TABLE || 'ai-gateway-request-logs';
  }

  /**
   * Check if request is within rate limits
   */
  async checkRateLimit(
    userId: string,
    tier: RateLimitTier,
    tokens?: number
  ): Promise<{
    allowed: boolean;
    remaining: {
      requestsPerMinute: number;
      requestsPerHour: number;
      requestsPerDay: number;
      tokensPerMinute?: number;
      tokensPerDay?: number;
    };
    resetTime: {
      minute: number;
      hour: number;
      day: number;
    };
    retryAfter?: number;
  }> {
    const config = this.rateLimits[tier];
    const now = new Date();
    const currentMinute = Math.floor(now.getTime() / (60 * 1000));
    const currentHour = Math.floor(now.getTime() / (60 * 60 * 1000));
    const currentDay = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));

    try {
      // Get current usage
      const [minuteUsage, hourUsage, dayUsage] = await Promise.all([
        this.getUsage(userId, 'minute', currentMinute),
        this.getUsage(userId, 'hour', currentHour),
        this.getUsage(userId, 'day', currentDay)
      ]);

      // Check limits
      const minuteExceeded = minuteUsage.requests >= config.requestsPerMinute;
      const hourExceeded = hourUsage.requests >= config.requestsPerHour;
      const dayExceeded = dayUsage.requests >= config.requestsPerDay;

      let tokenMinuteExceeded = false;
      let tokenDayExceeded = false;

      if (tokens && config.tokensPerMinute && config.tokensPerDay) {
        tokenMinuteExceeded = minuteUsage.tokens + tokens > config.tokensPerMinute;
        tokenDayExceeded = dayUsage.tokens + tokens > config.tokensPerDay;
      }

      const allowed = !minuteExceeded && !hourExceeded && !dayExceeded && 
                     !tokenMinuteExceeded && !tokenDayExceeded;

      const result = {
        allowed,
        remaining: {
          requestsPerMinute: Math.max(0, config.requestsPerMinute - minuteUsage.requests),
          requestsPerHour: Math.max(0, config.requestsPerHour - hourUsage.requests),
          requestsPerDay: Math.max(0, config.requestsPerDay - dayUsage.requests),
          tokensPerMinute: config.tokensPerMinute ? 
            Math.max(0, config.tokensPerMinute - minuteUsage.tokens) : undefined,
          tokensPerDay: config.tokensPerDay ? 
            Math.max(0, config.tokensPerDay - dayUsage.tokens) : undefined
        },
        resetTime: {
          minute: (currentMinute + 1) * 60 * 1000,
          hour: (currentHour + 1) * 60 * 60 * 1000,
          day: (currentDay + 1) * 24 * 60 * 60 * 1000
        },
        retryAfter: allowed ? undefined : this.calculateRetryAfter(
          minuteExceeded, hourExceeded, dayExceeded, currentMinute, currentHour, currentDay
        )
      };

      if (!allowed) {
        logger.warn('Rate limit exceeded', {
          userId,
          tier,
          minuteUsage: minuteUsage.requests,
          hourUsage: hourUsage.requests,
          dayUsage: dayUsage.requests,
          tokens
        });
      }

      return result;
    } catch (error) {
      logger.error('Rate limit check failed', error as Error, { userId, tier });
      // Fail open - allow request if rate limiting fails
      return {
        allowed: true,
        remaining: {
          requestsPerMinute: config.requestsPerMinute,
          requestsPerHour: config.requestsPerHour,
          requestsPerDay: config.requestsPerDay,
          tokensPerMinute: config.tokensPerMinute,
          tokensPerDay: config.tokensPerDay
        },
        resetTime: {
          minute: (currentMinute + 1) * 60 * 1000,
          hour: (currentHour + 1) * 60 * 60 * 1000,
          day: (currentDay + 1) * 24 * 60 * 60 * 1000
        }
      };
    }
  }

  /**
   * Record a request for rate limiting
   */
  async recordRequest(
    userId: string,
    tier: RateLimitTier,
    tokens: number = 0
  ): Promise<void> {
    const now = new Date();
    const currentMinute = Math.floor(now.getTime() / (60 * 1000));
    const currentHour = Math.floor(now.getTime() / (60 * 60 * 1000));
    const currentDay = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));

    try {
      // Update usage counters
      await Promise.all([
        this.incrementUsage(userId, 'minute', currentMinute, tokens),
        this.incrementUsage(userId, 'hour', currentHour, tokens),
        this.incrementUsage(userId, 'day', currentDay, tokens)
      ]);

      logger.info('Request recorded for rate limiting', {
        userId,
        tier,
        tokens,
        currentMinute,
        currentHour,
        currentDay
      });
    } catch (error) {
      logger.error('Failed to record request for rate limiting', error as Error, {
        userId,
        tier,
        tokens
      });
      // Don't throw - rate limiting recording failure shouldn't block requests
    }
  }

  private async getUsage(
    userId: string,
    period: 'minute' | 'hour' | 'day',
    periodValue: number
  ): Promise<{ requests: number; tokens: number }> {
    try {
      const result = await this.dynamoClient.send(new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `RATELIMIT#${userId}`,
          SK: `${period.toUpperCase()}#${periodValue}`
        }
      }));

      if (!result.Item) {
        return { requests: 0, tokens: 0 };
      }

      return {
        requests: result.Item.requests || 0,
        tokens: result.Item.tokens || 0
      };
    } catch (error) {
      logger.error('Failed to get usage', error as Error, { userId, period, periodValue });
      return { requests: 0, tokens: 0 };
    }
  }

  private async incrementUsage(
    userId: string,
    period: 'minute' | 'hour' | 'day',
    periodValue: number,
    tokens: number
  ): Promise<void> {
    const ttl = this.calculateTTL(period, periodValue);

    try {
      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: `RATELIMIT#${userId}`,
          SK: `${period.toUpperCase()}#${periodValue}`
        },
        UpdateExpression: 'ADD requests :inc, tokens :tokens SET #ttl = :ttl',
        ExpressionAttributeNames: {
          '#ttl': 'ttl'
        },
        ExpressionAttributeValues: {
          ':inc': 1,
          ':tokens': tokens,
          ':ttl': ttl
        }
      }));
    } catch (error) {
      logger.error('Failed to increment usage', error as Error, {
        userId,
        period,
        periodValue,
        tokens
      });
      throw error;
    }
  }

  private calculateTTL(period: 'minute' | 'hour' | 'day', periodValue: number): number {
    const now = Math.floor(Date.now() / 1000);
    
    switch (period) {
      case 'minute':
        return now + 120; // 2 minutes buffer
      case 'hour':
        return now + 7200; // 2 hours buffer
      case 'day':
        return now + 172800; // 2 days buffer
      default:
        return now + 3600; // 1 hour default
    }
  }

  private calculateRetryAfter(
    minuteExceeded: boolean,
    hourExceeded: boolean,
    dayExceeded: boolean,
    currentMinute: number,
    currentHour: number,
    currentDay: number
  ): number {
    if (dayExceeded) {
      return ((currentDay + 1) * 24 * 60 * 60 * 1000) - Date.now();
    }
    if (hourExceeded) {
      return ((currentHour + 1) * 60 * 60 * 1000) - Date.now();
    }
    if (minuteExceeded) {
      return ((currentMinute + 1) * 60 * 1000) - Date.now();
    }
    return 60000; // 1 minute default
  }

  /**
   * Get rate limit configuration for a tier
   */
  getRateLimitConfig(tier: RateLimitTier): RateLimitConfig {
    return this.rateLimits[tier];
  }
}