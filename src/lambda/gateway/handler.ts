import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { 
  Logger, 
  ErrorHandler, 
  AuthenticationError, 
  RateLimitError, 
  ProviderError
} from '../../shared/utils';
import { ValidationError, CircuitBreakerError, TimeoutError } from '../../shared/utils/error-handler';
import { ApiKeyService, RateLimiter } from '../../services/auth';
import { ProviderRouter } from '../../services/router';
import { OpenAIProvider, BedrockProvider } from '../../services/providers';
import { MCPContextService } from '../../services/mcp';
import { ValidationHelper } from '../../shared/validation';
import { 
  LLMRequest, 
  LLMResponse, 
  RateLimitTier, 
  RoutingStrategy, 
  ProviderSelectionCriteria,
  ErrorType,
  ProviderConfig,
  ProviderType
} from '../../shared/types';
import { BatchedGatewayService } from '../../services/cache';
import {
  SecurityMiddleware,
  ValidationMiddleware,
  CorsMiddleware,
  RequestSigningMiddleware,
} from '../../shared/middleware';
import { SecurityLogger } from '../../shared/utils/security-logger';
import { MetricsService } from '../../services/monitoring/metrics-service';
import { HealthService } from '../../services/monitoring/health-service';
import { TracingService } from '../../services/monitoring/tracing-service';
import { CorrelationService } from '../../services/monitoring/correlation-service';
import { RunbookService } from '../../services/monitoring/runbook-service';
import { SecurityMonitor } from '../../services/monitoring/security-monitor';
import { AdminApi } from '../../services/config/admin-api';
import { CacheManager } from '../../services/cache/cache-manager';

const logger = new Logger('GatewayHandler');
const apiKeyService = new ApiKeyService();
const rateLimiter = new RateLimiter();
const securityLogger = SecurityLogger.getInstance();
const mcpContextService = new MCPContextService();
const metricsService = MetricsService.getInstance();
const healthService = HealthService.getInstance();
const tracingService = TracingService.getInstance();
const correlationService = CorrelationService.getInstance();
const runbookService = RunbookService.getInstance();
const securityMonitor = SecurityMonitor.getInstance();
const adminApi = AdminApi.getInstance();
const cacheManager = new CacheManager();

// Initialize providers and router with enhanced configuration
const providers = [new OpenAIProvider(), new BedrockProvider()];

const providerConfigs: ProviderConfig[] = [
  {
    name: 'openai',
    type: ProviderType.OPENAI,
    enabled: process.env.OPENAI_ENABLED !== 'false',
    priority: parseInt(process.env.OPENAI_PRIORITY || '1'),
    maxConcurrency: parseInt(process.env.OPENAI_MAX_CONCURRENCY || '10'),
    timeout: parseInt(process.env.OPENAI_TIMEOUT || '30000'),
    retryAttempts: parseInt(process.env.OPENAI_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.OPENAI_RETRY_DELAY || '1000'),
    costPerInputToken: parseFloat(process.env.OPENAI_COST_PER_INPUT_TOKEN || '0.00003'),
    costPerOutputToken: parseFloat(process.env.OPENAI_COST_PER_OUTPUT_TOKEN || '0.00006'),
    models: (process.env.OPENAI_MODELS || 'gpt-4,gpt-3.5-turbo').split(','),
    healthCheckInterval: parseInt(process.env.OPENAI_HEALTH_CHECK_INTERVAL || '30000'),
  },
  {
    name: 'bedrock',
    type: ProviderType.BEDROCK,
    enabled: process.env.BEDROCK_ENABLED !== 'false',
    priority: parseInt(process.env.BEDROCK_PRIORITY || '2'),
    maxConcurrency: parseInt(process.env.BEDROCK_MAX_CONCURRENCY || '5'),
    timeout: parseInt(process.env.BEDROCK_TIMEOUT || '30000'),
    retryAttempts: parseInt(process.env.BEDROCK_RETRY_ATTEMPTS || '2'),
    retryDelay: parseInt(process.env.BEDROCK_RETRY_DELAY || '1500'),
    costPerInputToken: parseFloat(process.env.BEDROCK_COST_PER_INPUT_TOKEN || '0.000008'),
    costPerOutputToken: parseFloat(process.env.BEDROCK_COST_PER_OUTPUT_TOKEN || '0.000024'),
    models: (process.env.BEDROCK_MODELS || 'claude-3,llama-2').split(','),
    healthCheckInterval: parseInt(process.env.BEDROCK_HEALTH_CHECK_INTERVAL || '30000'),
  },
];

const router = new ProviderRouter(providers, providerConfigs);

// Circuit breaker configuration now handled by ErrorHandler

// Initialize batched gateway service with request optimization
const batchedGateway = new BatchedGatewayService(router, {
  batchConfig: {
    maxBatchSize: parseInt(process.env.BATCH_SIZE || '5'),
    batchTimeoutMs: parseInt(process.env.BATCH_TIMEOUT_MS || '100'),
    enableDeduplication: process.env.ENABLE_DEDUPLICATION !== 'false',
  },
  enableIntelligentRouting: process.env.ENABLE_INTELLIGENT_ROUTING !== 'false',
  costOptimizationThreshold: parseFloat(process.env.COST_OPTIMIZATION_THRESHOLD || '0.001'),
});

