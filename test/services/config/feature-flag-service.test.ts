import { FeatureFlagService, FeatureFlag, UserContext } from '../../../src/services/config/feature-flag-service';
import { ConfigurationManager } from '../../../src/services/config/configuration-manager';

// Mock ConfigurationManager
jest.mock('../../../src/services/config/configuration-manager');

describe('FeatureFlagService', () => {
  let featureFlagService: FeatureFlagService;
  let mockConfigManager: jest.Mocked<ConfigurationManager>;

  beforeEach(() => {
    // Reset singleton
    (FeatureFlagService as any).instance = undefined;
    featureFlagService = FeatureFlagService.getInstance();
    
    // Mock ConfigurationManager
    mockConfigManager = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      getAll: jest.fn(),
    } as any;
    
    (featureFlagService as any).configManager = mockConfigManager;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isEnabled', () => {
    it('should return true for enabled flag without targeting', async () => {
      const flag: FeatureFlag = {
        name: 'test-flag',
        enabled: true,
        description: 'Test flag',
        rolloutPercentage: 100,
        targeting: {},
        metadata: {},
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      mockConfigManager.get.mockResolvedValue(flag);

      const result = await featureFlagService.isEnabled('test-flag');
      expect(result).toBe(true);
    });

    it('should return false for disabled flag', async () => {
      const flag: FeatureFlag = {
        name: 'test-flag',
        enabled: false,
        description: 'Test flag',
        rolloutPercentage: 100,
        targeting: {},
        metadata: {},
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      mockConfigManager.get.mockResolvedValue(flag);

      const result = await featureFlagService.isEnabled('test-flag');
      expect(result).toBe(false);
    });

    it('should return false for non-existent flag', async () => {
      mockConfigManager.get.mockRejectedValue(new Error('Not found'));

      const result = await featureFlagService.isEnabled('non-existent-flag');
      expect(result).toBe(false);
    });

    it('should respect rollout percentage', async () => {
      const flag: FeatureFlag = {
        name: 'test-flag',
        enabled: true,
        description: 'Test flag',
        rolloutPercentage: 50, // 50% rollout
        targeting: {},
        metadata: {},
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      mockConfigManager.get.mockResolvedValue(flag);

      // Mock hash function to return predictable values
      const originalHashUser = (featureFlagService as any).hashUser;
      (featureFlagService as any).hashUser = jest.fn()
        .mockReturnValueOnce(25) // Should be enabled (25 < 50)
        .mockReturnValueOnce(75); // Should be disabled (75 > 50)

      const userContext: UserContext = { userId: 'user1' };
      
      const result1 = await featureFlagService.isEnabled('test-flag', userContext);
      expect(result1).toBe(true);

      const result2 = await featureFlagService.isEnabled('test-flag', userContext);
      expect(result2).toBe(false);

      // Restore original function
      (featureFlagService as any).hashUser = originalHashUser;
    });
  });
});  d
escribe('user targeting', () => {
    it('should target specific user IDs', async () => {
      const flag: FeatureFlag = {
        name: 'test-flag',
        enabled: true,
        description: 'Test flag',
        rolloutPercentage: 100,
        targeting: {
          userIds: ['user1', 'user2'],
        },
        metadata: {},
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      mockConfigManager.get.mockResolvedValue(flag);

      const targetedUser: UserContext = { userId: 'user1' };
      const nonTargetedUser: UserContext = { userId: 'user3' };

      const result1 = await featureFlagService.isEnabled('test-flag', targetedUser);
      expect(result1).toBe(true);

      const result2 = await featureFlagService.isEnabled('test-flag', nonTargetedUser);
      expect(result2).toBe(false);
    });

    it('should target users by attributes', async () => {
      const flag: FeatureFlag = {
        name: 'test-flag',
        enabled: true,
        description: 'Test flag',
        rolloutPercentage: 100,
        targeting: {
          attributes: {
            tier: ['premium', 'enterprise'],
          },
        },
        metadata: {},
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      mockConfigManager.get.mockResolvedValue(flag);

      const premiumUser: UserContext = {
        userId: 'user1',
        attributes: { tier: 'premium' },
      };

      const freeUser: UserContext = {
        userId: 'user2',
        attributes: { tier: 'free' },
      };

      const result1 = await featureFlagService.isEnabled('test-flag', premiumUser);
      expect(result1).toBe(true);

      const result2 = await featureFlagService.isEnabled('test-flag', freeUser);
      expect(result2).toBe(false);
    });

    it('should target users by segments', async () => {
      const flag: FeatureFlag = {
        name: 'test-flag',
        enabled: true,
        description: 'Test flag',
        rolloutPercentage: 100,
        targeting: {
          segments: ['beta-users', 'power-users'],
        },
        metadata: {},
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      mockConfigManager.get.mockResolvedValue(flag);

      const betaUser: UserContext = {
        userId: 'user1',
        segments: ['beta-users'],
      };

      const regularUser: UserContext = {
        userId: 'user2',
        segments: ['regular-users'],
      };

      const result1 = await featureFlagService.isEnabled('test-flag', betaUser);
      expect(result1).toBe(true);

      const result2 = await featureFlagService.isEnabled('test-flag', regularUser);
      expect(result2).toBe(false);
    });
  });

  describe('getVariant', () => {
    it('should return control for disabled flag', async () => {
      const flag: FeatureFlag = {
        name: 'test-flag',
        enabled: false,
        description: 'Test flag',
        rolloutPercentage: 100,
        targeting: {},
        metadata: {},
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      mockConfigManager.get.mockResolvedValue(flag);

      const result = await featureFlagService.getVariant('test-flag');
      expect(result).toBe('control');
    });

    it('should return treatment for enabled flag without variants', async () => {
      const flag: FeatureFlag = {
        name: 'test-flag',
        enabled: true,
        description: 'Test flag',
        rolloutPercentage: 100,
        targeting: {},
        metadata: {},
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      mockConfigManager.get.mockResolvedValue(flag);

      const result = await featureFlagService.getVariant('test-flag');
      expect(result).toBe('treatment');
    });

    it('should select variant based on weight distribution', async () => {
      const flag: FeatureFlag = {
        name: 'test-flag',
        enabled: true,
        description: 'Test flag',
        rolloutPercentage: 100,
        targeting: {},
        variants: [
          { name: 'variant-a', weight: 30 },
          { name: 'variant-b', weight: 70 },
        ],
        metadata: {},
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      };

      mockConfigManager.get.mockResolvedValue(flag);

      // Mock hash function to return predictable values
      const originalHashUser = (featureFlagService as any).hashUser;
      (featureFlagService as any).hashUser = jest.fn()
        .mockReturnValueOnce(25) // Should select variant-a (25 <= 30)
        .mockReturnValueOnce(50); // Should select variant-b (50 <= 100, but > 30)

      const userContext: UserContext = { userId: 'user1' };
      
      const result1 = await featureFlagService.getVariant('test-flag', userContext);
      expect(result1).toBe('variant-a');

      const result2 = await featureFlagService.getVariant('test-flag', userContext);
      expect(result2).toBe('variant-b');

      // Restore original function
      (featureFlagService as any).hashUser = originalHashUser;
    });
  });

  describe('createFlag', () => {
    it('should create a new feature flag', async () => {
      mockConfigManager.set.mockResolvedValue(undefined);

      const flagRequest = {
        name: 'new-flag',
        enabled: true,
        description: 'New test flag',
        rolloutPercentage: 50,
      };

      await featureFlagService.createFlag(flagRequest);

      expect(mockConfigManager.set).toHaveBeenCalledWith(
        'feature-flags/new-flag',
        expect.objectContaining({
          name: 'new-flag',
          enabled: true,
          description: 'New test flag',
          rolloutPercentage: 50,
        }),
        { description: 'Feature flag: New test flag' }
      );
    });
  });

  describe('hash function', () => {
    it('should produce consistent hash for same input', () => {
      const hashUser = (featureFlagService as any).hashUser;
      
      const hash1 = hashUser('test-flag', 'user123');
      const hash2 = hashUser('test-flag', 'user123');
      
      expect(hash1).toBe(hash2);
      expect(hash1).toBeGreaterThanOrEqual(0);
      expect(hash1).toBeLessThan(100);
    });

    it('should produce different hashes for different inputs', () => {
      const hashUser = (featureFlagService as any).hashUser;
      
      const hash1 = hashUser('test-flag', 'user1');
      const hash2 = hashUser('test-flag', 'user2');
      const hash3 = hashUser('different-flag', 'user1');
      
      // While not guaranteed, it's very unlikely these would be equal
      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });
  });
});