import { Logger } from './logger';
import { SecurityEvent, SecurityEventType } from '../types/security-types';

/**
 * Security-focused logger for audit trails and security events
 */
export class SecurityLogger {
  private static instance: SecurityLogger;
  private logger: Logger;
  private eventCounts: Map<string, { count: number; lastReset: number }> = new Map();

  // Rate limiting for security events to prevent log flooding
  private static readonly MAX_EVENTS_PER_MINUTE = 100;
  private static readonly RATE_LIMIT_WINDOW = 60000; // 1 minute

  private constructor() {
    this.logger = new Logger('SecurityLogger');
  }

  static getInstance(): SecurityLogger {
    if (!SecurityLogger.instance) {
      SecurityLogger.instance = new SecurityLogger();
    }
    return SecurityLogger.instance;
  }

  /**
   * Log authentication attempt
   */
  logAuthenticationAttempt(
    correlationId: string,
    userId: string | null,
    apiKey: string | null,
    success: boolean,
    sourceIp?: string,
    userAgent?: string,
    reason?: string
  ): void {
    const eventType = success
      ? SecurityEventType.AUTHENTICATION_FAILURE
      : SecurityEventType.AUTHENTICATION_FAILURE;

    if (!this.shouldLogEvent(eventType, correlationId)) {
      return;
    }

    const securityEvent: SecurityEvent = {
      type: eventType,
      correlationId,
      timestamp: new Date().toISOString(),
      sourceIp,
      userAgent,
      details: {
        userId: userId ? this.maskSensitiveData(userId) : null,
        apiKeyPrefix: apiKey ? this.getApiKeyPrefix(apiKey) : null,
        success,
        reason,
        severity: success ? 'INFO' : 'WARNING',
      },
    };

    if (success) {
      this.logger.info('Authentication successful', securityEvent.details);
    } else {
      this.logger.warn('Authentication failed', securityEvent.details);
    }

    // In production, this would also send to a security monitoring system
    this.sendToSecurityMonitoring(securityEvent);
  }

  /**
   * Log rate limit exceeded event
   */
  logRateLimitExceeded(
    correlationId: string,
    userId: string,
    tier: string,
    requestsRemaining: number,
    sourceIp?: string,
    userAgent?: string
  ): void {
    if (!this.shouldLogEvent(SecurityEventType.RATE_LIMIT_EXCEEDED, correlationId)) {
      return;
    }

    const securityEvent: SecurityEvent = {
      type: SecurityEventType.RATE_LIMIT_EXCEEDED,
      correlationId,
      timestamp: new Date().toISOString(),
      sourceIp,
      userAgent,
      details: {
        userId: this.maskSensitiveData(userId),
        tier,
        requestsRemaining,
        severity: 'WARNING',
      },
    };

    this.logger.warn('Rate limit exceeded', securityEvent.details);
    this.sendToSecurityMonitoring(securityEvent);
  }

  /**
   * Log dangerous pattern detection
   */
  logDangerousPatternDetected(
    correlationId: string,
    patternType: 'XSS' | 'SQL_INJECTION' | 'SCRIPT_INJECTION' | 'OTHER',
    content: string,
    sourceIp?: string,
    userAgent?: string
  ): void {
    const eventType =
      patternType === 'SQL_INJECTION'
        ? SecurityEventType.SQL_INJECTION_ATTEMPT
        : SecurityEventType.DANGEROUS_PATTERN_DETECTED;

    if (!this.shouldLogEvent(eventType, correlationId)) {
      return;
    }

    const securityEvent: SecurityEvent = {
      type: eventType,
      correlationId,
      timestamp: new Date().toISOString(),
      sourceIp,
      userAgent,
      details: {
        patternType,
        contentSample: this.sanitizeContentForLogging(content),
        severity: 'HIGH',
      },
    };

    this.logger.error('Dangerous pattern detected', undefined, securityEvent.details);
    this.sendToSecurityMonitoring(securityEvent);
  }