// Circuit breaker and retry logic now handled by ErrorHandler

// Initialize MCP context service
let mcpInitialized = false;
const initializeMCP = async () => {
  if (!mcpInitialized) {
    await mcpContextService.initialize();
    mcpInitialized = true;
  }
};

// Initialize health service with dependencies
let healthInitialized = false;
const initializeHealth = async () => {
  if (!healthInitialized) {
    healthService.initialize(router, undefined, undefined); // Cache and product service will be added later
    healthInitialized = true;
  }
};

/**
 * Main API Gateway Lambda handler for AI Model Gateway
 * Handles routing, authentication, request processing with comprehensive error handling
 * Implements circuit breaker patterns and intelligent provider routing
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const correlationId = correlationService.extractCorrelationFromHeaders(event.headers);
  const startTime = Date.now();
  let userId: string | undefined;
  
  // Create correlation context
  const context = correlationService.createContext(
    correlationId,
    undefined, // userId will be set after authentication
    event.headers['X-Session-ID'],
    event.requestContext.requestId
  );
  
  // Create contextual logger
  const contextLogger = correlationService.createContextualLogger(correlationId, 'GatewayHandler');
  
  // Initialize tracing
  tracingService.instrumentHTTP();
  const segment = tracingService.createLambdaSegment('ai-gateway-handler', correlationId);
  
  contextLogger.addTraceAnnotation('httpMethod', event.httpMethod);
  contextLogger.addTraceAnnotation('path', event.path);
  contextLogger.addTraceAnnotation('sourceIp', event.requestContext.identity?.sourceIp || 'unknown');
  
  correlationService.addBreadcrumb(correlationId, 'gateway', 'request_start', {
    method: event.httpMethod,
    path: event.path,
    userAgent: event.headers['User-Agent'],
    timestamp: new Date().toISOString(),
  });

  try {
    contextLogger.info('Processing gateway request', {
      method: event.httpMethod,
      path: event.path,
      userAgent: event.headers['User-Agent'],
      sourceIp: event.requestContext.identity?.sourceIp,
    });

    // Handle CORS preflight requests
    if (event.httpMethod === 'OPTIONS') {
      const corsResponse = CorsMiddleware.handlePreflightRequest(event, correlationId);
      return SecurityMiddleware.addSecurityHeaders(corsResponse, correlationId);
    }

    // Apply validation middleware
    const validationResult = ValidationMiddleware.validateApiGatewayEvent(event, correlationId);
    if (!validationResult.success) {
      const errorResponse = createErrorResponse(400, validationResult.error!, correlationId);
      return finalizeResponse(errorResponse, event, correlationId);
    }

    // Apply security middleware
    const securityResult = await SecurityMiddleware.applySecurityMiddleware(event, correlationId);
    if (!securityResult.success) {
      const errorResponse = createErrorResponse(400, securityResult.error!, correlationId);
      return finalizeResponse(errorResponse, event, correlationId);
    }

    // Use sanitized event from security middleware
    const sanitizedEvent = securityResult.sanitizedEvent || event;

    // Verify request signature for secure endpoints
    const signatureResult = await RequestSigningMiddleware.verifyRequestSignature(
      sanitizedEvent,
      correlationId
    );
    if (!signatureResult.success) {
      const errorResponse = createErrorResponse(401, signatureResult.error!, correlationId);
      return finalizeResponse(errorResponse, event, correlationId);
    }

    // Validate request body
    const bodyValidation = ValidationMiddleware.validateRequestBody(sanitizedEvent, correlationId);
    if (!bodyValidation.success) {
      const errorResponse = createErrorResponse(400, bodyValidation.error!, correlationId);
      return finalizeResponse(errorResponse, event, correlationId);
    }

    // Validate query parameters
    const queryValidation = ValidationMiddleware.validateQueryParameters(
      sanitizedEvent,
      correlationId
    );
    if (!queryValidation.success) {
      const errorResponse = createErrorResponse(400, queryValidation.error!, correlationId);
      return finalizeResponse(errorResponse, event, correlationId);
    }

    // Handle health checks without authentication
    if (sanitizedEvent.path === '/api/v1/health' && sanitizedEvent.httpMethod === 'GET') {
      const healthResponse = await handleHealthCheck(correlationId);
      return finalizeResponse(healthResponse, event, correlationId);
    }

    if (sanitizedEvent.path === '/api/v1/health/detailed' && sanitizedEvent.httpMethod === 'GET') {
      const detailedHealthResponse = await handleDetailedHealthCheck(correlationId);
      return finalizeResponse(detailedHealthResponse, event, correlationId);
    }

    if (sanitizedEvent.path === '/api/v1/health/incidents' && sanitizedEvent.httpMethod === 'GET') {
      const incidentsResponse = await handleIncidentsCheck(correlationId);
      return finalizeResponse(incidentsResponse, event, correlationId);
    }

    if (sanitizedEvent.path === '/api/v1/health/metrics' && sanitizedEvent.httpMethod === 'GET') {
      const metricsResponse = await handleMetricsCheck(correlationId);
      return finalizeResponse(metricsResponse, event, correlationId);
    }

    if (sanitizedEvent.path === '/api/v1/health/circuit-breakers' && sanitizedEvent.httpMethod === 'GET') {
      const circuitBreakerResponse = await handleCircuitBreakerCheck(correlationId);
      return finalizeResponse(circuitBreakerResponse, event, correlationId);
    }

    // Handle admin API endpoints (no authentication required here as AdminApi handles it)
    if (sanitizedEvent.path.startsWith('/api/v1/admin/')) {
      const adminResponse = await adminApi.handleRequest(sanitizedEvent);
      return finalizeResponse(adminResponse, event, correlationId);
    }

    // Authenticate request
    const authStartTime = Date.now();
    const authResult = await authenticateRequest(sanitizedEvent, correlationId);
    const authLatency = Date.now() - authStartTime;
    
    if (!authResult.success) {
      await metricsService.recordAuthMetrics(false, 'unknown', correlationId, authLatency);
      throw new AuthenticationError(authResult.error || 'Authentication failed');
    }

    const { tier, keyId } = authResult;
    userId = authResult.userId; // Set userId for error handling
    await metricsService.recordAuthMetrics(true, tier!, correlationId, authLatency);
    
    // Update correlation context with user information
    correlationService.updateContext(correlationId, { userId });
    contextLogger.addTraceAnnotation('userId', userId!);
    contextLogger.addTraceAnnotation('tier', tier!);
    
    correlationService.addBreadcrumb(correlationId, 'gateway', 'authentication_success', {
      userId,
      tier,
      latency: authLatency,
    });

    // Check rate limits
    const rateLimitResult = await rateLimiter.checkRateLimit(userId!, tier!);
    await metricsService.recordRateLimitMetrics(
      userId!,
      tier!,
      rateLimitResult.allowed,
      rateLimitResult.remaining.requestsPerMinute,
      correlationId
    );
    
    if (!rateLimitResult.allowed) {
      securityLogger.logRateLimitExceeded(
        correlationId,
        userId!,
        tier!,
        rateLimitResult.remaining.requestsPerMinute,
        sanitizedEvent.requestContext.identity?.sourceIp,
        sanitizedEvent.headers['User-Agent']
      );

      throw new RateLimitError(
        'Rate limit exceeded',
        Math.ceil((rateLimitResult.retryAfter || 60000) / 1000)
      );
    }

    // Route request based on path
    const response = await routeRequest(sanitizedEvent, userId!, tier!, correlationId);

    // Record request for rate limiting
    const tokens = extractTokenCount(response);
    await rateLimiter.recordRequest(userId!, tier!, tokens);

    // Add rate limit headers
    response.headers = {
      ...response.headers,
      'X-RateLimit-Remaining-Requests': rateLimitResult.remaining.requestsPerMinute.toString(),
      'X-RateLimit-Reset': new Date(rateLimitResult.resetTime.minute).toISOString(),
    };

    const totalLatency = Date.now() - startTime;
    contextLogger.performance('gateway_request', totalLatency, {
      method: event.httpMethod,
      path: event.path,
      statusCode: response.statusCode,
    });

    correlationService.addBreadcrumb(correlationId, 'gateway', 'request_success', {
      statusCode: response.statusCode,
      latency: totalLatency,
    });

    // Add correlation headers to response
    const correlationHeaders = correlationService.getCorrelationHeaders(correlationId);
    response.headers = { ...response.headers, ...correlationHeaders };

    return finalizeResponse(response, event, correlationId);
  } catch (error) {
    const totalLatency = Date.now() - startTime;
    const errorInstance = error as Error;
    
    // Determine error type and appropriate response
    let errorType: ErrorType;
    let statusCode: number;
    let retryAfter: number | undefined;
    
    if (error instanceof AuthenticationError) {
      errorType = ErrorType.AUTHENTICATION_ERROR;
      statusCode = 401;
    } else if (error instanceof RateLimitError) {
      errorType = ErrorType.RATE_LIMIT_EXCEEDED;
      statusCode = 429;
      retryAfter = (error as any).retryAfter;
    } else if (error instanceof ValidationError) {
      errorType = ErrorType.INVALID_REQUEST;
      statusCode = 400;
    } else if (errorInstance.message.includes('Circuit breaker')) {
      errorType = ErrorType.PROVIDER_UNAVAILABLE;
      statusCode = 503;
      retryAfter = 60; // Suggest retry after 1 minute
    } else {
      errorType = ErrorType.INTERNAL_ERROR;
      statusCode = 500;
    }
    
    // Record comprehensive error metrics
    await metricsService.recordErrorMetrics(
      'gateway',
      userId || 'unknown',
      errorType,
      correlationId,
      userId,
      totalLatency
    );

    contextLogger.performance('gateway_request_error', totalLatency, {
      method: event.httpMethod,
      path: event.path,
      errorType,
      statusCode,
    });

    correlationService.addBreadcrumb(correlationId, 'gateway', 'request_error', {
      errorType,
      errorMessage: errorInstance.message,
      latency: totalLatency,
      statusCode,
      timestamp: new Date().toISOString(),
    });

    // Add error to trace with detailed context
    contextLogger.addTraceMetadata('error', {
      type: errorType,
      message: errorInstance.message,
      stack: errorInstance.stack,
      statusCode,
      userId: userId || 'unknown',
    });

    // Log security events for authentication and rate limiting errors
    if (error instanceof AuthenticationError || error instanceof RateLimitError) {
      if (errorType === ErrorType.AUTHENTICATION_ERROR) {
        securityLogger.logAuthenticationAttempt(
          correlationId,
          userId || null,
          null,
          false,
          event.requestContext.identity?.sourceIp,
          event.headers['User-Agent'],
          errorInstance.message
        );
      } else if (errorType === ErrorType.RATE_LIMIT_EXCEEDED) {
        securityLogger.logRateLimitExceeded(
          correlationId,
          userId || 'unknown',
          'unknown',
          0,
          event.requestContext.identity?.sourceIp,
          event.headers['User-Agent']
        );
      }
    }

    // Create detailed error response using enhanced error handler
    const errorResponse = await ErrorHandler.handleLambdaError(error, correlationId, {
      userId,
      path: event.path,
      method: event.httpMethod,
      operation: 'gateway_request',
    });
    
    // Add correlation headers to error response
    const correlationHeaders = correlationService.getCorrelationHeaders(correlationId);
    errorResponse.headers = { ...errorResponse.headers, ...correlationHeaders };
    
    return finalizeResponse(errorResponse, event, correlationId);
  } finally {
    // Close tracing segment
    if (segment) {
      tracingService.addMetadata('request_summary', {
        totalLatency: Date.now() - startTime,
        correlationId,
      });
    }
    
    // Clean up old correlation contexts periodically
    if (Math.random() < 0.01) { // 1% chance
      correlationService.cleanup();
    }
  }
};

async function authenticateRequest(
  event: APIGatewayProxyEvent,
  correlationId: string
): Promise<{
  success: boolean;
  userId?: string;
  tier?: RateLimitTier;
  keyId?: string;
  error?: string;
}> {
  const apiKey = event.headers['X-API-Key'] || event.headers['x-api-key'];
  const sourceIp = event.requestContext.identity?.sourceIp;
  const userAgent = event.headers['User-Agent'];
  const contextLogger = correlationService.createContextualLogger(correlationId, 'AuthenticationHandler');

  if (!apiKey) {
    securityLogger.logAuthenticationAttempt(
      correlationId,
      null,
      null,
      false,
      sourceIp,
      userAgent,
      'Missing API key'
    );
    contextLogger.warn('Authentication failed: Missing API key', {
      sourceIp,
      userAgent,
      path: event.path,
    });
    return { success: false, error: 'API key required' };
  }

  try {
    const validation = await ErrorHandler.executeWithCircuitBreaker(
      () => ErrorHandler.executeWithRetry(
        () => apiKeyService.validateApiKey(apiKey),
        {
          maxRetries: 2,
          baseDelay: 500,
          maxDelay: 2000,
          retryCondition: (error) => {
            // Don't retry authentication errors, but retry service errors
            return !(error instanceof AuthenticationError);
          }
        }
      ),
      'api-key-service',
      correlationId
    );

    if (!validation.valid) {
      securityLogger.logAuthenticationAttempt(
        correlationId,
        validation.userId || null,
        apiKey,
        false,
        sourceIp,
        userAgent,
        'Invalid API key'
      );
      contextLogger.warn('Authentication failed: Invalid API key', {
        sourceIp,
        userAgent,
        path: event.path,
        keyId: validation.keyId,
      });
      return { success: false, error: 'Invalid API key' };
    }

    securityLogger.logAuthenticationAttempt(
      correlationId,
      validation.userId!,
      apiKey,
      true,
      sourceIp,
      userAgent
    );

    contextLogger.info('Authentication successful', {
      userId: validation.userId,
      tier: validation.tier,
      keyId: validation.keyId,
      sourceIp,
    });

    return {
      success: true,
      userId: validation.userId,
      tier: validation.tier,
      keyId: validation.keyId,
    };
  } catch (error) {
    contextLogger.error('Authentication service error', error as Error, {
      sourceIp,
      userAgent,
      path: event.path,
    });
    
    securityLogger.logAuthenticationAttempt(
      correlationId,
      null,
      apiKey,
      false,
      sourceIp,
      userAgent,
      `Service error: ${(error as Error).message}`
    );
    
    return { 
      success: false, 
      error: 'Authentication service temporarily unavailable' 
    };
  }
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

  if (path === '/api/v1/optimization/stats' && httpMethod === 'GET') {
    return handleOptimizationStats(correlationId);
  }

  // Default response for unhandled routes
  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-ID': correlationId,
    },
    body: JSON.stringify({
      error: 'Route not found',
      path,
      method: httpMethod,
    }),
  };
}

async function handleHealthCheck(correlationId: string): Promise<APIGatewayProxyResult> {
  const subsegment = logger.createSubsegment('health_check');
  
  try {
    await initializeHealth();
    
    const health = await healthService.getBasicHealth();
    const statusCode = health.status === 'healthy' ? 200 : 503;

    logger.closeSubsegment(subsegment);

    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        status: health.status,
        timestamp: health.timestamp,
        version: '1.0.0',
        correlationId,
      }),
    };
  } catch (error) {
    logger.error('Health check failed', error as Error);
    logger.closeSubsegment(subsegment, error as Error);

    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        correlationId,
        error: 'Health check failed',
      }),
    };
  }
}

async function handleOptimizationStats(correlationId: string): Promise<APIGatewayProxyResult> {
  try {
    const stats = batchedGateway.getOptimizationStats();
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        correlationId,
        optimization: stats,
      }),
    };
  } catch (error) {
    logger.error('Failed to get optimization stats', error as Error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        error: 'Failed to retrieve optimization statistics',
        correlationId,
      }),
    };
  }
}

async function handleCompletions(
  event: APIGatewayProxyEvent,
  userId: string,
  correlationId: string
): Promise<APIGatewayProxyResult> {
  const contextLogger = correlationService.createContextualLogger(correlationId, 'CompletionHandler');
  const subsegment = tracingService.createSubsegment('llm_completion', {
    userId,
    correlationId,
  });
  
  correlationService.addBreadcrumb(correlationId, 'gateway', 'completion_start', {
    timestamp: new Date().toISOString(),
  });
  
  try {
    if (!event.body) {
      throw new ValidationError('Request body is required', [
        { field: 'body', message: 'Request body cannot be empty' }
      ]);
    }

    // Initialize MCP service if needed
    await initializeMCP();

    // Validate and parse request with enhanced error handling
    let requestData: any;
    try {
      requestData = JSON.parse(event.body);
    } catch (parseError) {
      throw new ValidationError('Invalid JSON in request body', [
        { field: 'body', message: 'Request body must be valid JSON' }
      ]);
    }

    let llmRequest = ValidationHelper.validateLLMRequest(requestData);

    // Add user context to request
    llmRequest.metadata = {
      ...llmRequest.metadata,
      userId,
      customFields: { 
        correlationId,
        requestTimestamp: new Date().toISOString(),
        sourceIp: event.requestContext.identity?.sourceIp,
      },
    };

    // Add trace annotations
    tracingService.addAnnotation('model', llmRequest.model);
    tracingService.addAnnotation('userId', userId);
    tracingService.addAnnotation('messageCount', llmRequest.messages.length);
    tracingService.addAnnotation('hasMaxTokens', !!llmRequest.maxTokens);

    correlationService.addBreadcrumb(correlationId, 'gateway', 'request_validated', {
      model: llmRequest.model,
      messageCount: llmRequest.messages.length,
      maxTokens: llmRequest.maxTokens,
      temperature: llmRequest.temperature,
    });

    // Check cache first for potential cost savings
    const cacheKey = await cacheManager.generateCacheKey(llmRequest);
    const cachedResponse = await cacheManager.get(cacheKey);
    
    if (cachedResponse) {
      contextLogger.info('Serving cached response', {
        userId,
        model: llmRequest.model,
        cacheKey: cacheKey.substring(0, 16) + '...',
      });

      correlationService.addBreadcrumb(correlationId, 'gateway', 'cache_hit', {
        cacheKey: cacheKey.substring(0, 16) + '...',
      });

      // Add cache headers
      const cacheHeaders = {
        'X-Request-Cached': 'true',
        'X-Cache-Hit': 'true',
        'X-Provider-Used': cachedResponse.provider,
      };

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId,
          ...cacheHeaders,
        },
        body: JSON.stringify({
          ...cachedResponse,
          cached: true,
          metadata: {
            ...cachedResponse.metadata,
            servedFromCache: true,
            cacheTimestamp: new Date().toISOString(),
          },
        }),
      };
    }

    // Inject MCP context if applicable with enhanced error handling
    const mcpSubsegment = tracingService.createSubsegment('mcp_context_injection');
    try {
      llmRequest = await ErrorHandler.executeWithCircuitBreaker(
        () => ErrorHandler.executeWithRetry(
          () => mcpContextService.injectMCPContext(llmRequest),
          {
            maxRetries: 2,
            baseDelay: 500,
            maxDelay: 2000,
            retryCondition: (error) => {
              // Retry on timeout or provider errors, but not on validation errors
              return !(error instanceof ValidationError);
            }
          }
        ),
        'mcp-service',
        correlationId
      );
    } catch (mcpError) {
      contextLogger.warn('MCP context injection failed, continuing without context', {
        error: (mcpError as Error).message,
        userId,
        errorType: (mcpError as Error).constructor.name,
      });
      
      correlationService.addBreadcrumb(correlationId, 'gateway', 'mcp_injection_failed', {
        error: (mcpError as Error).message,
        fallbackStrategy: 'continue_without_context',
      });
      
      // Continue without MCP context rather than failing the entire request
      // This ensures graceful degradation when MCP services are unavailable
    }
    
    tracingService.closeSubsegment(mcpSubsegment, undefined, {
      mcpContextInjected: (llmRequest.metadata as any)?.mcpContextInjected || false,
    });

    // Determine routing criteria based on request characteristics
    const routingCriteria = determineRoutingCriteria(llmRequest, userId);

    correlationService.addBreadcrumb(correlationId, 'gateway', 'routing_determined', {
      strategy: routingCriteria.strategy,
      maxCost: routingCriteria.maxCost,
      maxLatency: routingCriteria.maxLatency,
    });

    // Process through batched gateway service with enhanced error handling
    const processingSubsegment = tracingService.createSubsegment('request_processing');
    let response: LLMResponse;
    
    try {
      // Use enhanced error handler with circuit breaker and retry logic
      response = await ErrorHandler.executeWithCircuitBreaker(
        () => ErrorHandler.executeWithRetry(
          () => batchedGateway.processRequest(llmRequest, routingCriteria),
          {
            maxRetries: providerConfigs.find(p => p.enabled)?.retryAttempts || 3,
            baseDelay: providerConfigs.find(p => p.enabled)?.retryDelay || 1000,
            maxDelay: 30000,
            retryCondition: (error) => {
              // Don't retry validation errors or authentication errors
              return !(error instanceof ValidationError || error instanceof AuthenticationError);
            }
          }
        ),
        'llm-processing',
        correlationId
      );
    } catch (processingError) {
      // Enhanced fallback strategy
      contextLogger.warn('Primary processing failed, attempting fallback strategies', {
        userId,
        model: llmRequest.model,
        error: (processingError as Error).message,
      });

      // Strategy 1: Try to serve stale cache if available
      const staleResponse = await cacheManager.getStale(cacheKey);
      if (staleResponse) {
        contextLogger.info('Serving stale cached response as fallback', {
          userId,
          model: llmRequest.model,
          cacheAge: Date.now() - new Date(staleResponse.metadata?.timestamp || 0).getTime(),
        });

        correlationService.addBreadcrumb(correlationId, 'gateway', 'stale_cache_fallback', {
          reason: 'Provider processing failed',
          cacheAge: Date.now() - new Date(staleResponse.metadata?.timestamp || 0).getTime(),
        });

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Correlation-ID': correlationId,
            'X-Request-Cached': 'true',
            'X-Cache-Stale': 'true',
            'X-Provider-Used': staleResponse.provider,
            'X-Fallback-Strategy': 'stale-cache',
            'Warning': '110 - "Response is stale due to service unavailability"',
          },
          body: JSON.stringify({
            ...staleResponse,
            cached: true,
            stale: true,
            metadata: {
              ...staleResponse.metadata,
              servedFromStaleCache: true,
              fallbackReason: 'Provider processing failed',
              fallbackTimestamp: new Date().toISOString(),
            },
          }),
        };
      }

      // Strategy 2: If it's a circuit breaker error, provide helpful response
      if (processingError instanceof CircuitBreakerError) {
        throw new ProviderError(
          'All AI providers are temporarily unavailable due to high error rates. Please try again in a few minutes.',
          'circuit-breaker'
        );
      }

      // Strategy 3: If it's a timeout, suggest retry with simpler request
      if (processingError instanceof TimeoutError) {
        throw new TimeoutError(
          'Request processing timed out. Please try again with a shorter message or simpler request.',
          (processingError as TimeoutError).timeoutMs
        );
      }

      // Re-throw the original error if no fallback strategies work
      throw processingError;
    }
    
    tracingService.closeSubsegment(processingSubsegment, undefined, {
      provider: response.provider,
      cached: response.cached || false,
      cost: response.cost.total,
      tokens: response.usage.totalTokens,
    });

    // Cache the successful response
    if (!response.cached) {
      await cacheManager.set(cacheKey, response, {
        ttl: parseInt(process.env.RESPONSE_CACHE_TTL || '300'), // 5 minutes default
      });
    }

    // Record comprehensive metrics
    await metricsService.recordRequestMetrics(
      llmRequest,
      response,
      correlationId,
      userId,
      response.cached || false
    );

    correlationService.addBreadcrumb(correlationId, 'gateway', 'completion_success', {
      provider: response.provider,
      tokens: response.usage.totalTokens,
      cost: response.cost.total,
      latency: response.latency,
      cached: response.cached || false,
      timestamp: new Date().toISOString(),
    });

    contextLogger.info('LLM completion successful', {
      userId,
      model: llmRequest.model,
      provider: response.provider,
      tokens: response.usage.totalTokens,
      cost: response.cost.total,
      latency: response.latency,
      cached: response.cached || false,
      mcpContextInjected: (llmRequest.metadata as any)?.mcpContextInjected || false,
      mcpToolCalls: (llmRequest.metadata as any)?.mcpToolCalls || [],
    });

    // Add trace metadata
    tracingService.addMetadata('llm_response', {
      provider: response.provider,
      model: llmRequest.model,
      tokens: response.usage.totalTokens,
      cost: response.cost.total,
      latency: response.latency,
      cached: response.cached || false,
    });

    // Transform response for client consumption
    const transformedResponse = transformLLMResponse(response, llmRequest, correlationId);

    // Add optimization and debugging headers
    const responseHeaders = {
      'X-Request-Cached': String(response.cached || false),
      'X-Provider-Used': response.provider,
      'X-Cost-Optimized': 'true',
      'X-Request-Tokens': response.usage.totalTokens.toString(),
      'X-Request-Cost': response.cost.total.toFixed(6),
      'X-Response-Latency': response.latency.toString(),
    };

    tracingService.closeSubsegment(subsegment, undefined, {
      success: true,
      statusCode: 200,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
        ...responseHeaders,
      },
      body: JSON.stringify(transformedResponse),
    };
  } catch (error) {
    const errorInstance = error as Error;
    contextLogger.error('LLM completion failed', errorInstance, { 
      userId,
      path: event.path,
      method: event.httpMethod,
    });
    
    correlationService.addBreadcrumb(correlationId, 'gateway', 'completion_error', {
      error: errorInstance.message,
      errorType: errorInstance.constructor.name,
      timestamp: new Date().toISOString(),
    });
    
    // Record error metrics with detailed context
    const errorType = error instanceof ValidationError ? 'VALIDATION_ERROR' : 
                     errorInstance.message.includes('Circuit breaker') ? 'PROVIDER_UNAVAILABLE' :
                     'LLM_COMPLETION_ERROR';
    
    await metricsService.recordErrorMetrics(
      'completion',
      userId,
      errorType,
      correlationId,
      userId
    );

    tracingService.closeSubsegment(subsegment, errorInstance, {
      success: false,
      errorType,
    });
    
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

/**
 * Determine optimal routing criteria based on request characteristics
 */
