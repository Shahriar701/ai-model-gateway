import { APIGatewayProxyResult } from 'aws-lambda';
import { ErrorType, ErrorResponse } from '../types';
import { Logger } from './logger';

const logger = new Logger('ErrorHandler');

/**
 * Centralized error handling for Lambda functions
 * Provides consistent error responses and logging
 */
export class ErrorHandler {
  static handleLambdaError(error: unknown, correlationId: string): APIGatewayProxyResult {
    logger.setCorrelationId(correlationId);

    if (error instanceof ValidationError) {
      return this.createErrorResponse(
        400,
        ErrorType.INVALID_REQUEST,
        error.message,
        correlationId,
        error.details
      );
    }

    if (error instanceof AuthenticationError) {
      return this.createErrorResponse(
        401,
        ErrorType.AUTHENTICATION_ERROR,
        error.message,
        correlationId
      );
    }

    if (error instanceof RateLimitError) {
      return this.createErrorResponse(
        429,
        ErrorType.RATE_LIMIT_EXCEEDED,
        error.message,
        correlationId,
        {
          retryAfter: error.retryAfter,
        }
      );
    }

    if (error instanceof ProviderError) {
      return this.createErrorResponse(
        503,
        ErrorType.PROVIDER_UNAVAILABLE,
        error.message,
        correlationId
      );
    }

    // Log unexpected errors
    logger.error('Unexpected error occurred', error as Error);

    return this.createErrorResponse(
      500,
      ErrorType.INTERNAL_ERROR,
      'Internal server error',
      correlationId
    );
  }

  private static createErrorResponse(
    statusCode: number,
    errorType: ErrorType,
    message: string,
    correlationId: string,
    details?: Record<string, any>
  ): APIGatewayProxyResult {
    const errorResponse: ErrorResponse = {
      error: {
        type: errorType,
        message,
        code: `${errorType}_${statusCode}`,
        details,
        retryAfter: details?.retryAfter,
      },
      requestId: correlationId,
      timestamp: new Date().toISOString(),
    };

    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(errorResponse),
    };
  }
}

// Custom error classes
export class ValidationError extends Error {
  constructor(
    message: string,
    public details?: Record<string, string>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
