import { ConfigurationManager } from './configuration-manager';
import { Logger } from '../../shared/utils';

/**
 * Feature flag service with user targeting, percentage rollouts, and A/B testing
 * Provides controlled feature rollouts and experimentation capabilities
 */
export class FeatureFlagService {
  private static instance: FeatureFlagService;
  private configManager: ConfigurationManager;
  private logger: Logger;
  private flagCache: Map<string, FeatureFlag> = new Map();
  private userCache: Map<string, UserContext> = new Map();
  private experimentCache: Map<string, Experiment> = new Map();

  // Cache settings
  private static readonly CACHE_TTL_MS = 300000; // 5 minutes
  private static readonly USER_CACHE_TTL_MS = 3600000; // 1 hour

  private constructor() {
    this.logger = new Logger('FeatureFlagService');
    this.configManager = ConfigurationManager.getInstance();
  }

  static getInstance(): FeatureFlagService {
    if (!FeatureFlagService.instance) {
      FeatureFlagService.instance = new FeatureFlagService();
    }
    return FeatureFlagService.instance;
  }

  /**
   * Initialize feature flag service
   */
  async initialize(): Promise<void> {
    try {
      await this.loadAllFlags();
      await this.loadAllExperiments();
      
      this.logger.info('Feature flag service initialized', {
        flags: this.flagCache.size,
        experiments: this.experimentCache.size,
      });
    } catch (error) {
      this.logger.error('Failed to initialize feature flag service', error as Error);
      throw error;
    }
  }

