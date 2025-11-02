import { Logger } from '../../shared/utils';
import { TracingService } from './tracing-service';

/**
 * Correlation ID service for tracking requests across distributed services
 * Ensures consistent correlation ID propagation and context management
 */
export class CorrelationService {
  private static instance: CorrelationService;
  private logger: Logger;
  private tracingService: TracingService;
  private currentContext: Map<string, CorrelationContext> = new Map();

  private constructor() {
    this.logger = new Logger('CorrelationService');
    this.tracingService = TracingService.getInstance();
  }

  static getInstance(): CorrelationService {
    if (!CorrelationService.instance) {
      CorrelationService.instance = new CorrelationService();
    }
    return CorrelationService.instance;
  }

  /**
   * Generate a new correlation ID
   */
  generateCorrelationId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
  }

  /**
   * Create a new correlation context
   */
  createContext(
    correlationId: string,
    userId?: string,
    sessionId?: string,
    requestId?: string
  ): CorrelationContext {
    const context: CorrelationContext = {
      correlationId,
      userId,
      sessionId,
      requestId,
      timestamp: new Date().toISOString(),
      traceId: this.tracingService.getCurrentTraceId(),
      segmentId: this.tracingService.getCurrentSegmentId(),
      breadcrumbs: [],
    };

    this.currentContext.set(correlationId, context);
    
    // Add trace annotations
    this.tracingService.addAnnotation('correlationId', correlationId);
    if (userId) {
      this.tracingService.addAnnotation('userId', userId);
    }
    if (sessionId) {
      this.tracingService.addAnnotation('sessionId', sessionId);
    }

    this.logger.debug('Correlation context created', {
      correlationId,
      userId,
      sessionId,
      requestId,
    });

    return context;
  }

  /**
   * Get correlation context by ID
   */
  getContext(correlationId: string): CorrelationContext | null {
    return this.currentContext.get(correlationId) || null;
  }

  /**
   * Update correlation context
   */
  updateContext(correlationId: string, updates: Partial<CorrelationContext>): void {
    const context = this.currentContext.get(correlationId);
    if (context) {
      Object.assign(context, updates);
      this.currentContext.set(correlationId, context);
    }
  }

  /**
   * Add breadcrumb to correlation context
   */
  addBreadcrumb(
    correlationId: string,
    service: string,
    operation: string,
    metadata?: Record<string, any>
  ): void {
    const context = this.currentContext.get(correlationId);
    if (context) {
      const breadcrumb: CorrelationBreadcrumb = {
        service,
        operation,
        timestamp: new Date().toISOString(),
        metadata,
      };

      context.breadcrumbs.push(breadcrumb);
      
      // Keep only last 20 breadcrumbs to prevent memory issues
      if (context.breadcrumbs.length > 20) {
        context.breadcrumbs = context.breadcrumbs.slice(-20);
      }

      this.currentContext.set(correlationId, context);

      // Add to X-Ray metadata
      this.tracingService.addMetadata('breadcrumbs', {
        latest: breadcrumb,
        count: context.breadcrumbs.length,
      });
    }
  }

  /**
   * Create child correlation ID for sub-operations
   */
  createChildCorrelation(
    parentCorrelationId: string,
    operation: string
  ): string {
    const childId = `${parentCorrelationId}.${operation}.${Date.now().toString(36)}`;
    
    const parentContext = this.currentContext.get(parentCorrelationId);
    if (parentContext) {
      const childContext: CorrelationContext = {
        ...parentContext,
        correlationId: childId,
        parentCorrelationId,
        breadcrumbs: [...parentContext.breadcrumbs],
      };

      this.currentContext.set(childId, childContext);
      
      this.addBreadcrumb(childId, 'correlation-service', 'child_created', {
        parentId: parentCorrelationId,
        operation,
      });
    }

    return childId;
  }

  /**
   * Get correlation headers for HTTP requests
   */
  getCorrelationHeaders(correlationId: string): Record<string, string> {
    const context = this.currentContext.get(correlationId);
    const headers: Record<string, string> = {
      'X-Correlation-ID': correlationId,
    };

    if (context) {
      if (context.traceId) {
        headers['X-Trace-ID'] = context.traceId;
      }
      if (context.userId) {
        headers['X-User-ID'] = context.userId;
      }
      if (context.sessionId) {
        headers['X-Session-ID'] = context.sessionId;
      }
    }

    return headers;
  }

  /**
   * Extract correlation ID from headers
   */
  extractCorrelationFromHeaders(headers: Record<string, string | undefined>): string {
    return headers['X-Correlation-ID'] || 
           headers['x-correlation-id'] || 
           this.generateCorrelationId();
  }

  /**
   * Create logger with correlation context
   */
  createContextualLogger(correlationId: string, service: string): Logger {
    const context = this.currentContext.get(correlationId);
    const logger = new Logger(service);
    
    logger.setCorrelationId(correlationId);
    
    if (context) {
      logger.setTraceContext(context.traceId || undefined, context.segmentId || undefined);
    }

    return logger;
  }

  /**
   * Wrap async operation with correlation context
   */
  async withCorrelation<T>(
    correlationId: string,
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    
    this.addBreadcrumb(correlationId, 'correlation-service', `${operation}_start`);
    
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      
      this.addBreadcrumb(correlationId, 'correlation-service', `${operation}_success`, {
        duration,
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.addBreadcrumb(correlationId, 'correlation-service', `${operation}_error`, {
        duration,
        error: (error as Error).message,
      });
      
      throw error;
    }
  }

  /**
   * Clean up old correlation contexts
   */
  cleanup(maxAge: number = 3600000): void { // Default 1 hour
    const cutoff = Date.now() - maxAge;
    const toDelete: string[] = [];

    for (const [id, context] of this.currentContext.entries()) {
      const contextTime = new Date(context.timestamp).getTime();
      if (contextTime < cutoff) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.currentContext.delete(id);
    }

    if (toDelete.length > 0) {
      this.logger.debug('Cleaned up correlation contexts', {
        cleaned: toDelete.length,
        remaining: this.currentContext.size,
      });
    }
  }

  /**
   * Get correlation statistics
   */
  getStatistics(): CorrelationStatistics {
    const contexts = Array.from(this.currentContext.values());
    const now = Date.now();

    const ageDistribution = contexts.reduce((acc, context) => {
      const age = now - new Date(context.timestamp).getTime();
      const ageMinutes = Math.floor(age / 60000);
      
      if (ageMinutes < 5) acc.under5min++;
      else if (ageMinutes < 15) acc.under15min++;
      else if (ageMinutes < 60) acc.under1hour++;
      else acc.over1hour++;
      
      return acc;
    }, { under5min: 0, under15min: 0, under1hour: 0, over1hour: 0 });

    const userDistribution = contexts.reduce((acc, context) => {
      if (context.userId) {
        acc[context.userId] = (acc[context.userId] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    return {
      totalContexts: contexts.length,
      ageDistribution,
      topUsers: Object.entries(userDistribution)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([userId, count]) => ({ userId, count })),
      averageBreadcrumbs: contexts.length > 0 
        ? contexts.reduce((sum, ctx) => sum + ctx.breadcrumbs.length, 0) / contexts.length 
        : 0,
    };
  }

  /**
   * Export correlation context for debugging
   */
  exportContext(correlationId: string): CorrelationContext | null {
    const context = this.currentContext.get(correlationId);
    return context ? { ...context } : null;
  }

  /**
   * Import correlation context (for testing or debugging)
   */
  importContext(context: CorrelationContext): void {
    this.currentContext.set(context.correlationId, context);
  }
}

/**
 * Correlation context interface
 */
export interface CorrelationContext {
  correlationId: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  parentCorrelationId?: string;
  timestamp: string;
  traceId?: string | null;
  segmentId?: string | null;
  breadcrumbs: CorrelationBreadcrumb[];
}

/**
 * Correlation breadcrumb for tracking operation flow
 */
export interface CorrelationBreadcrumb {
  service: string;
  operation: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

/**
 * Correlation statistics
 */
export interface CorrelationStatistics {
  totalContexts: number;
  ageDistribution: {
    under5min: number;
    under15min: number;
    under1hour: number;
    over1hour: number;
  };
  topUsers: Array<{ userId: string; count: number }>;
  averageBreadcrumbs: number;
}