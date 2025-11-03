import * as AWSXRay from 'aws-xray-sdk-core';
import { TracingService } from '../../services/monitoring/tracing-service';

/**
 * Enhanced structured logger for production observability
 * Provides correlation ID tracking, X-Ray tracing, and structured JSON logging
 */
export class Logger {
  private correlationId?: string;
  private service: string;
  private traceId?: string;
  private segmentId?: string;

  constructor(service: string) {
    this.service = service;
    this.updateTraceContext();
  }

  setCorrelationId(correlationId: string): void {
    this.correlationId = correlationId;
    this.updateTraceContext();
  }

  /**
   * Set X-Ray trace context for distributed tracing
   */
  setTraceContext(traceId?: string, segmentId?: string): void {
    this.traceId = traceId;
    this.segmentId = segmentId;
  }

  /**
   * Create a new X-Ray subsegment for operation tracking
   */
  createSubsegment(name: string, metadata?: Record<string, any>): AWSXRay.Subsegment | null {
    try {
      const tracingService = TracingService.getInstance();
      return tracingService.createSubsegment(name, metadata);
    } catch (error) {
      this.debug('X-Ray subsegment creation failed', { name, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Close X-Ray subsegment with optional error and metadata
   */
  closeSubsegment(subsegment: AWSXRay.Subsegment | null, error?: Error, metadata?: Record<string, any>): void {
    try {
      const tracingService = TracingService.getInstance();
      tracingService.closeSubsegment(subsegment, error, metadata);
    } catch (closeError) {
      this.debug('Failed to close X-Ray subsegment', { error: (closeError as Error).message });
    }
  }

  /**
   * Add annotation to current X-Ray segment
   */
  addTraceAnnotation(key: string, value: string | number | boolean): void {
    try {
      const tracingService = TracingService.getInstance();
      tracingService.addAnnotation(key, value);
    } catch (error) {
      this.debug('Failed to add X-Ray annotation', { key, value, error: (error as Error).message });
    }
  }

  /**
   * Add metadata to current X-Ray segment
   */
  addTraceMetadata(namespace: string, data: Record<string, any>): void {
    try {
      const tracingService = TracingService.getInstance();
      tracingService.addMetadata(namespace, data);
    } catch (error) {
      this.debug('Failed to add X-Ray metadata', { namespace, error: (error as Error).message });
    }
  }

  info(message: string, meta: Record<string, any> = {}): void {
    this.log('INFO', message, meta);
  }

  debug(message: string, meta: Record<string, any> = {}): void {
    if (process.env.LOG_LEVEL === 'DEBUG' || process.env.NODE_ENV === 'development') {
      this.log('DEBUG', message, meta);
    }
  }

  warn(message: string, meta: Record<string, any> = {}): void {
    this.log('WARN', message, meta);
  }

  error(message: string, error?: Error | string, meta: Record<string, any> = {}): void {
    const errorMeta =
      typeof error === 'string'
        ? { error }
        : error
          ? {
              errorName: error.name,
              errorMessage: error.message,
              errorStack: error.stack,
            }
          : {};

    this.log('ERROR', message, { ...meta, ...errorMeta });

    // Add error to X-Ray trace if available
    if (error instanceof Error) {
      this.addErrorToTrace(error);
    }
  }

  /**
   * Log performance metrics with timing information
   */
  performance(operation: string, duration: number, meta: Record<string, any> = {}): void {
    this.log('PERFORMANCE', `${operation} completed`, {
      ...meta,
      operation,
      duration,
      durationMs: duration,
    });

    // Add performance annotation to X-Ray
    this.addTraceAnnotation(`${operation}_duration`, duration);
  }

  /**
   * Log business events for analytics
   */
  business(event: string, data: Record<string, any> = {}): void {
    this.log('BUSINESS', event, {
      ...data,
      eventType: 'business',
      eventName: event,
    });
  }

  /**
   * Log security events
   */
  security(event: string, severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', data: Record<string, any> = {}): void {
    this.log('SECURITY', event, {
      ...data,
      eventType: 'security',
      eventName: event,
      severity,
    });

    // Add security annotation to X-Ray
    this.addTraceAnnotation('security_event', event);
    this.addTraceAnnotation('security_severity', severity);
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: Record<string, any>): Logger {
    const childLogger = new Logger(this.service);
    childLogger.correlationId = this.correlationId;
    childLogger.traceId = this.traceId;
    childLogger.segmentId = this.segmentId;
    
    // Override log method to include additional context
    const originalLog = childLogger.log.bind(childLogger);
    childLogger.log = (level: string, message: string, meta: Record<string, any>) => {
      originalLog(level, message, { ...additionalContext, ...meta });
    };

    return childLogger;
  }

  private log(level: string, message: string, meta: Record<string, any>): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      correlationId: this.correlationId,
      traceId: this.traceId,
      segmentId: this.segmentId,
      ...meta,
    };

    // Use appropriate console method based on level
    switch (level) {
      case 'ERROR':
        console.error(JSON.stringify(logEntry));
        break;
      case 'WARN':
        console.warn(JSON.stringify(logEntry));
        break;
      case 'DEBUG':
        console.debug(JSON.stringify(logEntry));
        break;
      default:
        console.log(JSON.stringify(logEntry));
    }
  }

  /**
   * Update trace context from X-Ray segment
   */
  private updateTraceContext(): void {
    try {
      const tracingService = TracingService.getInstance();
      const context = tracingService.getTraceContext();
      this.traceId = context.traceId || undefined;
      this.segmentId = context.segmentId || undefined;
    } catch (error) {
      // X-Ray not available
    }
  }

  /**
   * Add error to X-Ray trace
   */
  private addErrorToTrace(error: Error): void {
    try {
      const segment = AWSXRay.getSegment();
      if (segment) {
        segment.addError(error);
      }
    } catch (traceError) {
      // X-Ray not available
    }
  }
}

// Default logger instance
export const logger = new Logger('ai-model-gateway');
