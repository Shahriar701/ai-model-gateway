import { SSM } from 'aws-sdk';
import { Logger } from '../../shared/utils';

/**
 * Configuration management service with AWS Parameter Store integration
 * Provides centralized configuration with hot reloading and validation
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private ssm: SSM;
  private logger: Logger;
  private configCache: Map<string, ConfigValue> = new Map();
  private refreshInterval?: NodeJS.Timeout;
  private environment: string;
  private parameterPrefix: string;

  // Configuration refresh settings
  private static readonly CACHE_TTL_MS = 300000; // 5 minutes
  private static readonly REFRESH_INTERVAL_MS = 60000; // 1 minute

  private constructor() {
    this.logger = new Logger('ConfigurationManager');
    this.ssm = new SSM({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.environment = process.env.NODE_ENV || 'development';
    this.parameterPrefix = `/ai-model-gateway/${this.environment}`;
  }

  static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  /**
   * Initialize configuration manager and start background refresh
   */
  async initialize(): Promise<void> {
    try {
      await this.loadAllConfigurations();
      this.startBackgroundRefresh();
      
      this.logger.info('Configuration manager initialized', {
        environment: this.environment,
        parameterPrefix: this.parameterPrefix,
        cachedConfigs: this.configCache.size,
      });
    } catch (error) {
      this.logger.error('Failed to initialize configuration manager', error as Error);
      throw error;
    }
  }

  /**
   * Get configuration value with type safety and default fallback
   */
  async get<T>(key: string, defaultValue?: T): Promise<T> {
    try {
      const cachedValue = this.getCachedValue(key);
      if (cachedValue !== null) {
        return this.parseValue<T>(cachedValue.value, defaultValue);
      }

      // Load from Parameter Store if not cached
      const value = await this.loadParameter(key);
      if (value !== null) {
        return this.parseValue<T>(value, defaultValue);
      }

      if (defaultValue !== undefined) {
        this.logger.debug('Using default value for configuration', { key, defaultValue });
        return defaultValue;
      }

      throw new Error(`Configuration key '${key}' not found and no default provided`);
    } catch (error) {
      this.logger.error('Failed to get configuration', error as Error, { key });
      
      if (defaultValue !== undefined) {
        this.logger.warn('Falling back to default value due to error', { key, defaultValue });
        return defaultValue;
      }
      
      throw error;
    }
  }

  /**
   * Get configuration value synchronously from cache
   */
  getSync<T>(key: string, defaultValue?: T): T {
    const cachedValue = this.getCachedValue(key);
    if (cachedValue !== null) {
      return this.parseValue<T>(cachedValue.value, defaultValue);
    }

    if (defaultValue !== undefined) {
      return defaultValue;
    }

    throw new Error(`Configuration key '${key}' not found in cache and no default provided`);
  }

  /**
   * Set configuration value in Parameter Store
   */
  async set(key: string, value: any, options?: SetConfigOptions): Promise<void> {
    try {
      const parameterName = this.getParameterName(key);
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

      const params: SSM.PutParameterRequest = {
        Name: parameterName,
        Value: stringValue,
        Type: options?.secure ? 'SecureString' : 'String',
        Overwrite: true,
        Description: options?.description,
        Tags: options?.tags ? Object.entries(options.tags).map(([Key, Value]) => ({ Key, Value })) : undefined,
      };

      await this.ssm.putParameter(params).promise();

      // Update cache
      this.configCache.set(key, {
        value: stringValue,
        lastUpdated: Date.now(),
        secure: options?.secure || false,
      });

      this.logger.info('Configuration updated', {
        key,
        secure: options?.secure || false,
        description: options?.description,
      });

    } catch (error) {
      this.logger.error('Failed to set configuration', error as Error, { key });
      throw error;
    }
  }

  /**
   * Delete configuration from Parameter Store
   */
  async delete(key: string): Promise<void> {
    try {
      const parameterName = this.getParameterName(key);
      
      await this.ssm.deleteParameter({
        Name: parameterName,
      }).promise();

      // Remove from cache
      this.configCache.delete(key);

      this.logger.info('Configuration deleted', { key });
    } catch (error) {
      this.logger.error('Failed to delete configuration', error as Error, { key });
      throw error;
    }
  }

  /**
   * Get all configurations with optional prefix filter
   */
  async getAll(prefix?: string): Promise<Record<string, any>> {
    try {
      const filterPrefix = prefix ? `${this.parameterPrefix}/${prefix}` : this.parameterPrefix;
      
      const params: SSM.GetParametersByPathRequest = {
        Path: filterPrefix,
        Recursive: true,
        WithDecryption: true,
        MaxResults: 50,
      };

      const result: Record<string, any> = {};
      let nextToken: string | undefined;

      do {
        if (nextToken) {
          params.NextToken = nextToken;
        }

        const response = await this.ssm.getParametersByPath(params).promise();
        
        if (response.Parameters) {
          for (const param of response.Parameters) {
            if (param.Name && param.Value) {
              const key = this.extractKeyFromParameterName(param.Name);
              result[key] = this.parseValue(param.Value);
              
              // Update cache
              this.configCache.set(key, {
                value: param.Value,
                lastUpdated: Date.now(),
                secure: param.Type === 'SecureString',
              });
            }
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);

      return result;
    } catch (error) {
      this.logger.error('Failed to get all configurations', error as Error, { prefix });
      throw error;
    }
  }

  /**
   * Validate configuration schema
   */
  validateConfiguration(config: Record<string, any>, schema: ConfigSchema): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [key, definition] of Object.entries(schema)) {
      const value = config[key];

      // Check required fields
      if (definition.required && (value === undefined || value === null)) {
        errors.push(`Required configuration '${key}' is missing`);
        continue;
      }

      // Skip validation if value is undefined and not required
      if (value === undefined) {
        continue;
      }

      // Type validation
      if (definition.type && typeof value !== definition.type) {
        errors.push(`Configuration '${key}' should be of type ${definition.type}, got ${typeof value}`);
      }

      // Range validation for numbers
      if (definition.type === 'number' && typeof value === 'number') {
        if (definition.min !== undefined && value < definition.min) {
          errors.push(`Configuration '${key}' should be >= ${definition.min}, got ${value}`);
        }
        if (definition.max !== undefined && value > definition.max) {
          errors.push(`Configuration '${key}' should be <= ${definition.max}, got ${value}`);
        }
      }

      // Enum validation
      if (definition.enum && !definition.enum.includes(value)) {
        errors.push(`Configuration '${key}' should be one of [${definition.enum.join(', ')}], got '${value}'`);
      }

      // Custom validation
      if (definition.validate) {
        const customResult = definition.validate(value);
        if (customResult !== true) {
          errors.push(`Configuration '${key}' validation failed: ${customResult}`);
        }
      }

      // Deprecation warnings
      if (definition.deprecated) {
        warnings.push(`Configuration '${key}' is deprecated: ${definition.deprecated}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get configuration statistics
   */
  getStatistics(): ConfigStatistics {
    const now = Date.now();
    const configs = Array.from(this.configCache.values());

    return {
      totalConfigurations: configs.length,
      secureConfigurations: configs.filter(c => c.secure).length,
      cacheHitRate: this.calculateCacheHitRate(),
      oldestConfiguration: configs.length > 0 
        ? Math.min(...configs.map(c => c.lastUpdated))
        : null,
      newestConfiguration: configs.length > 0
        ? Math.max(...configs.map(c => c.lastUpdated))
        : null,
      environment: this.environment,
      parameterPrefix: this.parameterPrefix,
    };
  }

  /**
   * Refresh all configurations from Parameter Store
   */
  async refresh(): Promise<void> {
    try {
      await this.loadAllConfigurations();
      this.logger.debug('Configuration cache refreshed', {
        cachedConfigs: this.configCache.size,
      });
    } catch (error) {
      this.logger.error('Failed to refresh configurations', error as Error);
    }
  }

  /**
   * Stop background refresh
   */
  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
      this.logger.info('Configuration manager stopped');
    }
  }

  // Private methods

  private getCachedValue(key: string): ConfigValue | null {
    const cached = this.configCache.get(key);
    if (!cached) {
      return null;
    }

    // Check if cache is expired
    if (Date.now() - cached.lastUpdated > ConfigurationManager.CACHE_TTL_MS) {
      this.configCache.delete(key);
      return null;
    }

    return cached;
  }

  private async loadParameter(key: string): Promise<string | null> {
    try {
      const parameterName = this.getParameterName(key);
      
      const response = await this.ssm.getParameter({
        Name: parameterName,
        WithDecryption: true,
      }).promise();

      if (response.Parameter?.Value) {
        // Cache the value
        this.configCache.set(key, {
          value: response.Parameter.Value,
          lastUpdated: Date.now(),
          secure: response.Parameter.Type === 'SecureString',
        });

        return response.Parameter.Value;
      }

      return null;
    } catch (error) {
      if ((error as any).code === 'ParameterNotFound') {
        return null;
      }
      throw error;
    }
  }

  private async loadAllConfigurations(): Promise<void> {
    try {
      await this.getAll();
    } catch (error) {
      this.logger.warn('Failed to load all configurations, continuing with cached values', {
        error: (error as Error).message,
      });
    }
  }

  private startBackgroundRefresh(): void {
    this.refreshInterval = setInterval(async () => {
      await this.refresh();
    }, ConfigurationManager.REFRESH_INTERVAL_MS);
  }

  private getParameterName(key: string): string {
    return `${this.parameterPrefix}/${key}`;
  }

  private extractKeyFromParameterName(parameterName: string): string {
    return parameterName.replace(`${this.parameterPrefix}/`, '');
  }

  private parseValue<T>(value: string, defaultValue?: T): T {
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(value);
      return parsed as T;
    } catch {
      // If JSON parsing fails, return as string (or convert based on default type)
      if (defaultValue !== undefined) {
        const defaultType = typeof defaultValue;
        
        switch (defaultType) {
          case 'number':
            const num = Number(value);
            return (isNaN(num) ? defaultValue : num) as T;
          case 'boolean':
            return (value.toLowerCase() === 'true') as T;
          default:
            return value as T;
        }
      }
      
      return value as T;
    }
  }

  private calculateCacheHitRate(): number {
    // This would be implemented with actual metrics in production
    return 0.95; // Placeholder
  }
}

/**
 * Configuration value interface
 */
interface ConfigValue {
  value: string;
  lastUpdated: number;
  secure: boolean;
}

/**
 * Configuration set options
 */
export interface SetConfigOptions {
  secure?: boolean;
  description?: string;
  tags?: Record<string, string>;
}

/**
 * Configuration schema definition
 */
export interface ConfigSchema {
  [key: string]: ConfigDefinition;
}

/**
 * Individual configuration definition
 */
export interface ConfigDefinition {
  type?: 'string' | 'number' | 'boolean' | 'object';
  required?: boolean;
  default?: any;
  min?: number;
  max?: number;
  enum?: any[];
  validate?: (value: any) => true | string;
  deprecated?: string;
  description?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Configuration statistics
 */
export interface ConfigStatistics {
  totalConfigurations: number;
  secureConfigurations: number;
  cacheHitRate: number;
  oldestConfiguration: number | null;
  newestConfiguration: number | null;
  environment: string;
  parameterPrefix: string;
}