function determineRoutingCriteria(request: LLMRequest, userId: string) {
  // Estimate request complexity and cost
  const messageLength = request.messages.reduce((sum, msg) => sum + msg.content.length, 0);
  const maxTokens = request.maxTokens || 1000;
  
  // Default to cost optimization
  let strategy = RoutingStrategy.COST_OPTIMIZED;
  
  // Switch to latency optimization for short, interactive requests
  if (messageLength < 500 && maxTokens < 500) {
    strategy = RoutingStrategy.LATENCY_OPTIMIZED;
  }
  
  // Use priority-based routing for enterprise users (simplified check)
  if (userId.includes('enterprise') || userId.includes('premium')) {
    strategy = RoutingStrategy.PRIORITY_BASED;
  }

  return {
    strategy,
    maxCost: parseFloat(process.env.MAX_REQUEST_COST || '1.0'),
    maxLatency: parseInt(process.env.MAX_REQUEST_LATENCY_MS || '30000'),
  };
}

/**
 * Create standardized error response
 */
function createErrorResponse(
  statusCode: number,
  message: string,
  correlationId: string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-ID': correlationId,
    },
    body: JSON.stringify({
      error: {
        message,
        correlationId,
        timestamp: new Date().toISOString(),
      },
    }),
  };
}

/**
 * Create detailed error response with comprehensive error information
 */
