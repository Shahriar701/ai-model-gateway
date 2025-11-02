import { APIGatewayProxyResult } from 'aws-lambda';
import { ErrorType, ErrorResponse } from '../types';
import { Logger } from './logger';
import { MetricsService } from '../../services/monitoring/metrics-service';
import { SecurityLogger } from './security-logger';
import { CorrelationService } from '../../services/monitoring/correlation-service';

const logger = new Logger('ErrorHandler');

/**
 * Enhanced centralized error handling for Lambda functions
 * Provides consistent error responses, logging, monitoring, and recovery strategies
 */
export class ErrorHandler {
  private static metricsService = MetricsService.getInstance();
  private static securityLogger = SecurityLogger.getInstance();
  private static correlationService = CorrelationService.getInstance();

  /**
   * Circuit breaker state management
   */
  private static circuitBreakers = new Map<string, CircuitBreakerState>();
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private static readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute
  private static readonly CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS = 3;
  static async handleLambdaError(
    error: unknown, 
    correlationId: string,
    context?: {
      userId?: string;
      path?: string;
      method?: string;
      provider?: string;
      operation?: string;
    }
  ): Promise<APIGatewayProxyResult> {
    const contextLogger = this.correlationService.createContextualLogger(correlationId, 'ErrorHandler');
    const errorInstance = error as Error;

    // Record error occurrence for circuit breaker
    if (context?.provider) {
      this.recordProviderError(context.provider);
    }

    // Log error with full context
    contextLogger.error('Handling Lambda error', errorInstance, {
      userId: context?.userId,
      path: context?.path,
      method: context?.method,
      provider: context?.provider,
      operation: context?.operation,
    });

    // Add breadcrumb for error tracking
    this.correlationService.addBreadcrumb(correlationId, 'error_handler', 'error_occurred', {
      errorType: errorInstance.constructor.name,
      errorMessage: errorInstance.message,
      context,
    });

    let statusCode: number;
    let errorType: ErrorType;
    let retryAfter: number | undefined;
    let details: Record<string, any> | undefined;

    // Enhanced error classification and handling
    if (error instanceof ValidationError) {
      statusCode = 400;
      errorType = ErrorType.INVALID_REQUEST;
      details = { 
        validationErrors: error.details,
        suggestion: 'Please check your request format and required fields.',
      };
      
      await this.metricsService.recordErrorMetrics(
        context?.operation || 'unknown',
        context?.userId || 'unknown',
        errorType,
        correlationId,
        context?.userId
      );

    } else if (error instanceof AuthenticationError) {
      statusCode = 401;
      errorType = ErrorType.AUTHENTICATION_ERROR;
      details = {
        suggestion: 'Please check your API key and ensure it has the required permissions.',
        documentation: 'https://docs.ai-gateway.com/authentication',
      };

      // Log security event
      this.securityLogger.logAuthenticationAttempt(
        correlationId,
        context?.userId || null,
        null,
        false,
        undefined,
        undefined,
        errorInstance.message
      );

      await this.metricsService.recordErrorMetrics(
        context?.operation || 'authentication',
        context?.userId || 'unknown',
        errorType,
        correlationId,
        context?.userId
      );

    } else if (error instanceof RateLimitError) {
      statusCode = 429;
      errorType = ErrorType.RATE_LIMIT_EXCEEDED;
      retryAfter = error.retryAfter;
      details = {
        retryAfter,
        suggestion: 'Please wait before making another request or upgrade your plan for higher limits.',
        documentation: 'https://docs.ai-gateway.com/rate-limits',
      };

      // Log security event for potential abuse
      this.securityLogger.logRateLimitExceeded(
        correlationId,
        context?.userId || 'unknown',
        'unknown',
        0,
        undefined,
        undefined
      );

      await this.metricsService.recordErrorMetrics(
        context?.operation || 'rate_limit',
        context?.userId || 'unknown',
        errorType,
        correlationId,
        context?.userId
      );

    } else if (error instanceof ProviderError) {
      statusCode = 503;
      errorType = ErrorType.PROVIDER_UNAVAILABLE;
      retryAfter = 60; // Suggest retry after 1 minute
      details = {
        provider: error.provider,
        retryAfter,
        suggestion: 'The AI provider is temporarily unavailable. Please try again later.',
        documentation: 'https://docs.ai-gateway.com/provider-status',
      };

      await this.metricsService.recordErrorMetrics(
        context?.operation || 'provider',
        context?.userId || 'unknown',
        errorType,
        correlationId,
        context?.userId
      );

    } else if (error instanceof CircuitBreakerError) {
      statusCode = 503;
      errorType = ErrorType.PROVIDER_UNAVAILABLE;
      retryAfter = Math.ceil(this.CIRCUIT_BREAKER_TIMEOUT / 1000);
      details = {
        circuitBreakerOpen: true,
        retryAfter,
        suggestion: 'Service is temporarily unavailable due to repeated failures. Please try again later.',
      };

      await this.metricsService.recordErrorMetrics(
        context?.operation || 'circuit_breaker',
        context?.userId || 'unknown',
        errorType,
        correlationId,
        context?.userId
      );

    } else if (error instanceof TimeoutError) {
      statusCode = 504;
      errorType = ErrorType.INTERNAL_ERROR;
      retryAfter = 30;
      details = {
        timeout: true,
        retryAfter,
        suggestion: 'Request timed out. Please try again with a simpler request or try again later.',
      };

      await this.metricsService.recordErrorMetrics(
        context?.operation || 'timeout',
        context?.userId || 'unknown',
        'TIMEOUT_ERROR',
        correlationId,
        context?.userId
      );

    } else {
      // Handle unexpected errors
      statusCode = 500;
      errorType = ErrorType.INTERNAL_ERROR;
      details = {
        suggestion: 'An unexpected error occurred. Please try again later or contact support if the issue persists.',
        supportContact: 'support@ai-gateway.com',
      };

      // Log unexpected errors with full stack trace
      contextLogger.error('Unexpected error occurred', errorInstance, {
        stack: errorInstance.stack,
        context,
      });

      await this.metricsService.recordErrorMetrics(
        context?.operation || 'unknown',
        context?.userId || 'unknown',
        errorType,
        correlationId,
        context?.userId
      );
    }

    return this.createEnhancedErrorResponse(
      statusCode,
      errorType,
      errorInstance.message,
      correlationId,
      details,
      retryAfter
    );
  }

