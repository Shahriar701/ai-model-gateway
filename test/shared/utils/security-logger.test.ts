import { SecurityLogger, SecurityMetrics } from '../../../src/shared/utils/security-logger';
import { SecurityEventType } from '../../../src/shared/types/security-types';

describe('SecurityLogger', () => {
  let securityLogger: SecurityLogger;
  const mockCorrelationId = 'test-correlation-id';

  beforeEach(() => {
    securityLogger = SecurityLogger.getInstance();
  });

  describe('logAuthenticationAttempt', () => {
    it('should log successful authentication', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logAuthenticationAttempt(
        mockCorrelationId,
        'user123',
        'api-key-123',
        true,
        '127.0.0.1',
        'test-agent'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Authentication successful')
      );

      consoleSpy.mockRestore();
    });

    it('should log failed authentication', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logAuthenticationAttempt(
        mockCorrelationId,
        null,
        'invalid-key',
        false,
        '127.0.0.1',
        'test-agent',
        'Invalid API key'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Authentication failed')
      );

      consoleSpy.mockRestore();
    });

    it('should mask sensitive data in logs', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logAuthenticationAttempt(
        mockCorrelationId,
        'very-long-user-id-12345',
        'very-long-api-key-67890',
        true
      );

      const logCall = consoleSpy.mock.calls.find(call => 
        call[0].includes('Authentication successful')
      );
      
      expect(logCall).toBeDefined();
      const logData = JSON.parse(logCall![0]);
      
      // Check that sensitive data is masked
      expect(logData.userId).toBe('very***2345');
      expect(logData.apiKeyPrefix).toBe('very-lon***');

      consoleSpy.mockRestore();
    });
  });

  describe('logRateLimitExceeded', () => {
    it('should log rate limit exceeded events', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logRateLimitExceeded(
        mockCorrelationId,
        'user123',
        'premium',
        5,
        '127.0.0.1',
        'test-agent'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit exceeded')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('logDangerousPatternDetected', () => {
    it('should log XSS pattern detection', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logDangerousPatternDetected(
        mockCorrelationId,
        'XSS',
        '<script>alert("xss")</script>',
        '127.0.0.1',
        'test-agent'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Dangerous pattern detected')
      );

      consoleSpy.mockRestore();
    });

    it('should log SQL injection pattern detection', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logDangerousPatternDetected(
        mockCorrelationId,
        'SQL_INJECTION',
        'SELECT * FROM users WHERE id = 1; DROP TABLE users;',
        '127.0.0.1',
        'test-agent'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Dangerous pattern detected')
      );

      consoleSpy.mockRestore();
    });

    it('should sanitize dangerous content in logs', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logDangerousPatternDetected(
        mockCorrelationId,
        'XSS',
        '<script>alert("dangerous")</script>',
        '127.0.0.1',
        'test-agent'
      );

      const logCall = consoleSpy.mock.calls.find(call => 
        call[0].includes('Dangerous pattern detected')
      );
      
      expect(logCall).toBeDefined();
      const logData = JSON.parse(logCall![0]);
      
      // Check that the log contains sanitized content
      expect(logData.contentSample).toBeDefined();
      expect(typeof logData.contentSample).toBe('string');
      // The content should be sanitized (dangerous chars replaced with *)
      expect(logData.contentSample).toMatch(/\*/);

      consoleSpy.mockRestore();
    });
  });

  describe('logOversizedRequest', () => {
    it('should log oversized request events', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logOversizedRequest(
        mockCorrelationId,
        1048576, // 1MB
        524288,  // 512KB
        'BODY',
        '127.0.0.1',
        'test-agent'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Oversized request detected')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('logInvalidHeader', () => {
    it('should log invalid header events', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logInvalidHeader(
        mockCorrelationId,
        'X-Dangerous-Header',
        'Contains dangerous patterns',
        '127.0.0.1',
        'test-agent'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid header detected')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('logApiKeyOperation', () => {
    it('should log successful API key creation', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logApiKeyOperation(
        mockCorrelationId,
        'CREATE',
        'key-12345',
        'user-67890',
        true,
        '127.0.0.1'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('API key create successful')
      );

      consoleSpy.mockRestore();
    });

    it('should log failed API key revocation', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logApiKeyOperation(
        mockCorrelationId,
        'REVOKE',
        'key-12345',
        'user-67890',
        false,
        '127.0.0.1',
        'Key not found'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('API key revoke failed')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('logSecurityConfigChange', () => {
    it('should log security configuration changes', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logSecurityConfigChange(
        mockCorrelationId,
        'admin-user',
        'rate-limits',
        { requestsPerMinute: 100 },
        { requestsPerMinute: 200 },
        '127.0.0.1'
      );

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Security configuration changed')
      );

      consoleSpy.mockRestore();
    });

    it('should mask secrets in configuration changes', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      securityLogger.logSecurityConfigChange(
        mockCorrelationId,
        'admin-user',
        'api-settings',
        { apiSecret: 'old-secret-key-123' },
        { apiSecret: 'new-secret-key-456' },
        '127.0.0.1'
      );

      const logCall = consoleSpy.mock.calls.find(call => 
        call[0].includes('Security configuration changed')
      );
      
      expect(logCall).toBeDefined();
      const logData = JSON.parse(logCall![0]);
      
      // Check that secrets are masked
      expect(logData.oldValue.apiSecret).toBe('***');
      expect(logData.newValue.apiSecret).toBe('***');

      consoleSpy.mockRestore();
    });
  });

  describe('generateSecurityMetrics', () => {
    it('should generate security metrics structure', () => {
      const metrics = securityLogger.generateSecurityMetrics(3600000); // 1 hour

      expect(metrics).toMatchObject({
        timeWindow: {
          start: expect.any(String),
          end: expect.any(String),
          durationMs: 3600000,
        },
        events: {
          authenticationFailures: expect.any(Number),
          rateLimitExceeded: expect.any(Number),
          dangerousPatterns: expect.any(Number),
          oversizedRequests: expect.any(Number),
          invalidHeaders: expect.any(Number),
        },
        topSourceIps: expect.any(Array),
        topUserAgents: expect.any(Array),
        alertsTriggered: expect.any(Number),
      });
    });

    it('should have valid time window format', () => {
      const metrics = securityLogger.generateSecurityMetrics(1800000); // 30 minutes

      expect(new Date(metrics.timeWindow.start)).toBeInstanceOf(Date);
      expect(new Date(metrics.timeWindow.end)).toBeInstanceOf(Date);
      expect(metrics.timeWindow.durationMs).toBe(1800000);
    });
  });
});