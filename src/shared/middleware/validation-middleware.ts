import { APIGatewayProxyEvent } from 'aws-lambda';
import { ValidationHelper, ValidationError } from '../validation';
import { Logger } from '../utils';

const logger = new Logger('ValidationMiddleware');

/**
 * Validation middleware for request validation and sanitization
 */
export class ValidationMiddleware {
  /**
   * Validate API Gateway event structure and required fields
   */
  static validateApiGatewayEvent(
    event: APIGatewayProxyEvent,
    correlationId: string
  ): { success: boolean; error?: string } {
    try {
      // Validate required event properties
      if (!event.httpMethod) {
        return { success: false, error: 'HTTP method is required' };
      }

      if (!event.path) {
        return { success: false, error: 'Request path is required' };
      }

      if (!event.requestContext) {
        return { success: false, error: 'Request context is required' };
      }

      // Validate HTTP method
      const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'];
      if (!allowedMethods.includes(event.httpMethod.toUpperCase())) {
        logger.warn('Invalid HTTP method', {
          correlationId,
          method: event.httpMethod,
          allowedMethods,
        });
        return { success: false, error: 'Invalid HTTP method' };
      }

      // Validate path format
      if (!event.path.startsWith('/')) {
        return { success: false, error: 'Invalid path format' };
      }

      // Validate path length
      if (event.path.length > 2048) {
        return { success: false, error: 'Request path too long' };
      }

      logger.debug('API Gateway event validation successful', {
        correlationId,
        method: event.httpMethod,
        path: event.path,
      });

      return { success: true };
    } catch (error) {
      logger.error('API Gateway event validation failed', error as Error, { correlationId });
      return { success: false, error: 'Event validation failed' };
    }
  }

  /**
   * Validate request body based on content type and endpoint
   */
  static validateRequestBody(
    event: APIGatewayProxyEvent,
    correlationId: string
  ): { success: boolean; error?: string; parsedBody?: any } {
    try {
      // Skip validation for methods that don't typically have bodies
      if (['GET', 'DELETE', 'HEAD', 'OPTIONS'].includes(event.httpMethod.toUpperCase())) {
        return { success: true };
      }

      // Check if body is required for this endpoint
      const requiresBody = this.endpointRequiresBody(event.path, event.httpMethod);

      if (requiresBody && !event.body) {
        return { success: false, error: 'Request body is required' };
      }

      if (!event.body) {
        return { success: true };
      }

      // Validate content type
      const contentType = event.headers['Content-Type'] || event.headers['content-type'] || '';

      if (!contentType.includes('application/json')) {
        logger.warn('Unsupported content type', {
          correlationId,
          contentType,
          path: event.path,
        });
        return { success: false, error: 'Content-Type must be application/json' };
      }

      // Parse and validate JSON
      let parsedBody;
      try {
        parsedBody = JSON.parse(event.body);
      } catch (parseError) {
        logger.warn('Invalid JSON in request body', {
          correlationId,
          error: (parseError as Error).message,
        });
        return { success: false, error: 'Invalid JSON format' };
      }

      // Validate body size (already parsed, so check object complexity)
      const bodyComplexity = this.calculateObjectComplexity(parsedBody);
      if (bodyComplexity > 1000) {
        logger.warn('Request body too complex', {
          correlationId,
          complexity: bodyComplexity,
        });
        return { success: false, error: 'Request body too complex' };
      }

      // Endpoint-specific validation
      const endpointValidation = this.validateEndpointSpecificBody(
        event.path,
        event.httpMethod,
        parsedBody,
        correlationId
      );

      if (!endpointValidation.success) {
        return endpointValidation;
      }

      logger.debug('Request body validation successful', {
        correlationId,
        bodySize: event.body.length,
        complexity: bodyComplexity,
      });

      return { success: true, parsedBody };
    } catch (error) {
      logger.error('Request body validation failed', error as Error, { correlationId });
      return { success: false, error: 'Body validation failed' };
    }
  }