  /**
   * Check if a feature flag is enabled for a user
   */
  async isEnabled(flagName: string, userContext?: UserContext): Promise<boolean> {
    try {
      const flag = await this.getFlag(flagName);
      if (!flag) {
        this.logger.debug('Feature flag not found, defaulting to false', { flagName });
        return false;
      }

      if (!flag.enabled) {
        return false;
      }

      // Check user targeting
      if (userContext && !this.isUserTargeted(flag, userContext)) {
        return false;
      }

      // Check percentage rollout
      if (flag.rolloutPercentage < 100) {
        const hash = this.hashUser(flagName, userContext?.userId || 'anonymous');
        if (hash > flag.rolloutPercentage) {
          return false;
        }
      }

      // Check environment targeting
      if (flag.environments && flag.environments.length > 0) {
        const currentEnv = process.env.NODE_ENV || 'development';
        if (!flag.environments.includes(currentEnv)) {
          return false;
        }
      }

      // Check time-based targeting
      if (flag.schedule) {
        const now = new Date();
        if (flag.schedule.startDate && now < new Date(flag.schedule.startDate)) {
          return false;
        }
        if (flag.schedule.endDate && now > new Date(flag.schedule.endDate)) {
          return false;
        }
      }

      this.logger.debug('Feature flag evaluated', {
        flagName,
        enabled: true,
        userId: userContext?.userId,
        rolloutPercentage: flag.rolloutPercentage,
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to evaluate feature flag', error as Error, { flagName });
      return false; // Fail closed
    }
  }

  /**
   * Get feature flag variant for A/B testing
   */
  async getVariant(flagName: string, userContext?: UserContext): Promise<string> {
    try {
      const flag = await this.getFlag(flagName);
      if (!flag || !flag.enabled) {
        return 'control';
      }

      // Check if user is in the rollout
      const isEnabled = await this.isEnabled(flagName, userContext);
      if (!isEnabled) {
        return 'control';
      }

      // If no variants defined, return 'treatment'
      if (!flag.variants || flag.variants.length === 0) {
        return 'treatment';
      }

      // Select variant based on user hash
      const hash = this.hashUser(`${flagName}_variant`, userContext?.userId || 'anonymous');
      let cumulativeWeight = 0;

      for (const variant of flag.variants) {
        cumulativeWeight += variant.weight;
        if (hash <= cumulativeWeight) {
          this.logger.debug('Feature flag variant selected', {
            flagName,
            variant: variant.name,
            userId: userContext?.userId,
            weight: variant.weight,
          });
          return variant.name;
        }
      }

      // Fallback to first variant
      return flag.variants[0].name;
    } catch (error) {
      this.logger.error('Failed to get feature flag variant', error as Error, { flagName });
      return 'control';
    }
  }

  /**
   * Get experiment assignment for A/B testing
   */
  async getExperimentAssignment(experimentName: string, userContext?: UserContext): Promise<ExperimentAssignment> {
    try {
      const experiment = await this.getExperiment(experimentName);
      if (!experiment || !experiment.enabled) {
        return {
          experimentName,
          variant: 'control',
          inExperiment: false,
        };
      }

      // Check if user is eligible for the experiment
      if (userContext && !this.isUserEligibleForExperiment(experiment, userContext)) {
        return {
          experimentName,
          variant: 'control',
          inExperiment: false,
        };
      }

      // Check traffic allocation
      const hash = this.hashUser(experimentName, userContext?.userId || 'anonymous');
      if (hash > experiment.trafficAllocation) {
        return {
          experimentName,
          variant: 'control',
          inExperiment: false,
        };
      }

      // Select variant
      const variant = this.selectExperimentVariant(experiment, userContext);

      this.logger.debug('Experiment assignment', {
        experimentName,
        variant,
        userId: userContext?.userId,
        trafficAllocation: experiment.trafficAllocation,
      });

      return {
        experimentName,
        variant,
        inExperiment: true,
        metadata: experiment.metadata,
      };
    } catch (error) {
      this.logger.error('Failed to get experiment assignment', error as Error, { experimentName });
      return {
        experimentName,
        variant: 'control',
        inExperiment: false,
      };
    }
  }

  /**
   * Create or update a feature flag
   */
  async createFlag(flag: CreateFeatureFlagRequest): Promise<void> {
    try {
      const featureFlag: FeatureFlag = {
        name: flag.name,
        enabled: flag.enabled,
        description: flag.description,
        rolloutPercentage: flag.rolloutPercentage || 100,
        targeting: flag.targeting || {},
        variants: flag.variants || [],
        environments: flag.environments,
        schedule: flag.schedule,
        metadata: flag.metadata || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await this.configManager.set(`feature-flags/${flag.name}`, featureFlag, {
        description: `Feature flag: ${flag.description}`,
      });

      // Update cache
      this.flagCache.set(flag.name, featureFlag);

      this.logger.info('Feature flag created/updated', {
        name: flag.name,
        enabled: flag.enabled,
        rolloutPercentage: flag.rolloutPercentage,
      });
    } catch (error) {
      this.logger.error('Failed to create feature flag', error as Error, { flagName: flag.name });
      throw error;
    }
  }

  /**
   * Create or update an experiment
   */
  async createExperiment(experiment: CreateExperimentRequest): Promise<void> {
    try {
      const exp: Experiment = {
        name: experiment.name,
        enabled: experiment.enabled,
        description: experiment.description,
        trafficAllocation: experiment.trafficAllocation,
        variants: experiment.variants,
        targeting: experiment.targeting || {},
        schedule: experiment.schedule,
        metadata: experiment.metadata || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await this.configManager.set(`experiments/${experiment.name}`, exp, {
        description: `Experiment: ${experiment.description}`,
      });

      // Update cache
      this.experimentCache.set(experiment.name, exp);

      this.logger.info('Experiment created/updated', {
        name: experiment.name,
        enabled: experiment.enabled,
        trafficAllocation: experiment.trafficAllocation,
        variants: experiment.variants.length,
      });
    } catch (error) {
      this.logger.error('Failed to create experiment', error as Error, { experimentName: experiment.name });
      throw error;
    }
  }

  /**
   * Delete a feature flag
   */
  async deleteFlag(flagName: string): Promise<void> {
    try {
      await this.configManager.delete(`feature-flags/${flagName}`);
      this.flagCache.delete(flagName);
      
      this.logger.info('Feature flag deleted', { flagName });
    } catch (error) {
      this.logger.error('Failed to delete feature flag', error as Error, { flagName });
      throw error;
    }
  }

  /**
   * Delete an experiment
   */
  async deleteExperiment(experimentName: string): Promise<void> {
    try {
      await this.configManager.delete(`experiments/${experimentName}`);
      this.experimentCache.delete(experimentName);
      
      this.logger.info('Experiment deleted', { experimentName });
    } catch (error) {
      this.logger.error('Failed to delete experiment', error as Error, { experimentName });
      throw error;
    }
  }

  /**
   * Get all feature flags
   */
  async getAllFlags(): Promise<FeatureFlag[]> {
    return Array.from(this.flagCache.values());
  }

  /**
   * Get all experiments
   */
  async getAllExperiments(): Promise<Experiment[]> {
    return Array.from(this.experimentCache.values());
  }

  /**
   * Get feature flag statistics
   */
  getStatistics(): FeatureFlagStatistics {
    const flags = Array.from(this.flagCache.values());
    const experiments = Array.from(this.experimentCache.values());

    return {
      totalFlags: flags.length,
      enabledFlags: flags.filter(f => f.enabled).length,
      totalExperiments: experiments.length,
      activeExperiments: experiments.filter(e => e.enabled).length,
      flagsWithTargeting: flags.filter(f => Object.keys(f.targeting).length > 0).length,
      flagsWithVariants: flags.filter(f => f.variants && f.variants.length > 0).length,
      averageRolloutPercentage: flags.length > 0 
        ? flags.reduce((sum, f) => sum + f.rolloutPercentage, 0) / flags.length 
        : 0,
    };
  }

  // Private methods

  private async getFlag(flagName: string): Promise<FeatureFlag | null> {
    // Check cache first
    const cached = this.flagCache.get(flagName);
    if (cached) {
      return cached;
    }

    // Load from configuration
    try {
      const flag = await this.configManager.get<FeatureFlag>(`feature-flags/${flagName}`);
      if (flag) {
        this.flagCache.set(flagName, flag);
        return flag;
      }
    } catch (error) {
      this.logger.debug('Feature flag not found in configuration', { flagName });
    }

    return null;
  }

  private async getExperiment(experimentName: string): Promise<Experiment | null> {
    // Check cache first
    const cached = this.experimentCache.get(experimentName);
    if (cached) {
      return cached;
    }

    // Load from configuration
    try {
      const experiment = await this.configManager.get<Experiment>(`experiments/${experimentName}`);
      if (experiment) {
        this.experimentCache.set(experimentName, experiment);
        return experiment;
      }
    } catch (error) {
      this.logger.debug('Experiment not found in configuration', { experimentName });
    }

    return null;
  }

  private async loadAllFlags(): Promise<void> {
    try {
      const allConfigs = await this.configManager.getAll('feature-flags');
      
      for (const [key, value] of Object.entries(allConfigs)) {
        const flagName = key.replace('feature-flags/', '');
        this.flagCache.set(flagName, value as FeatureFlag);
      }
    } catch (error) {
      this.logger.warn('Failed to load feature flags', { error: (error as Error).message });
    }
  }

  private async loadAllExperiments(): Promise<void> {
    try {
      const allConfigs = await this.configManager.getAll('experiments');
      
      for (const [key, value] of Object.entries(allConfigs)) {
        const experimentName = key.replace('experiments/', '');
        this.experimentCache.set(experimentName, value as Experiment);
      }
    } catch (error) {
      this.logger.warn('Failed to load experiments', { error: (error as Error).message });
    }
  }

  private isUserTargeted(flag: FeatureFlag, userContext: UserContext): boolean {
    const targeting = flag.targeting;

    // Check user ID targeting
    if (targeting.userIds && targeting.userIds.length > 0) {
      if (!targeting.userIds.includes(userContext.userId)) {
        return false;
      }
    }

    // Check user attributes
    if (targeting.attributes) {
      for (const [key, values] of Object.entries(targeting.attributes)) {
        const userValue = userContext.attributes?.[key];
        if (!userValue || !values.includes(userValue)) {
          return false;
        }
      }
    }

    // Check user segments
    if (targeting.segments && targeting.segments.length > 0) {
      const userSegments = userContext.segments || [];
      const hasMatchingSegment = targeting.segments.some(segment => 
        userSegments.includes(segment)
      );
      if (!hasMatchingSegment) {
        return false;
      }
    }

    return true;
  }

  private isUserEligibleForExperiment(experiment: Experiment, userContext: UserContext): boolean {
    const targeting = experiment.targeting;

    // Check user ID targeting
    if (targeting.userIds && targeting.userIds.length > 0) {
      if (!targeting.userIds.includes(userContext.userId)) {
        return false;
      }
    }

    // Check user attributes
    if (targeting.attributes) {
      for (const [key, values] of Object.entries(targeting.attributes)) {
        const userValue = userContext.attributes?.[key];
        if (!userValue || !values.includes(userValue)) {
          return false;
        }
      }
    }

    // Check user segments
    if (targeting.segments && targeting.segments.length > 0) {
      const userSegments = userContext.segments || [];
      const hasMatchingSegment = targeting.segments.some(segment => 
        userSegments.includes(segment)
      );
      if (!hasMatchingSegment) {
        return false;
      }
    }

    return true;
  }

  private selectExperimentVariant(experiment: Experiment, userContext?: UserContext): string {
    const hash = this.hashUser(`${experiment.name}_variant`, userContext?.userId || 'anonymous');
    let cumulativeWeight = 0;

    for (const variant of experiment.variants) {
      cumulativeWeight += variant.weight;
      if (hash <= cumulativeWeight) {
        return variant.name;
      }
    }

    // Fallback to first variant
    return experiment.variants[0].name;
  }

  private hashUser(key: string, userId: string): number {
    // Simple hash function for consistent user bucketing
    let hash = 0;
    const input = `${key}:${userId}`;
    
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Convert to percentage (0-100)
    return Math.abs(hash) % 100;
  }
}

// Interfaces

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description: string;
  rolloutPercentage: number;
  targeting: Targeting;
  variants?: Variant[];
  environments?: string[];
  schedule?: Schedule;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface Experiment {
  name: string;
  enabled: boolean;
  description: string;
  trafficAllocation: number; // Percentage of users to include in experiment
  variants: ExperimentVariant[];
  targeting: Targeting;
  schedule?: Schedule;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface Targeting {
  userIds?: string[];
  attributes?: Record<string, string[]>;
  segments?: string[];
}

export interface Variant {
  name: string;
  weight: number; // Percentage weight for this variant
  payload?: Record<string, any>;
}

export interface ExperimentVariant {
  name: string;
  weight: number; // Percentage weight for this variant
  payload?: Record<string, any>;
}

export interface Schedule {
  startDate?: string;
  endDate?: string;
}

export interface UserContext {
  userId: string;
  attributes?: Record<string, string>;
  segments?: string[];
}

export interface ExperimentAssignment {
  experimentName: string;
  variant: string;
  inExperiment: boolean;
  metadata?: Record<string, any>;
}

export interface CreateFeatureFlagRequest {
  name: string;
  enabled: boolean;
  description: string;
  rolloutPercentage?: number;
  targeting?: Targeting;
  variants?: Variant[];
  environments?: string[];
  schedule?: Schedule;
  metadata?: Record<string, any>;
}

export interface CreateExperimentRequest {
  name: string;
  enabled: boolean;
  description: string;
  trafficAllocation: number;
  variants: ExperimentVariant[];
  targeting?: Targeting;
  schedule?: Schedule;
  metadata?: Record<string, any>;
}

export interface FeatureFlagStatistics {
  totalFlags: number;
  enabledFlags: number;
  totalExperiments: number;
  activeExperiments: number;
  flagsWithTargeting: number;
  flagsWithVariants: number;
  averageRolloutPercentage: number;
}