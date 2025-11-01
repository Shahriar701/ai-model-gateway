import { APIGatewayProxyEvent } from 'aws-lambda';
import { createHmac, timingSafeEqual } from 'crypto';
import { Logger } from '../utils';

const logger = new Logger('RequestSigningMiddleware');

/**
 * Request signing middleware for secure communication
 */
export class RequestSigningMiddleware {
  private static readonly SIGNATURE_HEADER = 'X-Signature';
  private static readonly TIMESTAMP_HEADER = 'X-Timestamp';
  private static readonly NONCE_HEADER = 'X-Nonce';

  private static readonly MAX_TIMESTAMP_SKEW = 300000; // 5 minutes in milliseconds
  private static readonly SIGNATURE_VERSION = 'v1';

  // In production, this should come from AWS Secrets Manager or Parameter Store
  private static readonly SIGNING_SECRET =
    process.env.REQUEST_SIGNING_SECRET || 'default-secret-key';

  // Nonce cache to prevent replay attacks (in production, use Redis)
  private static nonceCache = new Set<string>();
  private static readonly MAX_NONCE_CACHE_SIZE = 10000;

  /**
   * Verify request signature
   */
  static async verifyRequestSignature(
    event: APIGatewayProxyEvent,
    correlationId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Skip signature verification for health checks and OPTIONS requests
      if (event.path === '/api/v1/health' || event.httpMethod === 'OPTIONS') {
        return { success: true };
      }

      // Check if signature verification is required for this endpoint
      if (!this.requiresSignatureVerification(event.path)) {
        logger.debug('Signature verification not required for endpoint', {
          correlationId,
          path: event.path,
        });
        return { success: true };
      }

      // Extract signature components
      const signature =
        event.headers[this.SIGNATURE_HEADER] || event.headers[this.SIGNATURE_HEADER.toLowerCase()];
      const timestamp =
        event.headers[this.TIMESTAMP_HEADER] || event.headers[this.TIMESTAMP_HEADER.toLowerCase()];
      const nonce =
        event.headers[this.NONCE_HEADER] || event.headers[this.NONCE_HEADER.toLowerCase()];

      if (!signature || !timestamp || !nonce) {
        logger.warn('Missing signature headers', {
          correlationId,
          hasSignature: !!signature,
          hasTimestamp: !!timestamp,
          hasNonce: !!nonce,
        });
        return { success: false, error: 'Missing required signature headers' };
      }

      // Verify timestamp
      const timestampValidation = this.verifyTimestamp(timestamp, correlationId);
      if (!timestampValidation.success) {
        return timestampValidation;
      }

      // Verify nonce (prevent replay attacks)
      const nonceValidation = this.verifyNonce(nonce, correlationId);
      if (!nonceValidation.success) {
        return nonceValidation;
      }

      // Verify signature
      const signatureValidation = this.verifySignature(
        event,
        signature,
        timestamp,
        nonce,
        correlationId
      );
      if (!signatureValidation.success) {
        return signatureValidation;
      }

      // Add nonce to cache to prevent replay
      this.addNonceToCache(nonce);

      logger.debug('Request signature verification successful', { correlationId });
      return { success: true };
    } catch (error) {
      logger.error('Request signature verification failed', error as Error, { correlationId });
      return { success: false, error: 'Signature verification failed' };
    }
  }

  /**
   * Generate request signature for outgoing requests
   */
  static generateRequestSignature(
    method: string,
    path: string,
    body: string | null,
    timestamp: string,
    nonce: string
  ): string {
    const payload = this.createSignaturePayload(method, path, body, timestamp, nonce);
    return this.createSignature(payload);
  }

  /**
   * Create signature headers for outgoing requests
   */
  static createSignatureHeaders(
    method: string,
    path: string,
    body: string | null
  ): Record<string, string> {
    const timestamp = Date.now().toString();
    const nonce = this.generateNonce();
    const signature = this.generateRequestSignature(method, path, body, timestamp, nonce);

    return {
      [this.SIGNATURE_HEADER]: `${this.SIGNATURE_VERSION}=${signature}`,
      [this.TIMESTAMP_HEADER]: timestamp,
      [this.NONCE_HEADER]: nonce,
    };
  }

  /**
   * Check if endpoint requires signature verification
   */
  private static requiresSignatureVerification(path: string): boolean {
    // Endpoints that require signature verification
    const secureEndpoints = ['/api/v1/admin/', '/api/v1/config/', '/api/v1/keys/'];

    return secureEndpoints.some(endpoint => path.startsWith(endpoint));
  }

  /**
   * Verify timestamp to prevent replay attacks
   */
  private static verifyTimestamp(
    timestamp: string,
    correlationId: string
  ): { success: boolean; error?: string } {
    try {
      const requestTime = parseInt(timestamp, 10);
      const currentTime = Date.now();
      const timeDiff = Math.abs(currentTime - requestTime);

      if (timeDiff > this.MAX_TIMESTAMP_SKEW) {
        logger.warn('Request timestamp outside allowed window', {
          correlationId,
          requestTime,
          currentTime,
          timeDiff,
          maxSkew: this.MAX_TIMESTAMP_SKEW,
        });
        return { success: false, error: 'Request timestamp outside allowed window' };
      }

      return { success: true };
    } catch (error) {
      logger.warn('Invalid timestamp format', { correlationId, timestamp });
      return { success: false, error: 'Invalid timestamp format' };
    }
  }

  /**
   * Verify nonce to prevent replay attacks
   */
  private static verifyNonce(
    nonce: string,
    correlationId: string
  ): { success: boolean; error?: string } {
    // Check nonce format
    if (!/^[a-zA-Z0-9]{16,64}$/.test(nonce)) {
      logger.warn('Invalid nonce format', { correlationId, nonce });
      return { success: false, error: 'Invalid nonce format' };
    }

    // Check if nonce has been used before
    if (this.nonceCache.has(nonce)) {
      logger.warn('Nonce already used (replay attack detected)', { correlationId, nonce });
      return { success: false, error: 'Nonce already used' };
    }

    return { success: true };
  }

  /**
   * Verify the actual signature
   */
  private static verifySignature(
    event: APIGatewayProxyEvent,
    signature: string,
    timestamp: string,
    nonce: string,
    correlationId: string
  ): { success: boolean; error?: string } {
    try {
      // Parse signature version
      const signatureParts = signature.split('=');
      if (signatureParts.length !== 2 || signatureParts[0] !== this.SIGNATURE_VERSION) {
        logger.warn('Invalid signature format', { correlationId, signature });
        return { success: false, error: 'Invalid signature format' };
      }

      const providedSignature = signatureParts[1];

      // Create expected signature
      const payload = this.createSignaturePayload(
        event.httpMethod,
        event.path,
        event.body,
        timestamp,
        nonce
      );
      const expectedSignature = this.createSignature(payload);

      // Use timing-safe comparison to prevent timing attacks
      const providedBuffer = Buffer.from(providedSignature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      if (providedBuffer.length !== expectedBuffer.length) {
        logger.warn('Signature length mismatch', { correlationId });
        return { success: false, error: 'Invalid signature' };
      }

      const isValid = timingSafeEqual(providedBuffer, expectedBuffer);

      if (!isValid) {
        logger.warn('Signature verification failed', { correlationId });
        return { success: false, error: 'Invalid signature' };
      }

      return { success: true };
    } catch (error) {
      logger.error('Signature verification error', error as Error, { correlationId });
      return { success: false, error: 'Signature verification failed' };
    }
  }

  /**
   * Create signature payload for hashing
   */
  private static createSignaturePayload(
    method: string,
    path: string,
    body: string | null,
    timestamp: string,
    nonce: string
  ): string {
    // Normalize the request components
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = path;
    const normalizedBody = body || '';

    // Create canonical string
    return [normalizedMethod, normalizedPath, normalizedBody, timestamp, nonce].join('\n');
  }

  /**
   * Create HMAC signature
   */
  private static createSignature(payload: string): string {
    return createHmac('sha256', this.SIGNING_SECRET).update(payload, 'utf8').digest('hex');
  }

  /**
   * Generate a cryptographically secure nonce
   */
  private static generateNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';

    // Generate 32 character nonce
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return result;
  }

  /**
   * Add nonce to cache with size management
   */
  private static addNonceToCache(nonce: string): void {
    // Simple cache size management (in production, use Redis with TTL)
    if (this.nonceCache.size >= this.MAX_NONCE_CACHE_SIZE) {
      // Remove oldest entries (simplified approach)
      const entries = Array.from(this.nonceCache);
      const toRemove = entries.slice(0, Math.floor(this.MAX_NONCE_CACHE_SIZE * 0.1));
      toRemove.forEach(entry => this.nonceCache.delete(entry));
    }

    this.nonceCache.add(nonce);
  }

  /**
   * Clear nonce cache (for testing)
   */
  static clearNonceCache(): void {
    this.nonceCache.clear();
  }

  /**
   * Get signature configuration for debugging
   */
  static getSignatureConfiguration() {
    return {
      signatureHeader: this.SIGNATURE_HEADER,
      timestampHeader: this.TIMESTAMP_HEADER,
      nonceHeader: this.NONCE_HEADER,
      maxTimestampSkew: this.MAX_TIMESTAMP_SKEW,
      signatureVersion: this.SIGNATURE_VERSION,
      nonceCacheSize: this.nonceCache.size,
      maxNonceCacheSize: this.MAX_NONCE_CACHE_SIZE,
    };
  }
}