  /**
   * Validate query parameters
   */
  static validateQueryParameters(
    event: APIGatewayProxyEvent,
    correlationId: string
  ): { success: boolean; error?: string } {
    try {
      const queryParams = event.queryStringParameters || {};

      // Check total number of parameters
      const paramCount = Object.keys(queryParams).length;
      if (paramCount > 50) {
        logger.warn('Too many query parameters', {
          correlationId,
          paramCount,
          maxAllowed: 50,
        });
        return { success: false, error: 'Too many query parameters' };
      }

      // Validate each parameter
      for (const [key, value] of Object.entries(queryParams)) {
        if (!value) continue;

        // Check parameter name length
        if (key.length > 100) {
          return { success: false, error: 'Query parameter name too long' };
        }

        // Check parameter value length
        if (value.length > 1000) {
          return { success: false, error: 'Query parameter value too long' };
        }

        // Check for dangerous characters in parameter names
        if (!/^[a-zA-Z0-9_\-.]+$/.test(key)) {
          logger.warn('Invalid query parameter name', {
            correlationId,
            parameterName: key,
          });
          return { success: false, error: 'Invalid query parameter name' };
        }
      }

      logger.debug('Query parameters validation successful', {
        correlationId,
        paramCount,
      });

      return { success: true };
    } catch (error) {
      logger.error('Query parameters validation failed', error as Error, { correlationId });
      return { success: false, error: 'Query parameters validation failed' };
    }
  }

  /**
   * Check if endpoint requires a request body
   */
  private static endpointRequiresBody(path: string, method: string): boolean {
    const postEndpoints = ['/api/v1/completions', '/api/v1/mcp/search', '/api/v1/auth/token'];

    return (
      method.toUpperCase() === 'POST' && postEndpoints.some(endpoint => path.startsWith(endpoint))
    );
  }

  /**
   * Calculate object complexity (nested depth and property count)
   */
  private static calculateObjectComplexity(obj: any, depth = 0): number {
    if (depth > 10) return 1000; // Prevent infinite recursion

    if (typeof obj !== 'object' || obj === null) {
      return 1;
    }

    if (Array.isArray(obj)) {
      return obj.reduce((sum, item) => sum + this.calculateObjectComplexity(item, depth + 1), 0);
    }

    return Object.values(obj).reduce(
      (sum: number, value) => sum + this.calculateObjectComplexity(value, depth + 1),
      Object.keys(obj).length as number
    ) as number;
  }

  /**
   * Validate request body for specific endpoints
   */
  private static validateEndpointSpecificBody(
    path: string,
    method: string,
    body: any,
    correlationId: string
  ): { success: boolean; error?: string } {
    try {
      if (path === '/api/v1/completions' && method.toUpperCase() === 'POST') {
        // Validate LLM request
        try {
          ValidationHelper.validateLLMRequest(body);
        } catch (error) {
          if (error instanceof ValidationError) {
            logger.warn('LLM request validation failed', {
              correlationId,
              errors: error.errors,
            });
            return {
              success: false,
              error: `Validation failed: ${error.errors.map(e => e.message).join(', ')}`,
            };
          }
          throw error;
        }
      }

      if (path.startsWith('/api/v1/mcp/search') && method.toUpperCase() === 'POST') {
        // Validate product search request
        try {
          ValidationHelper.validateProductSearchRequest(body);
        } catch (error) {
          if (error instanceof ValidationError) {
            logger.warn('Product search request validation failed', {
              correlationId,
              errors: error.errors,
            });
            return {
              success: false,
              error: `Validation failed: ${error.errors.map(e => e.message).join(', ')}`,
            };
          }
          throw error;
        }
      }

      return { success: true };
    } catch (error) {
      logger.error('Endpoint-specific validation failed', error as Error, { correlationId });
      return { success: false, error: 'Endpoint validation failed' };
    }
  }
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  success: boolean;
  error?: string;
  sanitizedEvent?: APIGatewayProxyEvent;
  parsedBody?: any;
}
