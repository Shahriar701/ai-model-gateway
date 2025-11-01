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

  warn(message: string, meta: Record<string, any> = {}): void {
    this.log('WARN', message, meta);
  }

  error(message: string, error?: Error, meta: Record<string, any> = {}): void {
    const errorMeta = error ? {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack
    } : {};
    
    this.log('ERROR', message, { ...meta, ...errorMeta });
  }

  private log(level: string, message: string, meta: Record<string, any>): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      correlationId: this.correlationId,
      ...meta
    };

    console.log(JSON.stringify(logEntry));
  }
}