/**
 * Structured logger for production observability
 * Provides correlation ID tracking and structured JSON logging
 */
export class Logger {
  private correlationId?: string;
  private service: string;

  constructor(service: string) {
    this.service = service;
  }

  setCorrelationId(correlationId: string): void {
    this.correlationId = correlationId;
  }

  info(message: string, meta: Record<string, any> = {}): void {
    this.log('INFO', message, meta);
  }

  debug(message: string, meta: Record<string, any> = {}): void {
    if (process.env.LOG_LEVEL === 'DEBUG') {
      this.log('DEBUG', message, meta);
    }
  }

  warn(message: string, meta: Record<string, any> = {}): void {
    this.log('WARN', message, meta);
  }

  error(message: string, error?: Error | string, meta: Record<string, any> = {}): void {
    const errorMeta = typeof error === 'string'
      ? { error }
      : error
      ? {
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack,
        }
      : {};

    this.log('ERROR', message, { ...meta, ...errorMeta });
  }

  private log(level: string, message: string, meta: Record<string, any>): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      correlationId: this.correlationId,
      ...meta,
    };

    console.log(JSON.stringify(logEntry));
  }
}

// Default logger instance
export const logger = new Logger('ai-model-gateway');
