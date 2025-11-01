import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger, ErrorHandler, AuthenticationError, RateLimitError } from '../../shared/utils';
import { ApiKeyService, RateLimiter } from '../../services/auth';
import { ProviderRouter } from '../../services/router';
import { OpenAIProvider, BedrockProvider } from '../../services/providers';
import { ValidationHelper } from '../../shared/validation';
import { LLMRequest, RateLimitTier } from '../../shared/types';

const logger = new Logger('GatewayHandler');
const apiKeyService = new ApiKeyService();
const rateLimiter = new RateLimiter();

// Initialize providers and router
const providers = [
  new OpenAIProvider(),
  new BedrockProvider()
];

const providerConfigs = [
  {
    name: 'openai',
    type: 'openai' as any,
    enabled: true,
    priority: 1,
    maxConcurrency: 10,
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000,
    costPerInputToken: 0.00003,
    costPerOutputToken: 0.00006,
    models: ['gpt-4', 'gpt-3.5-turbo']
  },
  {
    name: 'bedrock',
    type: 'bedrock' as any,
    enabled: true,
    priority: 2,
    maxConcurrency: 5,
    timeout: 30000,
    retryAttempts: 2,
    retryDelay: 1500,
    costPerInputToken: 0.000008,
    costPerOutputToken: 0.000024,
    models: ['claude-3', 'llama-2']
  }
];

const router = new ProviderRouter(providers, providerConfigs);

/**
 * Main API Gateway Lambda handler for AI Model Gateway
 * Handles routing, authentication, and request processing
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const correlationId = event.requestContext.requestId;
  logger.setCorrelationId(correlationId);

  try {
    logger.info('Processing gateway request', {
      method: event.httpMethod,
      path: event.path,
      userAgent: event.headers['User-Agent']
    });

    // Handle health check without authentication
    if (event.path === '/api/v1/health' && event.httpMethod === 'GET') {
      return handleHealthCheck(correlationId);
    }

    // Authenticate request
    const authResult = await authenticateRequest(event);
    if (!authResult.success) {
      throw new AuthenticationError(authResult.error || 'Authentication failed');
    }

    const { userId, tier, keyId } = authResult;

    // Check rate limits
    const rateLimitResult = await rateLimiter.checkRateLimit(userId!, tier!);
    if (!rateLimitResult.allowed) {
      throw new RateLimitError(
        'Rate limit exceeded',
        Math.ceil((rateLimitResult.retryAfter || 60000) / 1000)
      );
    }

    // Route request based on path
    const response = await routeRequest(event, userId!, tier!, correlationId);

    // Record request for rate limiting
    const tokens = extractTokenCount(response);
    await rateLimiter.recordRequest(userId!, tier!, tokens);

    // Add rate limit headers
    response.headers = {
      ...response.headers,
      'X-RateLimit-Remaining-Requests': rateLimitResult.remaining.requestsPerMinute.toString(),
      'X-RateLimit-Reset': new Date(rateLimitResult.resetTime.minute).toISOString()
    };

    return response;
  } catch (error) {
    return ErrorHandler.handleLambdaError(error, correlationId);
  }
};

async function authenticateRequest(event: APIGatewayProxyEvent): Promise<{
  success: boolean;
  userId?: string;
  tier?: RateLimitTier;
  keyId?: string;
  error?: string;
}> {
  const apiKey = event.headers['X-API-Key'] || event.headers['x-api-key'];
  
  if (!apiKey) {
    return { success: false, error: 'API key required' };
  }

  const validation = await apiKeyService.validateApiKey(apiKey);
  
  if (!validation.valid) {
    return { success: false, error: 'Invalid API key' };
  }

  return {
    success: true,
    userId: validation.userId,
    tier: validation.tier,
    keyId: validation.keyId
  };
}

async function routeRequest(
  event: APIGatewayProxyEvent,
  userId: string,
  tier: RateLimitTier,
  correlationId: string
): Promise<APIGatewayProxyResult> {
  const { path, httpMethod } = event;

  if (path === '/api/v1/completions' && httpMethod === 'POST') {
    return handleCompletions(event, userId, correlationId);
  }

  // Default response for unhandled routes
  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-ID': correlationId
    },
    body: JSON.stringify({
      error: 'Route not found',
      path,
      method: httpMethod
    })
  };
}

async function handleHealthCheck(correlationId: string): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-ID': correlationId
    },
    body: JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      correlationId
    })
  };
}

async function handleCompletions(
  event: APIGatewayProxyEvent,
  userId: string,
  correlationId: string
): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      throw new Error('Request body is required');
    }

    // Validate request
    const requestData = JSON.parse(event.body);
    const llmRequest = ValidationHelper.validateLLMRequest(requestData);

    // Add user context to request
    llmRequest.metadata = {
      ...llmRequest.metadata,
      userId,
      customFields: { correlationId }
    };

    // Route to appropriate provider
    const response = await router.routeRequest(llmRequest);

    logger.info('LLM completion successful', {
      userId,
      model: llmRequest.model,
      provider: response.provider,
      tokens: response.usage.totalTokens,
      cost: response.cost.total,
      latency: response.latency
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId
      },
      body: JSON.stringify(response)
    };
  } catch (error) {
    logger.error('LLM completion failed', error as Error, { userId });
    throw error;
  }
}

function extractTokenCount(response: APIGatewayProxyResult): number {
  try {
    if (response.statusCode === 200) {
      const body = JSON.parse(response.body);
      return body.usage?.totalTokens || 0;
    }
  } catch {
    // Ignore parsing errors
  }
  return 0;
}