  /**
   * Log oversized request attempt
   */
  logOversizedRequest(
    correlationId: string,
    requestSize: number,
    maxAllowed: number,
    requestType: 'BODY' | 'HEADER' | 'QUERY_PARAMS',
    sourceIp?: string,
    userAgent?: string
  ): void {
    if (!this.shouldLogEvent(SecurityEventType.OVERSIZED_REQUEST, correlationId)) {
      return;
    }

    const securityEvent: SecurityEvent = {
      type: SecurityEventType.OVERSIZED_REQUEST,
      correlationId,
      timestamp: new Date().toISOString(),
      sourceIp,
      userAgent,
      details: {
        requestType,
        requestSize,
        maxAllowed,
        severity: 'MEDIUM',
      },
    };

    this.logger.warn('Oversized request detected', securityEvent.details);
    this.sendToSecurityMonitoring(securityEvent);
  }

  /**
   * Log invalid header content
   */
  logInvalidHeader(
    correlationId: string,
    headerName: string,
    reason: string,
    sourceIp?: string,
    userAgent?: string
  ): void {
    if (!this.shouldLogEvent(SecurityEventType.INVALID_HEADER, correlationId)) {
      return;
    }

    const securityEvent: SecurityEvent = {
      type: SecurityEventType.INVALID_HEADER,
      correlationId,
      timestamp: new Date().toISOString(),
      sourceIp,
      userAgent,
      details: {
        headerName,
        reason,
        severity: 'MEDIUM',
      },
    };

    this.logger.warn('Invalid header detected', securityEvent.details);
    this.sendToSecurityMonitoring(securityEvent);
  }

  /**
   * Log security configuration changes
   */
  logSecurityConfigChange(
    correlationId: string,
    userId: string,
    configType: string,
    oldValue: any,
    newValue: any,
    sourceIp?: string
  ): void {
    const securityEvent: SecurityEvent = {
      type: SecurityEventType.DANGEROUS_PATTERN_DETECTED, // Reusing for config changes
      correlationId,
      timestamp: new Date().toISOString(),
      sourceIp,
      details: {
        userId: this.maskSensitiveData(userId),
        configType,
        oldValue: this.sanitizeConfigForLogging(oldValue),
        newValue: this.sanitizeConfigForLogging(newValue),
        severity: 'INFO',
        action: 'CONFIG_CHANGE',
      },
    };

    this.logger.info('Security configuration changed', securityEvent.details);
    this.sendToSecurityMonitoring(securityEvent);
  }

  /**
   * Log API key operations (creation, revocation, etc.)
   */
  logApiKeyOperation(
    correlationId: string,
    operation: 'CREATE' | 'REVOKE' | 'UPDATE' | 'DELETE',
    keyId: string,
    userId: string,
    success: boolean,
    sourceIp?: string,
    reason?: string
  ): void {
    const securityEvent: SecurityEvent = {
      type: SecurityEventType.AUTHENTICATION_FAILURE, // Reusing for key operations
      correlationId,
      timestamp: new Date().toISOString(),
      sourceIp,
      details: {
        operation,
        keyId: this.maskSensitiveData(keyId),
        userId: this.maskSensitiveData(userId),
        success,
        reason,
        severity: success ? 'INFO' : 'WARNING',
      },
    };

    if (success) {
      this.logger.info(`API key ${operation.toLowerCase()} successful`, securityEvent.details);
    } else {
      this.logger.warn(`API key ${operation.toLowerCase()} failed`, securityEvent.details);
    }

    this.sendToSecurityMonitoring(securityEvent);
  }

  /**
   * Generate security metrics summary
   */
  generateSecurityMetrics(timeWindow: number = 3600000): SecurityMetrics {
    const now = Date.now();
    const windowStart = now - timeWindow;

    // In a real implementation, this would query a metrics store
    // For now, we'll return a basic structure
    return {
      timeWindow: {
        start: new Date(windowStart).toISOString(),
        end: new Date(now).toISOString(),
        durationMs: timeWindow,
      },
      events: {
        authenticationFailures: 0,
        rateLimitExceeded: 0,
        dangerousPatterns: 0,
        oversizedRequests: 0,
        invalidHeaders: 0,
      },
      topSourceIps: [],
      topUserAgents: [],
      alertsTriggered: 0,
    };
  }

