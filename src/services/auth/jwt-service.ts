/**
 * JWT Service for token validation and management
 * Handles JWT token creation, validation, and refresh
 */

import * as crypto from 'crypto';
import { Logger } from '../../shared/utils/logger';

const logger = new Logger('JWTService');

export interface JWTPayload {
  sub?: string; // Subject (user ID)
  iss: string; // Issuer
  aud: string; // Audience
  exp: number; // Expiration time
  iat: number; // Issued at
  jti: string; // JWT ID
  scope?: string[]; // Permissions/scopes
  tier?: string; // API key tier
  keyId?: string; // API key ID
  metadata?: Record<string, any>;
}

export interface JWTHeader {
  alg: string;
  typ: string;
  kid?: string; // Key ID
}

export interface JWTValidationResult {
  valid: boolean;
  payload?: JWTPayload;
  error?: string;
  expired?: boolean;
}

export interface JWTConfig {
  issuer: string;
  audience: string;
  secretKey: string;
  algorithm: 'HS256' | 'HS384' | 'HS512';
  expirationTime: string; // e.g., '1h', '24h', '7d'
  refreshExpirationTime: string;
}

export class JWTService {
  private config: JWTConfig;

  constructor(config?: Partial<JWTConfig>) {
    this.config = {
      issuer: process.env.JWT_ISSUER || 'ai-model-gateway',
      audience: process.env.JWT_AUDIENCE || 'ai-gateway-api',
      secretKey: process.env.JWT_SECRET_KEY || this.generateSecretKey(),
      algorithm: 'HS256',
      expirationTime: process.env.JWT_EXPIRATION || '1h',
      refreshExpirationTime: process.env.JWT_REFRESH_EXPIRATION || '7d',
      ...config,
    };

    if (!process.env.JWT_SECRET_KEY) {
      logger.warn('JWT_SECRET_KEY not set, using generated key (not suitable for production)');
    }
  }

  /**
   * Generate a JWT token
   */
  async generateToken(payload: Partial<JWTPayload>): Promise<string> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const exp = now + this.parseExpirationTime(this.config.expirationTime);

      const fullPayload: JWTPayload = {
        iss: this.config.issuer,
        aud: this.config.audience,
        iat: now,
        exp,
        jti: this.generateJTI(),
        ...payload,
      };

      const header: JWTHeader = {
        alg: this.config.algorithm,
        typ: 'JWT',
      };

      const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
      const encodedPayload = this.base64UrlEncode(JSON.stringify(fullPayload));
      
      const signature = this.generateSignature(
        `${encodedHeader}.${encodedPayload}`,
        this.config.secretKey,
        this.config.algorithm
      );

      const token = `${encodedHeader}.${encodedPayload}.${signature}`;

      logger.info('JWT token generated', {
        sub: fullPayload.sub,
        exp: fullPayload.exp,
        jti: fullPayload.jti,
      });