  /**
   * Execute operation with circuit breaker protection
   */
  static async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    serviceName: string,
    correlationId?: string
  ): Promise<T> {
    const state = this.getCircuitBreakerState(serviceName);
    
    if (state.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - state.lastFailureTime;
      if (timeSinceLastFailure < this.CIRCUIT_BREAKER_TIMEOUT) {
        throw new CircuitBreakerError(`Circuit breaker is open for service: ${serviceName}`);
      } else {
        // Transition to HALF_OPEN
        state.state = 'HALF_OPEN';
        state.halfOpenAttempts = 0;
      }
    }

    if (state.state === 'HALF_OPEN' && state.halfOpenAttempts >= this.CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS) {
      throw new CircuitBreakerError(`Circuit breaker is half-open and max attempts reached for service: ${serviceName}`);
    }

    try {
      const result = await operation();
      this.recordCircuitBreakerSuccess(serviceName);
      return result;
    } catch (error) {
      this.recordCircuitBreakerFailure(serviceName);
      throw error;
    }
  }

  /**
   * Execute operation with retry logic and exponential backoff
   */
  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      baseDelay?: number;
      maxDelay?: number;
      backoffMultiplier?: number;
      retryCondition?: (error: Error) => boolean;
    } = {}
  ): Promise<T> {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      maxDelay = 30000,
      backoffMultiplier = 2,
      retryCondition = (error) => !(error instanceof ValidationError || error instanceof AuthenticationError)
    } = options;

    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries || !retryCondition(lastError)) {
          throw lastError;
        }
        
        // Calculate delay with exponential backoff and jitter
        const delay = Math.min(
          baseDelay * Math.pow(backoffMultiplier, attempt),
          maxDelay
        );
        const jitteredDelay = delay + Math.random() * 1000;
        
        logger.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${jitteredDelay}ms`, {
          error: lastError.message,
          attempt: attempt + 1,
          delay: jitteredDelay,
        });
        
        await new Promise(resolve => setTimeout(resolve, jitteredDelay));
      }
    }
    
    throw lastError!;
  }

  /**
   * Circuit breaker state management methods
   */
  private static getCircuitBreakerState(serviceName: string): CircuitBreakerState {
    if (!this.circuitBreakers.has(serviceName)) {
      this.circuitBreakers.set(serviceName, {
        state: 'CLOSED',
        failures: 0,
        lastFailureTime: 0,
        halfOpenAttempts: 0,
      });
    }
    return this.circuitBreakers.get(serviceName)!;
  }

  private static recordProviderError(serviceName: string): void {
    const state = this.getCircuitBreakerState(serviceName);
    state.failures++;
    state.lastFailureTime = Date.now();
    
    if (state.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      state.state = 'OPEN';
      logger.warn(`Circuit breaker opened for service: ${serviceName}`, {
        failures: state.failures,
        threshold: this.CIRCUIT_BREAKER_THRESHOLD,
      });
    }
  }

  private static recordCircuitBreakerSuccess(serviceName: string): void {
    const state = this.getCircuitBreakerState(serviceName);
    
    if (state.state === 'HALF_OPEN') {
      state.halfOpenAttempts++;
      if (state.halfOpenAttempts >= this.CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS) {
        state.state = 'CLOSED';
        state.failures = 0;
        logger.info(`Circuit breaker closed for service: ${serviceName}`);
      }
    } else {
      state.failures = 0;
      state.state = 'CLOSED';
    }
  }

  private static recordCircuitBreakerFailure(serviceName: string): void {
    const state = this.getCircuitBreakerState(serviceName);
    state.failures++;
    state.lastFailureTime = Date.now();
    
    if (state.state === 'HALF_OPEN' || state.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      state.state = 'OPEN';
      logger.warn(`Circuit breaker opened for service: ${serviceName}`, {
        failures: state.failures,
        previousState: state.state,
      });
    }
  }

  private static createEnhancedErrorResponse(
    statusCode: number,
    errorType: ErrorType,
    message: string,
    correlationId: string,
    details?: Record<string, any>,
    retryAfter?: number
  ): APIGatewayProxyResult {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Correlation-ID': correlationId,
      'X-Error-Type': errorType,
      'X-Timestamp': new Date().toISOString(),
    };

    if (retryAfter) {
      headers['Retry-After'] = retryAfter.toString();
    }

    const errorResponse: ErrorResponse = {
      error: {
        type: errorType,
        message,
        code: `E${statusCode}_${errorType}`,
        details,
        retryAfter,
      },
      requestId: correlationId,
      timestamp: new Date().toISOString(),
    };

    // Add helpful context based on error type
    if (statusCode >= 500) {
      errorResponse.error.details = {
        ...errorResponse.error.details,
        incidentId: `INC_${correlationId}_${Date.now()}`,
        supportInfo: 'If this error persists, please contact support with the incident ID.',
      };
    }

    return {
      statusCode,
      headers,
      body: JSON.stringify(errorResponse, null, 2), // Pretty print for better readability
    };
  }

  /**
   * Get circuit breaker status for monitoring
   */
  static getCircuitBreakerStatus(): Record<string, CircuitBreakerState> {
    const status: Record<string, CircuitBreakerState> = {};
    for (const [serviceName, state] of this.circuitBreakers.entries()) {
      status[serviceName] = { ...state };
    }
    return status;
  }

  /**
   * Reset circuit breaker for a specific service (admin function)
   */
  static resetCircuitBreaker(serviceName: string): boolean {
    if (this.circuitBreakers.has(serviceName)) {
      this.circuitBreakers.set(serviceName, {
        state: 'CLOSED',
        failures: 0,
        lastFailureTime: 0,
        halfOpenAttempts: 0,
      });
      logger.info(`Circuit breaker reset for service: ${serviceName}`);
      return true;
    }
    return false;
  }

  /**
   * Create user-friendly error message based on error type
   */
  static createUserFriendlyMessage(error: Error): string {
    if (error instanceof ValidationError) {
      return 'Please check your request format and try again.';
    }
    if (error instanceof AuthenticationError) {
      return 'Authentication failed. Please check your API key.';
    }
    if (error instanceof RateLimitError) {
      return 'Too many requests. Please wait before trying again.';
    }
    if (error instanceof ProviderError) {
      return 'AI service is temporarily unavailable. Please try again later.';
    }
    if (error instanceof CircuitBreakerError) {
      return 'Service is temporarily unavailable due to high error rates. Please try again later.';
    }
    if (error instanceof TimeoutError) {
      return 'Request timed out. Please try again.';
    }
    return 'An unexpected error occurred. Please try again later.';
  }
}

// Enhanced custom error classes
export class ValidationError extends Error {
  constructor(
    message: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter: number,
    public tier?: string
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string, public serviceName?: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string, public timeoutMs?: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class MCPError extends Error {
  constructor(
    message: string,
    public toolName?: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'MCPError';
  }
}

export class ConfigurationError extends Error {
  constructor(message: string, public configKey?: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// Circuit breaker state interface
interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  lastFailureTime: number;
  halfOpenAttempts: number;
}
