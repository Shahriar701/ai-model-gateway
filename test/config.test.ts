import { getConfig, devConfig, prodConfig } from '../config/environments';

describe('Environment Configuration Tests', () => {
  afterEach(() => {
    // Clean up environment variables after each test
    delete process.env.ENVIRONMENT;
  });

  test('getConfig returns dev config by default', () => {
    const config = getConfig();
    expect(config.environment).toBe('dev');
    expect(config.app.logLevel).toBe('DEBUG');
    expect(config.monitoring.alertingEnabled).toBe(false);
  });

  test('getConfig returns dev config for development environment', () => {
    process.env.ENVIRONMENT = 'development';
    const config = getConfig();
    expect(config.environment).toBe('dev');
    expect(config.app.logLevel).toBe('DEBUG');
  });

  test('getConfig returns prod config for production environment', () => {
    process.env.ENVIRONMENT = 'production';
    const config = getConfig();
    expect(config.environment).toBe('prod');
    expect(config.app.logLevel).toBe('INFO');
    expect(config.monitoring.alertingEnabled).toBe(true);
  });

  test('getConfig returns prod config for prod environment', () => {
    process.env.ENVIRONMENT = 'prod';
    const config = getConfig();
    expect(config.environment).toBe('prod');
    expect(config.app.logLevel).toBe('INFO');
  });

  test('dev config has correct values', () => {
    expect(devConfig.environment).toBe('dev');
    expect(devConfig.api.throttling.rateLimit).toBe(100);
    expect(devConfig.cache.ttl).toBe(300);
    expect(devConfig.monitoring.logRetentionDays).toBe(7);
    expect(devConfig.security.apiKeyRotationDays).toBe(90);
  });

  test('prod config has correct values', () => {
    expect(prodConfig.environment).toBe('prod');
    expect(prodConfig.api.throttling.rateLimit).toBe(1000);
    expect(prodConfig.cache.ttl).toBe(600);
    expect(prodConfig.monitoring.logRetentionDays).toBe(30);
    expect(prodConfig.security.apiKeyRotationDays).toBe(30);
  });

  test('prod config has stricter CORS settings', () => {
    expect(devConfig.api.cors.allowOrigins).toContain('*');
    expect(prodConfig.api.cors.allowOrigins).not.toContain('*');
    expect(prodConfig.api.cors.allowOrigins).toEqual([
      'https://yourdomain.com',
      'https://api.yourdomain.com',
    ]);
  });

  test('both configs have required provider settings', () => {
    [devConfig, prodConfig].forEach(config => {
      expect(config.providers.openai.enabled).toBe(true);
      expect(config.providers.bedrock.enabled).toBe(true);
      expect(config.providers.openai.priority).toBe(1);
      expect(config.providers.bedrock.priority).toBe(2);
      expect(config.providers.bedrock.models).toContain('anthropic.claude-3-sonnet-20240229-v1:0');
    });
  });

  test('security settings are consistent', () => {
    [devConfig, prodConfig].forEach(config => {
      expect(config.security.encryptionAtRest).toBe(true);
      expect(config.security.encryptionInTransit).toBe(true);
    });
  });
});
