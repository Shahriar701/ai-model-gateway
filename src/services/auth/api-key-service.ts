import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '../../shared/utils';
import { ApiKey, RateLimitTier, ApiKeyPermission } from '../../shared/types';
import { ValidationError } from '../../shared/validation';
import { randomBytes, createHash } from 'crypto';

const logger = new Logger('ApiKeyService');

/**
 * API Key management service
 * Handles creation, validation, and management of API keys
 */
export class ApiKeyService {
  private dynamoClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(tableName?: string) {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.dynamoClient = DynamoDBDocumentClient.from(client);
    this.tableName = tableName || process.env.API_KEYS_TABLE || 'ai-gateway-api-keys';
  }

  /**
   * Create a new API key
   */
  async createApiKey(
    userId: string,
    name: string,
    tier: RateLimitTier = RateLimitTier.FREE,
    permissions: ApiKeyPermission[] = [],
    expiresAt?: string
  ): Promise<ApiKey> {
    const keyId = this.generateKeyId();
    const rawKey = this.generateRawKey();
    const hashedKey = this.hashKey(rawKey);

    const apiKey: ApiKey = {
      id: keyId,
      key: `ak_${keyId}_${rawKey}`, // Return the full key only once
      name,
      userId,
      tier,
      enabled: true,
      createdAt: new Date().toISOString(),
      expiresAt,
      permissions,
      metadata: {
        createdBy: 'api-key-service',
        version: '1.0',
      },
    };

    // Store hashed version in database
    const dbRecord = {
      ...apiKey,
      key: hashedKey, // Store only the hash
      PK: `USER#${userId}`,
      SK: `APIKEY#${keyId}`,
      GSI1PK: `APIKEY#${keyId}`,
      GSI1SK: `USER#${userId}`,
    };

    try {
      await this.dynamoClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: dbRecord,
          ConditionExpression: 'attribute_not_exists(PK)',
        })
      );

      logger.info('API key created successfully', {
        keyId,
        userId,
        tier,
        name,
      });

      return apiKey; // Return with full key for user to save
    } catch (error) {
      logger.error('Failed to create API key', error as Error, {
        keyId,
        userId,
        name,
      });
      throw new Error('Failed to create API key');
    }
  }

  /**
   * Validate an API key and return user context
   */
  async validateApiKey(apiKey: string): Promise<{
    valid: boolean;
    userId?: string;
    tier?: RateLimitTier;
    permissions?: ApiKeyPermission[];
    keyId?: string;
  }> {
    try {
      // Parse the API key format: ak_{keyId}_{rawKey}
      const keyParts = apiKey.split('_');
      if (keyParts.length !== 3 || keyParts[0] !== 'ak') {
        return { valid: false };
      }

      const keyId = keyParts[1];
      const rawKey = keyParts[2];
      const hashedKey = this.hashKey(rawKey);

      // Query by keyId using GSI
      const result = await this.dynamoClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: {
            ':pk': `APIKEY#${keyId}`,
          },
        })
      );

      if (!result.Items || result.Items.length === 0) {
        logger.warn('API key not found', { keyId });
        return { valid: false };
      }

      const keyRecord = result.Items[0] as any;

      // Verify the hashed key matches
      if (keyRecord.key !== hashedKey) {
        logger.warn('API key hash mismatch', { keyId });
        return { valid: false };
      }

      // Check if key is enabled
      if (!keyRecord.enabled) {
        logger.warn('API key is disabled', { keyId });
        return { valid: false };
      }

      // Check if key is expired
      if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
        logger.warn('API key is expired', { keyId, expiresAt: keyRecord.expiresAt });
        return { valid: false };
      }

      // Update last used timestamp
      await this.updateLastUsed(keyRecord.PK, keyRecord.SK);

      logger.info('API key validated successfully', {
        keyId,
        userId: keyRecord.userId,
        tier: keyRecord.tier,
      });

      return {
        valid: true,
        userId: keyRecord.userId,
        tier: keyRecord.tier,
        permissions: keyRecord.permissions || [],
        keyId,
      };
    } catch (error) {
      logger.error('API key validation failed', error as Error, {
        apiKey: apiKey.substring(0, 10) + '...',
      });
      return { valid: false };
    }
  }

  /**
   * List API keys for a user
   */
  async listApiKeys(userId: string): Promise<Omit<ApiKey, 'key'>[]> {
    try {
      const result = await this.dynamoClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `USER#${userId}`,
            ':sk': 'APIKEY#',
          },
        })
      );

      const apiKeys = (result.Items || []).map(item => {
        const { key, PK, SK, GSI1PK, GSI1SK, ...apiKey } = item as any;
        return apiKey as Omit<ApiKey, 'key'>;
      });

      logger.info('Listed API keys for user', { userId, count: apiKeys.length });
      return apiKeys;
    } catch (error) {
      logger.error('Failed to list API keys', error as Error, { userId });
      throw new Error('Failed to list API keys');
    }
  }

  /**
   * Revoke (disable) an API key
   */
  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    try {
      await this.dynamoClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            PK: `USER#${userId}`,
            SK: `APIKEY#${keyId}`,
          },
          UpdateExpression: 'SET enabled = :enabled, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':enabled': false,
            ':updatedAt': new Date().toISOString(),
          },
          ConditionExpression: 'attribute_exists(PK)',
        })
      );

      logger.info('API key revoked successfully', { userId, keyId });
    } catch (error) {
      logger.error('Failed to revoke API key', error as Error, { userId, keyId });
      throw new Error('Failed to revoke API key');
    }
  }

  /**
   * Get API key details (without the actual key)
   */
  async getApiKey(userId: string, keyId: string): Promise<Omit<ApiKey, 'key'> | null> {
    try {
      const result = await this.dynamoClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            PK: `USER#${userId}`,
            SK: `APIKEY#${keyId}`,
          },
        })
      );

      if (!result.Item) {
        return null;
      }

      const { key, PK, SK, GSI1PK, GSI1SK, ...apiKey } = result.Item as any;
      return apiKey as Omit<ApiKey, 'key'>;
    } catch (error) {
      logger.error('Failed to get API key', error as Error, { userId, keyId });
      throw new Error('Failed to get API key');
    }
  }

  private generateKeyId(): string {
    return randomBytes(8).toString('hex');
  }

  private generateRawKey(): string {
    return randomBytes(32).toString('hex');
  }

  private hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }

  private async updateLastUsed(pk: string, sk: string): Promise<void> {
    try {
      await this.dynamoClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: pk, SK: sk },
          UpdateExpression: 'SET lastUsedAt = :lastUsed',
          ExpressionAttributeValues: {
            ':lastUsed': new Date().toISOString(),
          },
        })
      );
    } catch (error) {
      // Don't throw on lastUsed update failure
      logger.warn('Failed to update lastUsed timestamp', { pk, sk });
    }
  }
}