function createDetailedErrorResponse(
  statusCode: number,
  errorType: ErrorType,
  message: string,
  correlationId: string,
  retryAfter?: number,
  validationErrors?: Array<{ field: string; message: string }>
): APIGatewayProxyResult {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Correlation-ID': correlationId,
  };

  if (retryAfter) {
    headers['Retry-After'] = retryAfter.toString();
  }

  const errorBody: any = {
    error: {
      type: errorType,
      message,
      code: `E${statusCode}_${errorType}`,
      correlationId,
      timestamp: new Date().toISOString(),
    },
  };

  if (validationErrors && validationErrors.length > 0) {
    errorBody.error.details = {
      validationErrors,
    };
  }

  // Add helpful error context based on error type
  switch (errorType) {
    case ErrorType.RATE_LIMIT_EXCEEDED:
      errorBody.error.details = {
        ...errorBody.error.details,
        retryAfter,
        documentation: 'https://docs.ai-gateway.com/rate-limits',
      };
      break;
    case ErrorType.PROVIDER_UNAVAILABLE:
      errorBody.error.details = {
        ...errorBody.error.details,
        suggestion: 'All providers are currently unavailable. Please try again later.',
        documentation: 'https://docs.ai-gateway.com/provider-status',
      };
      break;
    case ErrorType.AUTHENTICATION_ERROR:
      errorBody.error.details = {
        ...errorBody.error.details,
        suggestion: 'Check your API key and ensure it has the required permissions.',
        documentation: 'https://docs.ai-gateway.com/authentication',
      };
      break;
  }

  return {
    statusCode,
    headers,
    body: JSON.stringify(errorBody),
  };
}

