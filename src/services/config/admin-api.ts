import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ConfigService } from './config-service';
import { FeatureFlagService, CreateFeatureFlagRequest, CreateExperimentRequest } from './feature-flag-service';
import { Logger } from '../../shared/utils';
import { SecurityLogger } from '../../shared/utils/security-logger';

/**
 * Admin API for configuration and feature flag management
 * Provides secure endpoints for managing system configuration
 */
export class AdminApi {
  private static instance: AdminApi;
  private configService: ConfigService;
  private featureFlagService: FeatureFlagService;
  private logger: Logger;
  private securityLogger: SecurityLogger;

  private constructor() {
    this.logger = new Logger('AdminApi');
    this.securityLogger = SecurityLogger.getInstance();
    this.configService = ConfigService.getInstance();
    this.featureFlagService = FeatureFlagService.getInstance();
  }

  static getInstance(): AdminApi {
    if (!AdminApi.instance) {
      AdminApi.instance = new AdminApi();
    }
    return AdminApi.instance;
  }

  /**
   * Handle admin API requests
   */
  async handleRequest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const correlationId = event.requestContext.requestId;
    const userId = this.extractUserId(event);
    const sourceIp = event.requestContext.identity?.sourceIp;
    const userAgent = event.headers['User-Agent'];

    try {
      // Verify admin permissions
      if (!await this.verifyAdminPermissions(event)) {
        this.securityLogger.logAuthenticationAttempt(
          correlationId,
          userId,
          null,
          false,
          sourceIp,
          userAgent,
          'Insufficient admin permissions'
        );

        return this.createErrorResponse(403, 'Insufficient permissions', correlationId);
      }

      const { httpMethod, path } = event;
      const pathParts = path.split('/').filter(p => p);

      // Route to appropriate handler
      if (pathParts[2] === 'config') {
        return await this.handleConfigRequest(event, correlationId, userId);
      } else if (pathParts[2] === 'feature-flags') {
        return await this.handleFeatureFlagRequest(event, correlationId, userId);
      } else if (pathParts[2] === 'experiments') {
        return await this.handleExperimentRequest(event, correlationId, userId);
      } else if (pathParts[2] === 'health') {
        return await this.handleHealthRequest(correlationId);
      } else {
        return this.createErrorResponse(404, 'Admin endpoint not found', correlationId);
      }

    } catch (error) {
      this.logger.error('Admin API request failed', error as Error, {
        correlationId,
        userId,
        path: event.path,
        method: event.httpMethod,
      });

      return this.createErrorResponse(500, 'Internal server error', correlationId);
    }
  }

  // Configuration management endpoints

  private async handleConfigRequest(
    event: APIGatewayProxyEvent,
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    const { httpMethod, path } = event;
    const pathParts = path.split('/').filter(p => p);

    switch (httpMethod) {
      case 'GET':
        if (pathParts.length === 3) {
          // GET /api/v1/admin/config - Get all configurations
          return await this.getAllConfigurations(correlationId);
        } else if (pathParts.length === 4) {
          // GET /api/v1/admin/config/{key} - Get specific configuration
          const key = decodeURIComponent(pathParts[3]);
          return await this.getConfiguration(key, correlationId);
        }
        break;

      case 'PUT':
        if (pathParts.length === 4) {
          // PUT /api/v1/admin/config/{key} - Update configuration
          const key = decodeURIComponent(pathParts[3]);
          return await this.updateConfiguration(key, event.body, correlationId, userId);
        }
        break;

      case 'DELETE':
        if (pathParts.length === 4) {
          // DELETE /api/v1/admin/config/{key} - Delete configuration
          const key = decodeURIComponent(pathParts[3]);
          return await this.deleteConfiguration(key, correlationId, userId);
        }
        break;

      case 'POST':
        if (pathParts.length === 4 && pathParts[3] === 'validate') {
          // POST /api/v1/admin/config/validate - Validate configurations
          return await this.validateConfigurations(correlationId);
        } else if (pathParts.length === 4 && pathParts[3] === 'refresh') {
          // POST /api/v1/admin/config/refresh - Refresh configurations
          return await this.refreshConfigurations(correlationId, userId);
        }
        break;
    }

    return this.createErrorResponse(404, 'Configuration endpoint not found', correlationId);
  }

  // Feature flag management endpoints

  private async handleFeatureFlagRequest(
    event: APIGatewayProxyEvent,
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    const { httpMethod, path } = event;
    const pathParts = path.split('/').filter(p => p);

    switch (httpMethod) {
      case 'GET':
        if (pathParts.length === 3) {
          // GET /api/v1/admin/feature-flags - Get all feature flags
          return await this.getAllFeatureFlags(correlationId);
        } else if (pathParts.length === 4) {
          // GET /api/v1/admin/feature-flags/{name} - Get specific feature flag
          const name = pathParts[3];
          return await this.getFeatureFlag(name, correlationId);
        }
        break;

      case 'POST':
        if (pathParts.length === 3) {
          // POST /api/v1/admin/feature-flags - Create feature flag
          return await this.createFeatureFlag(event.body, correlationId, userId);
        }
        break;

      case 'PUT':
        if (pathParts.length === 4) {
          // PUT /api/v1/admin/feature-flags/{name} - Update feature flag
          const name = pathParts[3];
          return await this.updateFeatureFlag(name, event.body, correlationId, userId);
        }
        break;

      case 'DELETE':
        if (pathParts.length === 4) {
          // DELETE /api/v1/admin/feature-flags/{name} - Delete feature flag
          const name = pathParts[3];
          return await this.deleteFeatureFlag(name, correlationId, userId);
        }
        break;
    }

    return this.createErrorResponse(404, 'Feature flag endpoint not found', correlationId);
  }

  // Experiment management endpoints

  private async handleExperimentRequest(
    event: APIGatewayProxyEvent,
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    const { httpMethod, path } = event;
    const pathParts = path.split('/').filter(p => p);

    switch (httpMethod) {
      case 'GET':
        if (pathParts.length === 3) {
          // GET /api/v1/admin/experiments - Get all experiments
          return await this.getAllExperiments(correlationId);
        } else if (pathParts.length === 4) {
          // GET /api/v1/admin/experiments/{name} - Get specific experiment
          const name = pathParts[3];
          return await this.getExperiment(name, correlationId);
        }
        break;

      case 'POST':
        if (pathParts.length === 3) {
          // POST /api/v1/admin/experiments - Create experiment
          return await this.createExperiment(event.body, correlationId, userId);
        }
        break;

      case 'PUT':
        if (pathParts.length === 4) {
          // PUT /api/v1/admin/experiments/{name} - Update experiment
          const name = pathParts[3];
          return await this.updateExperiment(name, event.body, correlationId, userId);
        }
        break;

      case 'DELETE':
        if (pathParts.length === 4) {
          // DELETE /api/v1/admin/experiments/{name} - Delete experiment
          const name = pathParts[3];
          return await this.deleteExperiment(name, correlationId, userId);
        }
        break;
    }

    return this.createErrorResponse(404, 'Experiment endpoint not found', correlationId);
  }

  // Health and statistics endpoints

  private async handleHealthRequest(correlationId: string): Promise<APIGatewayProxyResult> {
    try {
      const configStats = this.configService.getStatistics();
      const featureFlagStats = this.featureFlagService.getStatistics();

      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        configuration: configStats,
        featureFlags: featureFlagStats,
        correlationId,
      };

      return this.createSuccessResponse(health, correlationId);
    } catch (error) {
      this.logger.error('Admin health check failed', error as Error);
      return this.createErrorResponse(500, 'Health check failed', correlationId);
    }
  }

  // Configuration implementation methods

  private async getAllConfigurations(correlationId: string): Promise<APIGatewayProxyResult> {
    try {
      const configs = {
        api: await this.configService.getApiConfig(),
        auth: await this.configService.getAuthConfig(),
        rateLimit: await this.configService.getRateLimitConfig(),
        providers: await this.configService.getProviderConfig(),
        routing: await this.configService.getRoutingConfig(),
        cache: await this.configService.getCacheConfig(),
        mcp: await this.configService.getMcpConfig(),
        observability: await this.configService.getObservabilityConfig(),
        security: await this.configService.getSecurityConfig(),
        cost: await this.configService.getCostConfig(),
        batching: await this.configService.getBatchingConfig(),
        features: await this.configService.getFeatureFlags(),
      };

      return this.createSuccessResponse(configs, correlationId);
    } catch (error) {
      this.logger.error('Failed to get all configurations', error as Error);
      return this.createErrorResponse(500, 'Failed to retrieve configurations', correlationId);
    }
  }

  private async getConfiguration(key: string, correlationId: string): Promise<APIGatewayProxyResult> {
    try {
      // Map key to appropriate config getter
      let config;
      switch (key) {
        case 'api':
          config = await this.configService.getApiConfig();
          break;
        case 'auth':
          config = await this.configService.getAuthConfig();
          break;
        case 'rate-limit':
          config = await this.configService.getRateLimitConfig();
          break;
        case 'providers':
          config = await this.configService.getProviderConfig();
          break;
        case 'routing':
          config = await this.configService.getRoutingConfig();
          break;
        case 'cache':
          config = await this.configService.getCacheConfig();
          break;
        case 'mcp':
          config = await this.configService.getMcpConfig();
          break;
        case 'observability':
          config = await this.configService.getObservabilityConfig();
          break;
        case 'security':
          config = await this.configService.getSecurityConfig();
          break;
        case 'cost':
          config = await this.configService.getCostConfig();
          break;
        case 'batching':
          config = await this.configService.getBatchingConfig();
          break;
        case 'features':
          config = await this.configService.getFeatureFlags();
          break;
        default:
          return this.createErrorResponse(404, `Configuration '${key}' not found`, correlationId);
      }

      return this.createSuccessResponse(config, correlationId);
    } catch (error) {
      this.logger.error('Failed to get configuration', error as Error, { key });
      return this.createErrorResponse(500, 'Failed to retrieve configuration', correlationId);
    }
  }

  private async updateConfiguration(
    key: string,
    body: string | null,
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    try {
      if (!body) {
        return this.createErrorResponse(400, 'Request body is required', correlationId);
      }

      const updateData = JSON.parse(body);
      await this.configService.updateConfig(key, updateData.value);

      // Log configuration change
      this.securityLogger.logSecurityConfigChange(
        correlationId,
        userId || 'unknown',
        key,
        null, // We don't log old values for security
        'updated',
        undefined
      );

      return this.createSuccessResponse(
        { message: 'Configuration updated successfully', key },
        correlationId
      );
    } catch (error) {
      this.logger.error('Failed to update configuration', error as Error, { key });
      return this.createErrorResponse(500, 'Failed to update configuration', correlationId);
    }
  }

  private async deleteConfiguration(
    key: string,
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    try {
      // Note: This would need to be implemented in ConfigService
      // For now, return not implemented
      return this.createErrorResponse(501, 'Configuration deletion not implemented', correlationId);
    } catch (error) {
      this.logger.error('Failed to delete configuration', error as Error, { key });
      return this.createErrorResponse(500, 'Failed to delete configuration', correlationId);
    }
  }

  private async validateConfigurations(correlationId: string): Promise<APIGatewayProxyResult> {
    try {
      const validation = await this.configService.validateAllConfigurations();
      return this.createSuccessResponse(validation, correlationId);
    } catch (error) {
      this.logger.error('Failed to validate configurations', error as Error);
      return this.createErrorResponse(500, 'Failed to validate configurations', correlationId);
    }
  }

  private async refreshConfigurations(
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    try {
      await this.configService.refresh();

      // Log configuration refresh
      this.securityLogger.logSecurityConfigChange(
        correlationId,
        userId || 'unknown',
        'all',
        null,
        'refreshed',
        undefined
      );

      return this.createSuccessResponse(
        { message: 'Configurations refreshed successfully' },
        correlationId
      );
    } catch (error) {
      this.logger.error('Failed to refresh configurations', error as Error);
      return this.createErrorResponse(500, 'Failed to refresh configurations', correlationId);
    }
  }

  // Feature flag implementation methods

  private async getAllFeatureFlags(correlationId: string): Promise<APIGatewayProxyResult> {
    try {
      const flags = await this.featureFlagService.getAllFlags();
      return this.createSuccessResponse(flags, correlationId);
    } catch (error) {
      this.logger.error('Failed to get all feature flags', error as Error);
      return this.createErrorResponse(500, 'Failed to retrieve feature flags', correlationId);
    }
  }

  private async getFeatureFlag(name: string, correlationId: string): Promise<APIGatewayProxyResult> {
    try {
      const flags = await this.featureFlagService.getAllFlags();
      const flag = flags.find(f => f.name === name);
      
      if (!flag) {
        return this.createErrorResponse(404, `Feature flag '${name}' not found`, correlationId);
      }

      return this.createSuccessResponse(flag, correlationId);
    } catch (error) {
      this.logger.error('Failed to get feature flag', error as Error, { name });
      return this.createErrorResponse(500, 'Failed to retrieve feature flag', correlationId);
    }
  }

  private async createFeatureFlag(
    body: string | null,
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    try {
      if (!body) {
        return this.createErrorResponse(400, 'Request body is required', correlationId);
      }

      const flagData: CreateFeatureFlagRequest = JSON.parse(body);
      await this.featureFlagService.createFlag(flagData);

      // Log feature flag creation
      this.securityLogger.logSecurityConfigChange(
        correlationId,
        userId || 'unknown',
        `feature-flag:${flagData.name}`,
        null,
        flagData,
        undefined
      );

      return this.createSuccessResponse(
        { message: 'Feature flag created successfully', name: flagData.name },
        correlationId
      );
    } catch (error) {
      this.logger.error('Failed to create feature flag', error as Error);
      return this.createErrorResponse(500, 'Failed to create feature flag', correlationId);
    }
  }

  private async updateFeatureFlag(
    name: string,
    body: string | null,
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    try {
      if (!body) {
        return this.createErrorResponse(400, 'Request body is required', correlationId);
      }

      const flagData: CreateFeatureFlagRequest = JSON.parse(body);
      flagData.name = name; // Ensure name matches URL parameter
      
      await this.featureFlagService.createFlag(flagData);

      // Log feature flag update
      this.securityLogger.logSecurityConfigChange(
        correlationId,
        userId || 'unknown',
        `feature-flag:${name}`,
        null,
        flagData,
        undefined
      );

      return this.createSuccessResponse(
        { message: 'Feature flag updated successfully', name },
        correlationId
      );
    } catch (error) {
      this.logger.error('Failed to update feature flag', error as Error, { name });
      return this.createErrorResponse(500, 'Failed to update feature flag', correlationId);
    }
  }

  private async deleteFeatureFlag(
    name: string,
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    try {
      await this.featureFlagService.deleteFlag(name);

      // Log feature flag deletion
      this.securityLogger.logSecurityConfigChange(
        correlationId,
        userId || 'unknown',
        `feature-flag:${name}`,
        null,
        'deleted',
        undefined
      );

      return this.createSuccessResponse(
        { message: 'Feature flag deleted successfully', name },
        correlationId
      );
    } catch (error) {
      this.logger.error('Failed to delete feature flag', error as Error, { name });
      return this.createErrorResponse(500, 'Failed to delete feature flag', correlationId);
    }
  }

  // Experiment implementation methods

  private async getAllExperiments(correlationId: string): Promise<APIGatewayProxyResult> {
    try {
      const experiments = await this.featureFlagService.getAllExperiments();
      return this.createSuccessResponse(experiments, correlationId);
    } catch (error) {
      this.logger.error('Failed to get all experiments', error as Error);
      return this.createErrorResponse(500, 'Failed to retrieve experiments', correlationId);
    }
  }

  private async getExperiment(name: string, correlationId: string): Promise<APIGatewayProxyResult> {
    try {
      const experiments = await this.featureFlagService.getAllExperiments();
      const experiment = experiments.find(e => e.name === name);
      
      if (!experiment) {
        return this.createErrorResponse(404, `Experiment '${name}' not found`, correlationId);
      }

      return this.createSuccessResponse(experiment, correlationId);
    } catch (error) {
      this.logger.error('Failed to get experiment', error as Error, { name });
      return this.createErrorResponse(500, 'Failed to retrieve experiment', correlationId);
    }
  }

  private async createExperiment(
    body: string | null,
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    try {
      if (!body) {
        return this.createErrorResponse(400, 'Request body is required', correlationId);
      }

      const experimentData: CreateExperimentRequest = JSON.parse(body);
      await this.featureFlagService.createExperiment(experimentData);

      // Log experiment creation
      this.securityLogger.logSecurityConfigChange(
        correlationId,
        userId || 'unknown',
        `experiment:${experimentData.name}`,
        null,
        experimentData,
        undefined
      );

      return this.createSuccessResponse(
        { message: 'Experiment created successfully', name: experimentData.name },
        correlationId
      );
    } catch (error) {
      this.logger.error('Failed to create experiment', error as Error);
      return this.createErrorResponse(500, 'Failed to create experiment', correlationId);
    }
  }

  private async updateExperiment(
    name: string,
    body: string | null,
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    try {
      if (!body) {
        return this.createErrorResponse(400, 'Request body is required', correlationId);
      }

      const experimentData: CreateExperimentRequest = JSON.parse(body);
      experimentData.name = name; // Ensure name matches URL parameter
      
      await this.featureFlagService.createExperiment(experimentData);

      // Log experiment update
      this.securityLogger.logSecurityConfigChange(
        correlationId,
        userId || 'unknown',
        `experiment:${name}`,
        null,
        experimentData,
        undefined
      );

      return this.createSuccessResponse(
        { message: 'Experiment updated successfully', name },
        correlationId
      );
    } catch (error) {
      this.logger.error('Failed to update experiment', error as Error, { name });
      return this.createErrorResponse(500, 'Failed to update experiment', correlationId);
    }
  }

  private async deleteExperiment(
    name: string,
    correlationId: string,
    userId?: string
  ): Promise<APIGatewayProxyResult> {
    try {
      await this.featureFlagService.deleteExperiment(name);

      // Log experiment deletion
      this.securityLogger.logSecurityConfigChange(
        correlationId,
        userId || 'unknown',
        `experiment:${name}`,
        null,
        'deleted',
        undefined
      );

      return this.createSuccessResponse(
        { message: 'Experiment deleted successfully', name },
        correlationId
      );
    } catch (error) {
      this.logger.error('Failed to delete experiment', error as Error, { name });
      return this.createErrorResponse(500, 'Failed to delete experiment', correlationId);
    }
  }

  // Utility methods

  private async verifyAdminPermissions(event: APIGatewayProxyEvent): Promise<boolean> {
    // In a real implementation, this would verify admin permissions
    // For now, check for admin API key or JWT token
    const adminApiKey = event.headers['X-Admin-API-Key'] || event.headers['x-admin-api-key'];
    const expectedAdminKey = process.env.ADMIN_API_KEY;

    if (adminApiKey && expectedAdminKey && adminApiKey === expectedAdminKey) {
      return true;
    }

    // Could also check JWT tokens with admin role
    // const authHeader = event.headers['Authorization'];
    // if (authHeader && authHeader.startsWith('Bearer ')) {
    //   const token = authHeader.substring(7);
    //   // Verify JWT and check for admin role
    // }

    return false;
  }

  private extractUserId(event: APIGatewayProxyEvent): string | undefined {
    // Extract user ID from JWT token or other auth mechanism
    const authHeader = event.headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // In a real implementation, decode JWT and extract user ID
      return 'admin-user'; // Placeholder
    }
    return undefined;
  }

  private createSuccessResponse(data: any, correlationId: string): APIGatewayProxyResult {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-API-Key',
      },
      body: JSON.stringify({
        success: true,
        data,
        correlationId,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  private createErrorResponse(
    statusCode: number,
    message: string,
    correlationId: string
  ): APIGatewayProxyResult {
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-API-Key',
      },
      body: JSON.stringify({
        success: false,
        error: {
          message,
          statusCode,
        },
        correlationId,
        timestamp: new Date().toISOString(),
      }),
    };
  }
}