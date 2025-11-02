/**
 * Lambda Authorizer for API Gateway
 * Handles API key authentication and authorization
 */

import { APIGatewayAuthorizerResult, APIGatewayTokenAuthorizerEvent, Context } from 'aws-lambda';
import { ApiKeyService } from '../../services/auth/api-key-service';
import { Logger } from '../../shared/utils/logger';

const logger = new Logger('LambdaAuthorizer');
const apiKeyService = new ApiKeyService();

/**
 * Lambda authorizer handler
 */
export const handler = async (
  event: APIGatewayTokenAuthorizerEvent,
  context: Context
): Promise<APIGatewayAuthorizerResult> => {
  const correlationId = context.awsRequestId;
  
  try {
    logger.info('Processing authorization request', {
      correlationId,
      methodArn: event.methodArn,
      type: event.type,
    });

    // Extract API key from the authorization token
    const apiKey = extractApiKey(event.authorizationToken);
    
    if (!apiKey) {
      logger.warn('No API key provided', { correlationId });
      throw new Error('Unauthorized');
    }

    // Validate the API key
    const keyInfo = await apiKeyService.validateApiKey(apiKey);
    
    if (!keyInfo || !keyInfo.valid) {
      logger.warn('Invalid API key', { correlationId, apiKey: maskApiKey(apiKey) });
      throw new Error('Unauthorized');
    }

    if (!keyInfo.userId) {
      logger.warn('API key validation returned no user ID', { 
        correlationId, 
        apiKey: maskApiKey(apiKey)
      });
      throw new Error('Unauthorized');
    }

    // Generate policy
    const policy = generatePolicy(keyInfo.userId, 'Allow', event.methodArn, keyInfo);

    logger.info('Authorization successful', {
      correlationId,
      userId: keyInfo.userId,
      keyId: keyInfo.keyId,
      tier: keyInfo.tier,
    });

    return policy;

  } catch (error) {
    logger.error('Authorization failed', error instanceof Error ? error : new Error(String(error)), { correlationId });

    // Return deny policy
    return generatePolicy('user', 'Deny', event.methodArn);
  }
};

/**
 * Extract API key from authorization token
 */
function extractApiKey(authorizationToken: string): string | null {
  if (!authorizationToken) {
    return null;
  }

  // Support different formats:
  // - "Bearer <api-key>"
  // - "ApiKey <api-key>"
  // - "<api-key>" (direct)
  
  const bearerMatch = authorizationToken.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    return bearerMatch[1];
  }

  const apiKeyMatch = authorizationToken.match(/^ApiKey\s+(.+)$/i);
  if (apiKeyMatch) {
    return apiKeyMatch[1];
  }

  // Direct API key
  if (authorizationToken.length >= 32) {
    return authorizationToken;
  }

  return null;
}

/**
 * Mask API key for logging
 */
function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return '*'.repeat(apiKey.length);
  }
  return apiKey.substring(0, 4) + '*'.repeat(apiKey.length - 8) + apiKey.substring(apiKey.length - 4);
}

/**
 * Generate IAM policy for API Gateway
 */
function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  keyInfo?: any
): APIGatewayAuthorizerResult {
  const policy: APIGatewayAuthorizerResult = {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
  };

  // Add context information for downstream Lambda functions
  if (effect === 'Allow' && keyInfo) {
    policy.context = {
      userId: keyInfo.userId || '',
      keyId: keyInfo.keyId || '',
      tier: keyInfo.tier || 'free',
      permissions: JSON.stringify(keyInfo.permissions || []),
      rateLimit: JSON.stringify({
        requestsPerMinute: getRateLimitForTier(keyInfo.tier || 'free').requestsPerMinute,
        requestsPerHour: getRateLimitForTier(keyInfo.tier || 'free').requestsPerHour,
        requestsPerDay: getRateLimitForTier(keyInfo.tier || 'free').requestsPerDay,
      }),
    };
  }

  return policy;
}

/**
 * Get rate limits based on API key tier
 */
function getRateLimitForTier(tier: string) {
  const limits = {
    free: {
      requestsPerMinute: 10,
      requestsPerHour: 100,
      requestsPerDay: 1000,
    },
    basic: {
      requestsPerMinute: 60,
      requestsPerHour: 1000,
      requestsPerDay: 10000,
    },
    premium: {
      requestsPerMinute: 300,
      requestsPerHour: 10000,
      requestsPerDay: 100000,
    },
    enterprise: {
      requestsPerMinute: 1000,
      requestsPerHour: 50000,
      requestsPerDay: 1000000,
    },
  };

  return limits[tier as keyof typeof limits] || limits.free;
}