/**
 * Transform LLM response for client consumption
 */
function transformLLMResponse(
  response: LLMResponse,
  originalRequest: LLMRequest,
  correlationId: string
): any {
  return {
    id: response.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: response.choices.map((choice, index) => ({
      index,
      message: {
        role: choice.message.role,
        content: choice.message.content,
        ...(choice.message.functionCall && { function_call: choice.message.functionCall }),
      },
      finish_reason: choice.finishReason,
    })),
    usage: {
      prompt_tokens: response.usage.promptTokens,
      completion_tokens: response.usage.completionTokens,
      total_tokens: response.usage.totalTokens,
    },
    // Gateway-specific metadata
    gateway_metadata: {
      provider: response.provider,
      cost: response.cost,
      latency: response.latency,
      cached: response.cached || false,
      correlation_id: correlationId,
      request_id: response.id,
      ...(originalRequest.metadata?.mcpContextInjected && {
        mcp_context_injected: true,
        mcp_tool_calls: originalRequest.metadata.mcpToolCalls || [],
      }),
    },
  };
}

/**
 * Finalize response with security headers and CORS
 */
function finalizeResponse(
  response: APIGatewayProxyResult,
  event: APIGatewayProxyEvent,
  correlationId: string
): APIGatewayProxyResult {
  // Add security headers
  let finalResponse = SecurityMiddleware.addSecurityHeaders(response, correlationId);

  // Add CORS headers
  finalResponse = CorsMiddleware.addCorsHeaders(finalResponse, event, correlationId);

  return finalResponse;
}

