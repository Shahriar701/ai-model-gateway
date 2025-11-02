import * as AWSXRay from 'aws-xray-sdk-core';
import { Logger } from '../../shared/utils';

/**
 * Comprehensive X-Ray tracing service for distributed request tracking
 * Provides correlation ID tracking and distributed tracing across all services
 */
export class TracingService {
  private static instance: TracingService;
  private logger: Logger;
  private isEnabled: boolean;

  private constructor() {
    this.logger = new Logger('TracingService');
    this.isEnabled = process.env.XRAY_TRACING_ENABLED !== 'false';
    
    if (this.isEnabled) {
      this.initializeXRay();
    }
  }

  static getInstance(): TracingService {
    if (!TracingService.instance) {
      TracingService.instance = new TracingService();
    }
    return TracingService.instance;
  }

  /**
   * Initialize X-Ray SDK with proper configuration
   */
  private initializeXRay(): void {
    try {
      // Configure X-Ray SDK
      AWSXRay.config([
        AWSXRay.plugins.ECSPlugin,
        AWSXRay.plugins.EC2Plugin,
      ]);

      // Set sampling rules
      AWSXRay.middleware.setSamplingRules({
        version: 2,
        default: {
          fixed_target: 1,
          rate: 0.1,
        },
        rules: [
          {
            description: 'Health checks',
            service_name: 'ai-model-gateway',
            http_method: 'GET',
            url_path: '/api/v1/health*',
            fixed_target: 0,
            rate: 0.01,
          },
          {
            description: 'LLM completions',
            service_name: 'ai-model-gateway',
            http_method: 'POST',
            url_path: '/api/v1/completions',
            fixed_target: 2,
            rate: 0.5,
          },
          {
            description: 'Security events',
            service_name: 'ai-model-gateway',
            http_method: '*',
            url_path: '*',
            fixed_target: 1,
            rate: 1.0,
          },
        ],
      });

      this.logger.info('X-Ray tracing initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize X-Ray tracing', error as Error);
      this.isEnabled = false;
    }
  }

  /**
   * Create a new trace segment for Lambda function
   */
  createLambdaSegment(name: string, correlationId: string): AWSXRay.Segment | null {
    if (!this.isEnabled) {
      return null;
    }

    try {
      const segment = new AWSXRay.Segment(name);
      segment.addAnnotation('correlationId', correlationId);
      segment.addAnnotation('service', 'ai-model-gateway');
      segment.addAnnotation('environment', process.env.NODE_ENV || 'development');
      
      AWSXRay.setSegment(segment);
      return segment;
    } catch (error) {
      this.logger.error('Failed to create Lambda segment', error as Error);
      return null;
    }
  }

  /**
   * Create a subsegment for operation tracking
   */
  createSubsegment(name: string, metadata?: Record<string, any>): AWSXRay.Subsegment | null {
    if (!this.isEnabled) {
      return null;
    }

    try {
      const segment = AWSXRay.getSegment();
      if (!segment) {
        this.logger.debug('No active segment found for subsegment creation');
        return null;
      }

      const subsegment = segment.addNewSubsegment(name);
      
      if (metadata) {
        subsegment.addMetadata('operation', metadata);
      }

      return subsegment;
    } catch (error) {
      this.logger.debug('Failed to create subsegment', { name, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Close subsegment with optional error and metadata
   */
  closeSubsegment(
    subsegment: AWSXRay.Subsegment | null,
    error?: Error,
    metadata?: Record<string, any>
  ): void {
    if (!subsegment || !this.isEnabled) {
      return;
    }

    try {
      if (error) {
        subsegment.addError(error);
        subsegment.addAnnotation('error', true);
        subsegment.addAnnotation('errorType', error.name);
      }

      if (metadata) {
        subsegment.addMetadata('result', metadata);
      }

      subsegment.close();
    } catch (closeError) {
      this.logger.debug('Failed to close subsegment', { error: (closeError as Error).message });
    }
  }

  /**
   * Add annotation to current segment
   */
  addAnnotation(key: string, value: string | number | boolean): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      const segment = AWSXRay.getSegment();
      if (segment) {
        segment.addAnnotation(key, value);
      }
    } catch (error) {
      this.logger.debug('Failed to add annotation', { key, value, error: (error as Error).message });
    }
  }

  /**
   * Add metadata to current segment
   */
  addMetadata(namespace: string, data: Record<string, any>): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      const segment = AWSXRay.getSegment();
      if (segment) {
        segment.addMetadata(namespace, data);
      }
    } catch (error) {
      this.logger.debug('Failed to add metadata', { namespace, error: (error as Error).message });
    }
  }