  /**
   * Check if we should log this event (rate limiting)
   */
  private shouldLogEvent(eventType: SecurityEventType, correlationId: string): boolean {
    const now = Date.now();
    const key = `${eventType}:${correlationId}`;
    const current = this.eventCounts.get(key) || { count: 0, lastReset: now };

    // Reset counter if window has passed
    if (now - current.lastReset > SecurityLogger.RATE_LIMIT_WINDOW) {
      current.count = 0;
      current.lastReset = now;
    }

    current.count++;
    this.eventCounts.set(key, current);

    return current.count <= SecurityLogger.MAX_EVENTS_PER_MINUTE;
  }

  /**
   * Mask sensitive data for logging
   */
  private maskSensitiveData(data: string): string {
    if (!data || data.length <= 8) {
      return '***';
    }
    return data.substring(0, 4) + '***' + data.substring(data.length - 4);
  }

  /**
   * Get API key prefix for logging
   */
  private getApiKeyPrefix(apiKey: string): string {
    return apiKey.length > 8 ? apiKey.substring(0, 8) + '***' : '***';
  }

  /**
   * Sanitize content for safe logging
   */
  private sanitizeContentForLogging(content: string): string {
    // Truncate and remove potentially dangerous characters
    const truncated = content.substring(0, 200);
    return truncated.replace(/[<>'"&]/g, '*');
  }

  /**
   * Sanitize configuration values for logging
   */
  private sanitizeConfigForLogging(config: any): any {
    if (typeof config === 'string') {
      // Mask potential secrets
      if (config.length > 20) {
        return this.maskSensitiveData(config);
      }
      return config;
    }

    if (typeof config === 'object' && config !== null) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(config)) {
        if (
          key.toLowerCase().includes('secret') ||
          key.toLowerCase().includes('password') ||
          key.toLowerCase().includes('key')
        ) {
          sanitized[key] = '***';
        } else {
          sanitized[key] = this.sanitizeConfigForLogging(value);
        }
      }
      return sanitized;
    }

    return config;
  }

  /**
   * Send security event to monitoring system
   * In production, this would integrate with SIEM, CloudWatch, etc.
   */
  private sendToSecurityMonitoring(event: SecurityEvent): void {
    // In production, implement integration with:
    // - AWS CloudWatch Events
    // - AWS Security Hub
    // - Third-party SIEM systems
    // - Slack/PagerDuty for critical alerts

    // For now, we'll just log at debug level
    this.logger.debug('Security event sent to monitoring', {
      eventType: event.type,
      correlationId: event.correlationId,
      severity: event.details.severity,
    });

    // Trigger alerts for high-severity events
    if (event.details.severity === 'HIGH') {
      this.triggerSecurityAlert(event);
    }
  }

  /**
   * Trigger security alert for high-severity events
   */
  private triggerSecurityAlert(event: SecurityEvent): void {
    // In production, this would:
    // - Send to PagerDuty/OpsGenie
    // - Create AWS CloudWatch alarm
    // - Send Slack notification
    // - Update security dashboard

    this.logger.error('SECURITY ALERT TRIGGERED', undefined, {
      eventType: event.type,
      correlationId: event.correlationId,
      timestamp: event.timestamp,
      details: event.details,
    });
  }
}

/**
 * Security metrics interface
 */
export interface SecurityMetrics {
  timeWindow: {
    start: string;
    end: string;
    durationMs: number;
  };
  events: {
    authenticationFailures: number;
    rateLimitExceeded: number;
    dangerousPatterns: number;
    oversizedRequests: number;
    invalidHeaders: number;
  };
  topSourceIps: Array<{ ip: string; count: number }>;
  topUserAgents: Array<{ userAgent: string; count: number }>;
  alertsTriggered: number;
}

/**
 * Security audit trail entry
 */
export interface SecurityAuditEntry {
  id: string;
  timestamp: string;
  correlationId: string;
  eventType: SecurityEventType;
  userId?: string;
  sourceIp?: string;
  userAgent?: string;
  action: string;
  resource?: string;
  success: boolean;
  details: Record<string, any>;
}