async function handleDetailedHealthCheck(correlationId: string): Promise<APIGatewayProxyResult> {
  const subsegment = logger.createSubsegment('detailed_health_check');
  
  try {
    await initializeHealth();
    
    const healthReport = await healthService.getDetailedHealthReport();
    const statusCode = healthReport.system.status === 'healthy' ? 200 : 
                      healthReport.system.status === 'degraded' ? 200 : 503;

    logger.closeSubsegment(subsegment);

    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        ...healthReport,
        correlationId,
        version: '1.0.0',
      }),
    };
  } catch (error) {
    logger.error('Detailed health check failed', error as Error);
    logger.closeSubsegment(subsegment, error as Error);

    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        correlationId,
        error: 'Detailed health check failed',
      }),
    };
  }
}

async function handleIncidentsCheck(correlationId: string): Promise<APIGatewayProxyResult> {
  const subsegment = tracingService.createSubsegment('incidents_check');
  
  try {
    const activeIncidents = runbookService.getActiveIncidents();
    const incidentStats = runbookService.getIncidentStatistics();
    const securityAnalysis = await securityMonitor.analyzeSecurityMetrics();

    const response = {
      activeIncidents: activeIncidents.length,
      incidentStatistics: incidentStats,
      securityRiskLevel: securityAnalysis.riskLevel,
      recentAlerts: securityAnalysis.alerts.slice(0, 5), // Last 5 alerts
      correlationId,
      timestamp: new Date().toISOString(),
    };

    tracingService.closeSubsegment(subsegment);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error('Incidents check failed', error as Error);
    tracingService.closeSubsegment(subsegment, error as Error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        error: 'Incidents check failed',
        correlationId,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}

async function handleMetricsCheck(correlationId: string): Promise<APIGatewayProxyResult> {
  const subsegment = tracingService.createSubsegment('metrics_check');
  
  try {
    const metricsStats = metricsService.getMetricsStats();
    const correlationStats = correlationService.getStatistics();
    const securityDashboard = securityMonitor.generateDashboardData();

    const response = {
      metrics: {
        batchedCount: metricsStats.batchedCount,
        namespace: metricsStats.namespace,
      },
      correlation: {
        activeContexts: correlationStats.totalContexts,
        averageBreadcrumbs: correlationStats.averageBreadcrumbs,
      },
      security: {
        systemStatus: securityDashboard.systemStatus,
        realTimeEvents: securityDashboard.realTimeMetrics.events,
      },
      tracing: {
        enabled: tracingService.isTracingEnabled(),
        currentTraceId: tracingService.getCurrentTraceId(),
      },
      correlationId,
      timestamp: new Date().toISOString(),
    };

    tracingService.closeSubsegment(subsegment);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error('Metrics check failed', error as Error);
    tracingService.closeSubsegment(subsegment, error as Error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        error: 'Metrics check failed',
        correlationId,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}

async function handleCircuitBreakerCheck(correlationId: string): Promise<APIGatewayProxyResult> {
  const subsegment = tracingService.createSubsegment('circuit_breaker_check');
  
  try {
    const circuitBreakerStatus = ErrorHandler.getCircuitBreakerStatus();
    const mcpHealthStatus = await mcpContextService.getHealthStatus();
    
    // Calculate overall system health based on circuit breaker states
    const openCircuitBreakers = Object.values(circuitBreakerStatus).filter(cb => cb.state === 'OPEN');
    const degradedCircuitBreakers = Object.values(circuitBreakerStatus).filter(cb => cb.state === 'HALF_OPEN');
    
    let systemStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (openCircuitBreakers.length > 0) {
      systemStatus = 'unhealthy';
    } else if (degradedCircuitBreakers.length > 0 || mcpHealthStatus.status !== 'healthy') {
      systemStatus = 'degraded';
    } else {
      systemStatus = 'healthy';
    }

    const response = {
      systemStatus,
      circuitBreakers: circuitBreakerStatus,
      mcpService: mcpHealthStatus,
      summary: {
        totalCircuitBreakers: Object.keys(circuitBreakerStatus).length,
        openCircuitBreakers: openCircuitBreakers.length,
        degradedCircuitBreakers: degradedCircuitBreakers.length,
        healthyCircuitBreakers: Object.values(circuitBreakerStatus).filter(cb => cb.state === 'CLOSED').length,
      },
      correlationId,
      timestamp: new Date().toISOString(),
    };

    tracingService.closeSubsegment(subsegment);

    const statusCode = systemStatus === 'healthy' ? 200 : systemStatus === 'degraded' ? 200 : 503;

    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
        'X-System-Status': systemStatus,
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error('Circuit breaker check failed', error as Error);
    tracingService.closeSubsegment(subsegment, error as Error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        error: 'Circuit breaker check failed',
        correlationId,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}
