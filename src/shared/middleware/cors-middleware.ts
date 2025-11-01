import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '../utils';

const logger = new Logger('CorsMiddleware');

/**
 * CORS middleware for handling cross-origin requests
 */
export class CorsMiddleware {
  private static readonly ALLOWED_ORIGINS = [
    'https://app.example.com',
    'https://admin.example.com',
    'http://localhost:3000', // Development
    'http://localhost:3001', // Development
  ];

  private static readonly ALLOWED_METHODS = [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'OPTIONS',
    'HEAD',
  ];

  private static readonly ALLOWED_HEADERS = [
    'Content-Type',
    'Authorization',
    'X-API-Key',
    'X-Correlation-ID',
    'X-Requested-With',
    'Accept',
    'Origin',
    'User-Agent',
  ];

  private static readonly EXPOSED_HEADERS = [
    'X-Correlation-ID',
    'X-RateLimit-Remaining-Requests',
    'X-RateLimit-Reset',
    'X-Request-ID',
  ];

  private static readonly MAX_AGE = 86400; // 24 hours

  /**
   * Handle CORS preflight request
   */
  static handlePreflightRequest(
    event: APIGatewayProxyEvent,
    correlationId: string
  ): APIGatewayProxyResult {
    const origin = event.headers.Origin || event.headers.origin;
    const requestMethod = event.headers['Access-Control-Request-Method'];
    const requestHeaders = event.headers['Access-Control-Request-Headers'];

    logger.debug('Handling CORS preflight request', {
      correlationId,
      origin,
      requestMethod,
      requestHeaders,
    });

    // Validate origin
    const corsHeaders = this.getCorsHeaders(origin, correlationId);

    // Validate requested method
    if (requestMethod && !this.ALLOWED_METHODS.includes(requestMethod.toUpperCase())) {
      logger.warn('CORS preflight rejected: Method not allowed', {
        correlationId,
        requestMethod,
        allowedMethods: this.ALLOWED_METHODS,
      });

      return {
        statusCode: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: 'Method not allowed',
          allowedMethods: this.ALLOWED_METHODS,
        }),
      };
    }

    // Validate requested headers
    if (requestHeaders) {
      const requestedHeaders = requestHeaders.split(',').map(h => h.trim());
      const invalidHeaders = requestedHeaders.filter(
        header => !this.ALLOWED_HEADERS.some(allowed => 
          allowed.toLowerCase() === header.toLowerCase()
        )
      );

      if (invalidHeaders.length > 0) {
        logger.warn('CORS preflight rejected: Headers not allowed', {
          correlationId,
          invalidHeaders,
          allowedHeaders: this.ALLOWED_HEADERS,
        });

        return {
          statusCode: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            error: 'Headers not allowed',
            invalidHeaders,
            allowedHeaders: this.ALLOWED_HEADERS,
          }),
        };
      }
    }

    // Return successful preflight response
    return {
      statusCode: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': this.ALLOWED_METHODS.join(', '),
        'Access-Control-Allow-Headers': this.ALLOWED_HEADERS.join(', '),
        'Access-Control-Max-Age': this.MAX_AGE.toString(),
      },
      body: '',
    };
  }

  /**
   * Add CORS headers to response
   */
  static addCorsHeaders(
    response: APIGatewayProxyResult,
    event: APIGatewayProxyEvent,
    correlationId: string
  ): APIGatewayProxyResult {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = this.getCorsHeaders(origin, correlationId);

    return {
      ...response,
      headers: {
        ...response.headers,
        ...corsHeaders,
        'Access-Control-Expose-Headers': this.EXPOSED_HEADERS.join(', '),
      },
    };
  }

  /**
   * Get CORS headers based on origin validation
   */
  private static getCorsHeaders(
    origin: string | undefined,
    correlationId: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
    };

    if (!origin) {
      // No origin header - likely a same-origin request or server-to-server
      logger.debug('No origin header in request', { correlationId });
      return headers;
    }

    // Check if origin is allowed
    const isAllowed = this.isOriginAllowed(origin);

    if (isAllowed) {
      headers['Access-Control-Allow-Origin'] = origin;
      logger.debug('CORS origin allowed', { correlationId, origin });
    } else {
      // For security, we don't set Access-Control-Allow-Origin for disallowed origins
      logger.warn('CORS origin rejected', {
        correlationId,
        origin,
        allowedOrigins: this.ALLOWED_ORIGINS,
      });
    }

    return headers;
  }

  /**
   * Check if origin is allowed
   */
  private static isOriginAllowed(origin: string): boolean {
    // Exact match
    if (this.ALLOWED_ORIGINS.includes(origin)) {
      return true;
    }

    // Pattern matching for development environments
    if (process.env.NODE_ENV === 'development' || process.env.ENVIRONMENT === 'dev') {
      // Allow localhost with any port
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return true;
      }

      // Allow local IP addresses for development
      if (/^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) {
        return true;
      }

      if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate CORS configuration
   */
  static validateCorsConfiguration(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate allowed origins
    if (this.ALLOWED_ORIGINS.length === 0) {
      errors.push('At least one allowed origin must be configured');
    }

    for (const origin of this.ALLOWED_ORIGINS) {
      try {
        new URL(origin);
      } catch {
        errors.push(`Invalid origin URL: ${origin}`);
      }
    }

    // Validate allowed methods
    if (this.ALLOWED_METHODS.length === 0) {
      errors.push('At least one allowed method must be configured');
    }

    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'];
    for (const method of this.ALLOWED_METHODS) {
      if (!validMethods.includes(method.toUpperCase())) {
        errors.push(`Invalid HTTP method: ${method}`);
      }
    }

    // Validate max age
    if (this.MAX_AGE < 0 || this.MAX_AGE > 86400) {
      errors.push('Max age must be between 0 and 86400 seconds');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get CORS configuration for debugging
   */
  static getCorsConfiguration() {
    return {
      allowedOrigins: this.ALLOWED_ORIGINS,
      allowedMethods: this.ALLOWED_METHODS,
      allowedHeaders: this.ALLOWED_HEADERS,
      exposedHeaders: this.EXPOSED_HEADERS,
      maxAge: this.MAX_AGE,
    };
  }
}