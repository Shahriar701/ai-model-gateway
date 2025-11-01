import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '../utils';

const logger = new Logger('SecurityMiddleware');

/**
 * Security middleware for input sanitization and security headers
 */
export class SecurityMiddleware {
  private static readonly DANGEROUS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /data:text\/html/gi,
    /vbscript:/gi,
    /<iframe\b[^>]*>/gi,
    /<object\b[^>]*>/gi,
    /<embed\b[^>]*>/gi,
    /<link\b[^>]*>/gi,
    /<meta\b[^>]*>/gi,
  ];

  private static readonly SQL_INJECTION_PATTERNS = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b).*(\b(FROM|WHERE|INTO|VALUES|SET|TABLE)\b)/gi,
    /(';|';\s*--|';\s*\/\*|';\s*DROP|';\s*DELETE|';\s*INSERT|';\s*UPDATE)/gi,
    /(UNION\s+SELECT|UNION\s+ALL\s+SELECT)/gi,
    /(\bOR\b\s+\d+\s*=\s*\d+|\bAND\b\s+\d+\s*=\s*\d+)/gi,
  ];

  private static readonly MAX_CONTENT_LENGTH = 10 * 1024 * 1024; // 10MB
  private static readonly MAX_HEADER_LENGTH = 8192; // 8KB

  /**
   * Apply security middleware to the request
   */
  static async applySecurityMiddleware(
    event: APIGatewayProxyEvent,
    correlationId: string
  ): Promise<{ success: boolean; error?: string; sanitizedEvent?: APIGatewayProxyEvent }> {
    try {
      // Check content length
      const contentLength = parseInt(event.headers['Content-Length'] || '0', 10);
      if (contentLength > this.MAX_CONTENT_LENGTH) {
        logger.warn('Request rejected: Content length too large', {
          correlationId,
          contentLength,
          maxAllowed: this.MAX_CONTENT_LENGTH,
        });

        // TODO: Add security logging here

        return { success: false, error: 'Request payload too large' };
      }

      // Validate headers
      const headerValidation = this.validateHeaders(event.headers, correlationId);
      if (!headerValidation.success) {
        return headerValidation;
      }

      // Sanitize request body
      let sanitizedBody = event.body;
      if (event.body) {
        const sanitizationResult = this.sanitizeInput(event.body, correlationId);
        if (!sanitizationResult.success) {
          return sanitizationResult;
        }
        sanitizedBody = sanitizationResult.sanitizedInput || null;
      }

      // Sanitize query parameters
      const sanitizedQueryParams = this.sanitizeQueryParameters(
        event.queryStringParameters || {},
        correlationId
      );

      // Create sanitized event
      const sanitizedEvent: APIGatewayProxyEvent = {
        ...event,
        body: sanitizedBody,
        queryStringParameters: sanitizedQueryParams,
      };

      logger.debug('Security middleware applied successfully', { correlationId });

      return { success: true, sanitizedEvent };
    } catch (error) {
      logger.error('Security middleware failed', error as Error, { correlationId });
      return { success: false, error: 'Security validation failed' };
    }
  }

  /**
   * Add security headers to response
   */
  static addSecurityHeaders(
    response: APIGatewayProxyResult,
    correlationId: string
  ): APIGatewayProxyResult {
    const securityHeaders = {
      // Prevent XSS attacks
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',

      // Content Security Policy
      'Content-Security-Policy': "default-src 'none'; script-src 'none'; object-src 'none';",

      // HSTS (HTTP Strict Transport Security)
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',

      // Referrer Policy
      'Referrer-Policy': 'strict-origin-when-cross-origin',

      // Permissions Policy
      'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',

      // Cache Control for sensitive responses
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      Expires: '0',

      // Correlation ID for tracing
      'X-Correlation-ID': correlationId,
    };

    return {
      ...response,
      headers: {
        ...response.headers,
        ...securityHeaders,
      },
    };
  }

  /**
   * Validate request headers for security issues
   */
  private static validateHeaders(
    headers: { [name: string]: string | undefined },
    correlationId: string
  ): { success: boolean; error?: string } {
    for (const [name, value] of Object.entries(headers)) {
      if (!value) continue;

      // Check header length
      if (value.length > this.MAX_HEADER_LENGTH) {
        logger.warn('Request rejected: Header too large', {
          correlationId,
          headerName: name,
          headerLength: value.length,
          maxAllowed: this.MAX_HEADER_LENGTH,
        });

        // TODO: Add security logging here

        return { success: false, error: 'Request header too large' };
      }

      // Check for dangerous patterns in headers
      if (this.containsDangerousPatterns(value)) {
        logger.warn('Request rejected: Dangerous pattern in header', {
          correlationId,
          headerName: name,
        });

        // TODO: Add security logging here

        return { success: false, error: 'Invalid header content' };
      }
    }

    return { success: true };
  }

  /**
   * Sanitize input string by removing dangerous patterns
   */
  private static sanitizeInput(
    input: string,
    correlationId: string
  ): { success: boolean; error?: string; sanitizedInput?: string } {
    try {
      // Check for dangerous patterns
      if (this.containsDangerousPatterns(input)) {
        logger.warn('Request rejected: Dangerous pattern detected', { correlationId });
        // TODO: Add security logging here
        return { success: false, error: 'Invalid input content detected' };
      }

      // Check for SQL injection patterns
      if (this.containsSQLInjectionPatterns(input)) {
        logger.warn('Request rejected: SQL injection pattern detected', { correlationId });
        // TODO: Add security logging here
        return { success: false, error: 'Invalid input content detected' };
      }

      // Basic sanitization - remove null bytes and control characters
      let sanitized = input.replace(/\0/g, ''); // Remove null bytes
      sanitized = sanitized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''); // Remove control chars

      return { success: true, sanitizedInput: sanitized };
    } catch (error) {
      logger.error('Input sanitization failed', error as Error, { correlationId });
      return { success: false, error: 'Input sanitization failed' };
    }
  }

  /**
   * Sanitize query parameters
   */
  private static sanitizeQueryParameters(
    queryParams: { [name: string]: string | undefined },
    correlationId: string
  ): { [name: string]: string | undefined } {
    const sanitized: { [name: string]: string | undefined } = {};

    for (const [key, value] of Object.entries(queryParams)) {
      if (!value) {
        sanitized[key] = value;
        continue;
      }

      // Sanitize parameter value
      const sanitizationResult = this.sanitizeInput(value, correlationId);
      if (sanitizationResult.success) {
        sanitized[key] = sanitizationResult.sanitizedInput;
      } else {
        // Skip dangerous parameters
        logger.warn('Query parameter skipped due to dangerous content', {
          correlationId,
          parameterName: key,
        });
      }
    }

    return sanitized;
  }

  /**
   * Check if input contains dangerous patterns
   */
  private static containsDangerousPatterns(input: string): boolean {
    return this.DANGEROUS_PATTERNS.some(pattern => pattern.test(input));
  }

  /**
   * Check if input contains SQL injection patterns
   */
  private static containsSQLInjectionPatterns(input: string): boolean {
    return this.SQL_INJECTION_PATTERNS.some(pattern => pattern.test(input));
  }

  /**
   * Rate limit security events (to prevent log flooding)
   */
  private static securityEventCounts = new Map<string, { count: number; lastReset: number }>();
  private static readonly SECURITY_EVENT_LIMIT = 10;
  private static readonly SECURITY_EVENT_WINDOW = 60000; // 1 minute

  static shouldLogSecurityEvent(eventType: string, correlationId: string): boolean {
    const now = Date.now();
    const key = `${eventType}:${correlationId}`;
    const current = this.securityEventCounts.get(key) || { count: 0, lastReset: now };

    // Reset counter if window has passed
    if (now - current.lastReset > this.SECURITY_EVENT_WINDOW) {
      current.count = 0;
      current.lastReset = now;
    }

    current.count++;
    this.securityEventCounts.set(key, current);

    return current.count <= this.SECURITY_EVENT_LIMIT;
  }
}

// Security types moved to separate file to avoid circular dependencies
