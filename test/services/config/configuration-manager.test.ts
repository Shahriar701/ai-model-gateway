import { ConfigurationManager, ValidationResult } from '../../../src/services/config/configuration-manager';
import { AI_GATEWAY_CONFIG_SCHEMA } from '../../../src/services/config/config-schema';

// Mock AWS SDK
jest.mock('aws-sdk', () => ({
  SSM: jest.fn().mockImplementation(() => ({
    getParameter: jest.fn(),
    putParameter: jest.fn(),
    deleteParameter: jest.fn(),
    getParametersByPath: jest.fn(),
  })),
}));

describe('ConfigurationManager', () => {
  let configManager: ConfigurationManager;
  let mockSSM: any;

  beforeEach(() => {
    // Reset singleton
    (ConfigurationManager as any).instance = undefined;
    configManager = ConfigurationManager.getInstance();
    
    // Get mock SSM instance
    const AWS = require('aws-sdk');
    mockSSM = new AWS.SSM();
    (configManager as any).ssm = mockSSM;
  });

  afterEach(() => {
    jest.clearAllMocks();
    configManager.stop();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = ConfigurationManager.getInstance();
      const instance2 = ConfigurationManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('get', () => {
    it('should get configuration value from Parameter Store', async () => {
      const mockValue = 'test-value';
      mockSSM.getParameter.mockReturnValue({
        promise: () => Promise.resolve({
          Parameter: { Value: mockValue, Type: 'String' }
        })
      });

      const result = await configManager.get('test-key');
      expect(result).toBe(mockValue);
      expect(mockSSM.getParameter).toHaveBeenCalledWith({
        Name: '/ai-model-gateway/test/test-key',
        WithDecryption: true,
      });
    });

    it('should return default value when parameter not found', async () => {
      mockSSM.getParameter.mockReturnValue({
        promise: () => Promise.reject({ code: 'ParameterNotFound' })
      });

      const defaultValue = 'default';
      const result = await configManager.get('test-key', defaultValue);
      expect(result).toBe(defaultValue);
    });

    it('should parse JSON values correctly', async () => {
      const mockObject = { key: 'value', number: 42 };
      mockSSM.getParameter.mockReturnValue({
        promise: () => Promise.resolve({
          Parameter: { Value: JSON.stringify(mockObject), Type: 'String' }
        })
      });

      const result = await configManager.get('test-key');
      expect(result).toEqual(mockObject);
    });
  });
});  describ
e('set', () => {
    it('should set configuration value in Parameter Store', async () => {
      mockSSM.putParameter.mockReturnValue({
        promise: () => Promise.resolve({})
      });

      await configManager.set('test-key', 'test-value');
      
      expect(mockSSM.putParameter).toHaveBeenCalledWith({
        Name: '/ai-model-gateway/test/test-key',
        Value: 'test-value',
        Type: 'String',
        Overwrite: true,
        Description: undefined,
        Tags: undefined,
      });
    });

    it('should set secure configuration with SecureString type', async () => {
      mockSSM.putParameter.mockReturnValue({
        promise: () => Promise.resolve({})
      });

      await configManager.set('test-key', 'secret-value', { secure: true });
      
      expect(mockSSM.putParameter).toHaveBeenCalledWith({
        Name: '/ai-model-gateway/test/test-key',
        Value: 'secret-value',
        Type: 'SecureString',
        Overwrite: true,
        Description: undefined,
        Tags: undefined,
      });
    });

    it('should stringify non-string values', async () => {
      mockSSM.putParameter.mockReturnValue({
        promise: () => Promise.resolve({})
      });

      const objectValue = { key: 'value' };
      await configManager.set('test-key', objectValue);
      
      expect(mockSSM.putParameter).toHaveBeenCalledWith({
        Name: '/ai-model-gateway/test/test-key',
        Value: JSON.stringify(objectValue),
        Type: 'String',
        Overwrite: true,
        Description: undefined,
        Tags: undefined,
      });
    });
  });

  describe('validateConfiguration', () => {
    it('should validate configuration against schema', () => {
      const config = {
        'api/cors/enabled': true,
        'api/request-timeout': 30000,
        'providers/openai/enabled': true,
      };

      const result = configManager.validateConfiguration(config, AI_GATEWAY_CONFIG_SCHEMA);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return validation errors for invalid configuration', () => {
      const config = {
        'api/cors/enabled': 'invalid-boolean',
        'api/request-timeout': -1000, // Invalid negative timeout
      };

      const result = configManager.validateConfiguration(config, AI_GATEWAY_CONFIG_SCHEMA);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return warnings for deprecated configurations', () => {
      const schema = {
        'deprecated-key': {
          type: 'string' as const,
          deprecated: 'This configuration is deprecated',
        },
      };

      const config = {
        'deprecated-key': 'value',
      };

      const result = configManager.validateConfiguration(config, schema);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain("Configuration 'deprecated-key' is deprecated: This configuration is deprecated");
    });
  });

  describe('getAll', () => {
    it('should get all configurations with prefix', async () => {
      const mockParameters = [
        { Name: '/ai-model-gateway/test/api/cors/enabled', Value: 'true' },
        { Name: '/ai-model-gateway/test/api/request-timeout', Value: '30000' },
      ];

      mockSSM.getParametersByPath.mockReturnValue({
        promise: () => Promise.resolve({ Parameters: mockParameters })
      });

      const result = await configManager.getAll('api');
      
      expect(result).toEqual({
        'api/cors/enabled': true,
        'api/request-timeout': 30000,
      });
    });

    it('should handle paginated results', async () => {
      const mockParameters1 = [
        { Name: '/ai-model-gateway/test/key1', Value: 'value1' },
      ];
      const mockParameters2 = [
        { Name: '/ai-model-gateway/test/key2', Value: 'value2' },
      ];

      mockSSM.getParametersByPath
        .mockReturnValueOnce({
          promise: () => Promise.resolve({ 
            Parameters: mockParameters1, 
            NextToken: 'token123' 
          })
        })
        .mockReturnValueOnce({
          promise: () => Promise.resolve({ 
            Parameters: mockParameters2 
          })
        });

      const result = await configManager.getAll();
      
      expect(result).toEqual({
        'key1': 'value1',
        'key2': 'value2',
      });
      expect(mockSSM.getParametersByPath).toHaveBeenCalledTimes(2);
    });
  });

  describe('caching', () => {
    it('should cache configuration values', async () => {
      mockSSM.getParameter.mockReturnValue({
        promise: () => Promise.resolve({
          Parameter: { Value: 'cached-value', Type: 'String' }
        })
      });

      // First call should hit Parameter Store
      const result1 = await configManager.get('test-key');
      expect(result1).toBe('cached-value');
      expect(mockSSM.getParameter).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const result2 = await configManager.get('test-key');
      expect(result2).toBe('cached-value');
      expect(mockSSM.getParameter).toHaveBeenCalledTimes(1);
    });

    it('should expire cache after TTL', async () => {
      // Mock Date.now to control time
      const originalNow = Date.now;
      let currentTime = 1000000;
      Date.now = jest.fn(() => currentTime);

      mockSSM.getParameter.mockReturnValue({
        promise: () => Promise.resolve({
          Parameter: { Value: 'cached-value', Type: 'String' }
        })
      });

      // First call
      await configManager.get('test-key');
      expect(mockSSM.getParameter).toHaveBeenCalledTimes(1);

      // Advance time beyond cache TTL (5 minutes = 300000ms)
      currentTime += 300001;

      // Second call should hit Parameter Store again
      await configManager.get('test-key');
      expect(mockSSM.getParameter).toHaveBeenCalledTimes(2);

      // Restore Date.now
      Date.now = originalNow;
    });
  });
});