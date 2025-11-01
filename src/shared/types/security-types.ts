/**
 * Security event types for monitoring
 */
export enum SecurityEventType {
  DANGEROUS_PATTERN_DETECTED = 'DANGEROUS_PATTERN_DETECTED',
  SQL_INJECTION_ATTEMPT = 'SQL_INJECTION_ATTEMPT',
  OVERSIZED_REQUEST = 'OVERSIZED_REQUEST',
  INVALID_HEADER = 'INVALID_HEADER',
  AUTHENTICATION_FAILURE = 'AUTHENTICATION_FAILURE',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
}

/**
 * Security event for audit logging
 */
export interface SecurityEvent {
  type: SecurityEventType;
  correlationId: string;
  timestamp: string;
  sourceIp?: string;
  userAgent?: string;
  details: Record<string, any>;
}