  /**
   * Trace HTTP request to external service
   */
  traceHttpRequest(
    url: string,
    method: string,
    subsegmentName?: string
  ): AWSXRay.Subsegment | null {
    if (!this.isEnabled) {
      return null;
    }

    try {
      const segment = AWSXRay.getSegment();
      if (!segment) {
        return null;
      }

      const subsegment = segment.addNewSubsegment(subsegmentName || 'http_request');
      subsegment.addAttribute('namespace', 'remote');
      
      const parsedUrl = new URL(url);
      subsegment.addAttribute('http', {
        request: {
          method,
          url: parsedUrl.href,
        },
      });

      subsegment.addAnnotation('http.method', method);
      subsegment.addAnnotation('http.url', parsedUrl.hostname);

      return subsegment;
    } catch (error) {
      this.logger.debug('Failed to create HTTP trace subsegment', { url, method, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Complete HTTP request tracing
   */
  completeHttpTrace(
    subsegment: AWSXRay.Subsegment | null,
    statusCode: number,
    responseSize?: number,
    error?: Error
  ): void {
    if (!subsegment || !this.isEnabled) {
      return;
    }

    try {
      const httpData = subsegment.http || { request: {} };
      httpData.response = {
        status: statusCode,
        content_length: responseSize,
      };
      subsegment.addAttribute('http', httpData);

      subsegment.addAnnotation('http.status_code', statusCode);

      if (error) {
        subsegment.addError(error);
      } else if (statusCode >= 400) {
        subsegment.addAnnotation('error', true);
        subsegment.addAnnotation('fault', statusCode >= 500);
      }

      subsegment.close();
    } catch (closeError) {
      this.logger.debug('Failed to complete HTTP trace', { statusCode, error: (closeError as Error).message });
    }
  }

  /**
   * Trace database operation
   */
  traceDatabaseOperation(
    operation: string,
    tableName: string,
    connectionUrl?: string
  ): AWSXRay.Subsegment | null {
    if (!this.isEnabled) {
      return null;
    }

    try {
      const segment = AWSXRay.getSegment();
      if (!segment) {
        return null;
      }

      const subsegment = segment.addNewSubsegment(`dynamodb_${operation}`);
      subsegment.addAttribute('namespace', 'aws');
      
      subsegment.addAttribute('aws', {
        operation,
        region: process.env.AWS_REGION || 'us-east-1',
        table_name: tableName,
      });

      subsegment.addAnnotation('aws.operation', operation);
      subsegment.addAnnotation('aws.table_name', tableName);

      return subsegment;
    } catch (error) {
      this.logger.debug('Failed to create database trace subsegment', { operation, tableName, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Complete database operation tracing
   */
  completeDatabaseTrace(
    subsegment: AWSXRay.Subsegment | null,
    itemCount?: number,
    error?: Error
  ): void {
    if (!subsegment || !this.isEnabled) {
      return;
    }

    try {
      if (itemCount !== undefined) {
        subsegment.addAnnotation('aws.item_count', itemCount);
      }

      if (error) {
        subsegment.addError(error);
      }

      subsegment.close();
    } catch (closeError) {
      this.logger.debug('Failed to complete database trace', { itemCount, error: (closeError as Error).message });
    }
  }

  /**
   * Trace LLM provider request
   */
  traceLLMRequest(
    provider: string,
    model: string,
    tokenCount?: number
  ): AWSXRay.Subsegment | null {
    if (!this.isEnabled) {
      return null;
    }

    try {
      const segment = AWSXRay.getSegment();
      if (!segment) {
        return null;
      }

      const subsegment = segment.addNewSubsegment(`llm_${provider}`);
      subsegment.addAttribute('namespace', 'remote');

      subsegment.addAnnotation('llm.provider', provider);
      subsegment.addAnnotation('llm.model', model);
      
      if (tokenCount) {
        subsegment.addAnnotation('llm.input_tokens', tokenCount);
      }

      subsegment.addMetadata('llm_request', {
        provider,
        model,
        inputTokens: tokenCount,
        timestamp: new Date().toISOString(),
      });

      return subsegment;
    } catch (error) {
      this.logger.debug('Failed to create LLM trace subsegment', { provider, model, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Complete LLM request tracing
   */
  completeLLMTrace(
    subsegment: AWSXRay.Subsegment | null,
    outputTokens?: number,
    cost?: number,
    cached?: boolean,
    error?: Error
  ): void {
    if (!subsegment || !this.isEnabled) {
      return;
    }

    try {
      if (outputTokens) {
        subsegment.addAnnotation('llm.output_tokens', outputTokens);
        subsegment.addAnnotation('llm.total_tokens', (subsegment.annotations?.['llm.input_tokens'] || 0) + outputTokens);
      }

      if (cost !== undefined) {
        subsegment.addAnnotation('llm.cost', cost);
      }

      if (cached !== undefined) {
        subsegment.addAnnotation('llm.cached', cached);
      }

      subsegment.addMetadata('llm_response', {
        outputTokens,
        cost,
        cached,
        success: !error,
        timestamp: new Date().toISOString(),
      });

      if (error) {
        subsegment.addError(error);
      }

      subsegment.close();
    } catch (closeError) {
      this.logger.debug('Failed to complete LLM trace', { outputTokens, cost, error: (closeError as Error).message });
    }
  }

  /**
   * Get current trace ID for correlation
   */
  getCurrentTraceId(): string | null {
    if (!this.isEnabled) {
      return null;
    }

    try {
      const segment = AWSXRay.getSegment();
      return segment ? segment.trace_id : null;
    } catch {
      return null;
    }
  }

  /**
   * Get current segment ID for correlation
   */
  getCurrentSegmentId(): string | null {
    if (!this.isEnabled) {
      return null;
    }

    try {
      const segment = AWSXRay.getSegment();
      return segment ? segment.id : null;
    } catch {
      return null;
    }
  }

  /**
   * Create trace context for correlation across services
   */
  getTraceContext(): { traceId: string | null; segmentId: string | null } {
    return {
      traceId: this.getCurrentTraceId(),
      segmentId: this.getCurrentSegmentId(),
    };
  }

  /**
   * Instrument AWS SDK calls for automatic tracing
   */
  instrumentAWS<T>(awsService: T): T {
    if (!this.isEnabled) {
      return awsService;
    }

    try {
      return AWSXRay.captureAWS(awsService as any) as T;
    } catch (error) {
      this.logger.debug('Failed to instrument AWS service', { error: (error as Error).message });
      return awsService;
    }
  }

  /**
   * Instrument HTTP clients for automatic tracing
   */
  instrumentHTTP(): void {
    if (!this.isEnabled) {
      return;
    }

    try {
      AWSXRay.captureHTTPsGlobal(require('https'));
      AWSXRay.captureHTTPsGlobal(require('http'));
      this.logger.debug('HTTP clients instrumented for X-Ray tracing');
    } catch (error) {
      this.logger.debug('Failed to instrument HTTP clients', { error: (error as Error).message });
    }
  }

  /**
   * Check if tracing is enabled
   */
  isTracingEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Disable tracing (for testing or debugging)
   */
  disable(): void {
    this.isEnabled = false;
    this.logger.info('X-Ray tracing disabled');
  }

  /**
   * Enable tracing
   */
  enable(): void {
    this.isEnabled = true;
    this.initializeXRay();
    this.logger.info('X-Ray tracing enabled');
  }
}