      return token;
    } catch (error) {
      logger.error('Failed to generate JWT token', error instanceof Error ? error : new Error(String(error)));
      throw new Error('Token generation failed');
    }
  }

  /**
   * Generate a refresh token
   */
  async generateRefreshToken(payload: Partial<JWTPayload>): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.parseExpirationTime(this.config.refreshExpirationTime);

    const refreshPayload: JWTPayload = {
      ...payload,
      iss: this.config.issuer,
      aud: this.config.audience,
      iat: now,
      exp,
      jti: this.generateJTI(),
      scope: ['refresh'], // Refresh tokens have limited scope
    };

    const header: JWTHeader = {
      alg: this.config.algorithm,
      typ: 'JWT',
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(refreshPayload));
    
    const signature = this.generateSignature(
      `${encodedHeader}.${encodedPayload}`,
      this.config.secretKey,
      this.config.algorithm
    );

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /**
   * Validate a JWT token
   */
  async validateToken(token: string): Promise<JWTValidationResult> {
    try {
      if (!token) {
        return { valid: false, error: 'Token is required' };
      }

      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, error: 'Invalid token format' };
      }

      const [encodedHeader, encodedPayload, signature] = parts;

      // Verify signature
      const expectedSignature = this.generateSignature(
        `${encodedHeader}.${encodedPayload}`,
        this.config.secretKey,
        this.config.algorithm
      );

      if (signature !== expectedSignature) {
        logger.warn('JWT signature verification failed');
        return { valid: false, error: 'Invalid signature' };
      }

      // Decode and validate payload
      const payload: JWTPayload = JSON.parse(this.base64UrlDecode(encodedPayload));

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        logger.info('JWT token expired', { exp: payload.exp, now });
        return { valid: false, error: 'Token expired', expired: true };
      }

      // Check issuer
      if (payload.iss !== this.config.issuer) {
        return { valid: false, error: 'Invalid issuer' };
      }

      // Check audience
      if (payload.aud !== this.config.audience) {
        return { valid: false, error: 'Invalid audience' };
      }

      // Check issued at time (not in the future)
      if (payload.iat && payload.iat > now + 60) { // Allow 60 seconds clock skew
        return { valid: false, error: 'Token issued in the future' };
      }

      logger.info('JWT token validated successfully', {
        sub: payload.sub,
        jti: payload.jti,
        scope: payload.scope,
      });

      return { valid: true, payload };
    } catch (error) {
      logger.error('JWT validation error', error instanceof Error ? error : new Error(String(error)));
      return { valid: false, error: 'Token validation failed' };
    }
  }

  /**
   * Refresh a JWT token using a refresh token
   */
  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string } | null> {
    try {
      const validation = await this.validateToken(refreshToken);
      
      if (!validation.valid || !validation.payload) {
        logger.warn('Invalid refresh token provided');
        return null;
      }

      // Check if it's actually a refresh token
      if (!validation.payload.scope?.includes('refresh')) {
        logger.warn('Token is not a refresh token');
        return null;
      }

      // Generate new tokens
      const newAccessToken = await this.generateToken({
        sub: validation.payload.sub,
        tier: validation.payload.tier,
        keyId: validation.payload.keyId,
        scope: validation.payload.scope?.filter(s => s !== 'refresh'),
        metadata: validation.payload.metadata,
      });

      const newRefreshToken = await this.generateRefreshToken({
        sub: validation.payload.sub,
        tier: validation.payload.tier,
        keyId: validation.payload.keyId,
        metadata: validation.payload.metadata,
      });

      logger.info('JWT tokens refreshed', { sub: validation.payload.sub });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      logger.error('Token refresh failed', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Decode a JWT token without validation (for debugging)
   */
  decodeToken(token: string): { header: JWTHeader; payload: JWTPayload } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const header: JWTHeader = JSON.parse(this.base64UrlDecode(parts[0]));
      const payload: JWTPayload = JSON.parse(this.base64UrlDecode(parts[1]));

      return { header, payload };
    } catch {
      return null;
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authHeader: string): string | null {
    if (!authHeader) {
      return null;
    }

    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    return bearerMatch ? bearerMatch[1] : null;
  }

  /**
   * Generate a cryptographically secure secret key
   */
  private generateSecretKey(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Generate a unique JWT ID
   */
  private generateJTI(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Parse expiration time string to seconds
   */
  private parseExpirationTime(timeStr: string): number {
    const match = timeStr.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error(`Invalid expiration time format: ${timeStr}`);
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 60 * 60 * 24;
      default: throw new Error(`Invalid time unit: ${unit}`);
    }
  }

  /**
   * Base64 URL encode
   */
  private base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Base64 URL decode
   */
  private base64UrlDecode(str: string): string {
    // Add padding if needed
    const padded = str + '='.repeat((4 - str.length % 4) % 4);
    
    return Buffer.from(
      padded.replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString();
  }

  /**
   * Generate HMAC signature
   */
  private generateSignature(data: string, secret: string, algorithm: string): string {
    const hmacAlgorithm = algorithm.toLowerCase().replace('hs', 'sha');
    const signature = crypto
      .createHmac(hmacAlgorithm, secret)
      .update(data)
      .digest('base64');

    return signature
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
}