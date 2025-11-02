import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger, ErrorHandler, AuthenticationError, RateLimitError } from '../../shared/utils';
import { ApiKeyService, RateLimiter } from '../../services/auth';
import { ProviderRouter } from '../../services/router';
import { OpenAIProvider, BedrockProvider } from '../../services/providers';
import { MCPContextService } from '../../services/mcp';
import { ValidationHelper } from '../../shared/validation';
import { LLMRequest, RateLimitTier, RoutingStrategy } from '../../shared/types';
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

// Initialize providers and router
const providers = [new OpenAIProvider(), new BedrockProvider()];

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
    models: ['gpt-4', 'gpt-3.5-turbo'],
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
    models: ['claude-3', 'llama-2'],
  },
];

const router = new ProviderRouter(providers, providerConfigs);

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
 * Handles routing, authentication, and request processing
 * Updated to test GitHub Actions deployment pipeline
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const correlationId = correlationService.extractCorrelationFromHeaders(event.headers);
  const startTime = Date.now();
  
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

    // Handle admin API endpoints (no authentication required here as AdminApi handles it)
    if (sanitizedEvent.path.startsWith('/api/v1/admin/')) {
      const adminResponse = await adminApi.handleRequest(sanitizedEvent);
      return finalizeResponse(adminResponse, event, correlationId);
    }

    // Authenticate request
    const authStartTime = Date.now();
    const authResult = await authenticateRequest(sanitizedEvent);
    const authLatency = Date.now() - authStartTime;
    
    if (!authResult.success) {
      await metricsService.recordAuthMetrics(false, 'unknown', correlationId, authLatency);
      throw new AuthenticationError(authResult.error || 'Authentication failed');
    }

    const { userId, tier, keyId } = authResult;
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
    const errorType = error instanceof AuthenticationError ? 'AUTHENTICATION_ERROR' :
                     error instanceof RateLimitError ? 'RATE_LIMIT_EXCEEDED' : 'INTERNAL_ERROR';
    
    await metricsService.recordErrorMetrics(
      'gateway',
      'unknown',
      errorType,
      correlationId,
      undefined,
      totalLatency
    );

    contextLogger.performance('gateway_request_error', totalLatency, {
      method: event.httpMethod,
      path: event.path,
      errorType,
    });

    correlationService.addBreadcrumb(correlationId, 'gateway', 'request_error', {
      errorType,
      errorMessage: (error as Error).message,
      latency: totalLatency,
    });

    // Add error to trace
    contextLogger.addTraceMetadata('error', {
      type: errorType,
      message: (error as Error).message,
      stack: (error as Error).stack,
    });

    const errorResponse = ErrorHandler.handleLambdaError(error, correlationId);
    
    // Add correlation headers to error response
    const correlationHeaders = correlationService.getCorrelationHeaders(correlationId);
    errorResponse.headers = { ...errorResponse.headers, ...correlationHeaders };
    
    return finalizeResponse(errorResponse, event, correlationId);
  } finally {
    // Clean up old correlation contexts periodically
    if (Math.random() < 0.01) { // 1% chance
      correlationService.cleanup();
    }
  }
};

async function authenticateRequest(event: APIGatewayProxyEvent): Promise<{
  success: boolean;
  userId?: string;
  tier?: RateLimitTier;
  keyId?: string;
  error?: string;
}> {
  const correlationId = event.requestContext.requestId;
  const apiKey = event.headers['X-API-Key'] || event.headers['x-api-key'];
  const sourceIp = event.requestContext.identity?.sourceIp;
  const userAgent = event.headers['User-Agent'];

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
    return { success: false, error: 'API key required' };
  }

  const validation = await apiKeyService.validateApiKey(apiKey);

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

  return {
    success: true,
    userId: validation.userId,
    tier: validation.tier,
    keyId: validation.keyId,
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
  
  correlationService.addBreadcrumb(correlationId, 'gateway', 'completion_start');
  
  try {
    if (!event.body) {
      throw new Error('Request body is required');
    }

    // Initialize MCP service if needed
    await initializeMCP();

    // Validate request
    const requestData = JSON.parse(event.body);
    let llmRequest = ValidationHelper.validateLLMRequest(requestData);

    // Add user context to request
    llmRequest.metadata = {
      ...llmRequest.metadata,
      userId,
      customFields: { correlationId },
    };

    // Add trace annotations
    tracingService.addAnnotation('model', llmRequest.model);
    tracingService.addAnnotation('userId', userId);
    tracingService.addAnnotation('messageCount', llmRequest.messages.length);

    correlationService.addBreadcrumb(correlationId, 'gateway', 'request_validated', {
      model: llmRequest.model,
      messageCount: llmRequest.messages.length,
    });

    // Inject MCP context if applicable
    const mcpSubsegment = tracingService.createSubsegment('mcp_context_injection');
    llmRequest = await mcpContextService.injectMCPContext(llmRequest);
    tracingService.closeSubsegment(mcpSubsegment, undefined, {
      mcpContextInjected: (llmRequest.metadata as any)?.mcpContextInjected || false,
    });

    // Determine routing criteria based on request characteristics
    const routingCriteria = determineRoutingCriteria(llmRequest, userId);

    correlationService.addBreadcrumb(correlationId, 'gateway', 'routing_determined', {
      strategy: routingCriteria.strategy,
    });

    // Process through batched gateway service with optimization
    const processingSubsegment = tracingService.createSubsegment('request_processing');
    const response = await batchedGateway.processRequest(llmRequest, routingCriteria);
    tracingService.closeSubsegment(processingSubsegment, undefined, {
      provider: response.provider,
      cached: response.cached || false,
      cost: response.cost.total,
    });

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

    // Add optimization headers
    const optimizationHeaders = {
      'X-Request-Cached': String(response.cached || false),
      'X-Provider-Used': response.provider,
      'X-Cost-Optimized': 'true',
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
        ...optimizationHeaders,
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    contextLogger.error('LLM completion failed', error as Error, { userId });
    
    correlationService.addBreadcrumb(correlationId, 'gateway', 'completion_error', {
      error: (error as Error).message,
    });
    
    // Record error metrics
    await metricsService.recordErrorMetrics(
      'unknown',
      'unknown',
      'LLM_COMPLETION_ERROR',
      correlationId,
      userId
    );

    tracingService.closeSubsegment(subsegment, error as Error, {
      success: false,
      errorType: 'LLM_COMPLETION_ERROR',
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
