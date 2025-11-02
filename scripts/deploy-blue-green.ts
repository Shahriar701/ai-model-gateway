#!/usr/bin/env ts-node

import * as AWS from 'aws-sdk';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface DeploymentConfig {
  environment: string;
  slot: 'blue' | 'green';
  deploymentId: string;
  region: string;
  accountId: string;
}

interface DeploymentMetadata {
  deploymentId: string;
  version: string;
  timestamp: string;
  gitCommit: string;
  slot: 'blue' | 'green';
  status: 'deploying' | 'deployed' | 'failed' | 'rolled_back';
}

class BlueGreenDeployment {
  private ssm: AWS.SSM;
  private cloudFormation: AWS.CloudFormation;
  private apiGateway: AWS.APIGateway;
  private config: DeploymentConfig;

  constructor(config: DeploymentConfig) {
    this.config = config;
    this.ssm = new AWS.SSM({ region: config.region });
    this.cloudFormation = new AWS.CloudFormation({ region: config.region });
    this.apiGateway = new AWS.APIGateway({ region: config.region });
  }

  async deploy(): Promise<void> {
    console.log(`Starting blue-green deployment for ${this.config.environment} environment`);
    console.log(`Deployment ID: ${this.config.deploymentId}`);
    console.log(`Target slot: ${this.config.slot}`);

    try {
      // 1. Store deployment metadata
      await this.storeDeploymentMetadata('deploying');

      // 2. Deploy infrastructure
      await this.deployInfrastructure();

      // 3. Deploy application code
      await this.deployApplication();

      // 4. Run health checks
      await this.runHealthChecks();

      // 5. Update deployment status
      await this.storeDeploymentMetadata('deployed');

      console.log('Blue-green deployment completed successfully');
    } catch (error) {
      console.error('Deployment failed:', error);
      await this.storeDeploymentMetadata('failed');
      throw error;
    }
  }

  private async storeDeploymentMetadata(status: DeploymentMetadata['status']): Promise<void> {
    const metadata: DeploymentMetadata = {
      deploymentId: this.config.deploymentId,
      version: this.getVersion(),
      timestamp: new Date().toISOString(),
      gitCommit: this.getGitCommit(),
      slot: this.config.slot,
      status,
    };

    const parameterName = `/ai-model-gateway/${this.config.environment}/deployment/${this.config.slot}/metadata`;
    
    await this.ssm.putParameter({
      Name: parameterName,
      Value: JSON.stringify(metadata),
      Type: 'String',
      Overwrite: true,
      Description: `Deployment metadata for ${this.config.slot} slot`,
    }).promise();

    console.log(`Stored deployment metadata: ${status}`);
  }

  private async deployInfrastructure(): Promise<void> {
    console.log('Deploying infrastructure...');

    const stackName = `ai-gateway-${this.config.environment}-${this.config.slot}`;
    
    // Set environment variables for CDK
    process.env.ENVIRONMENT = this.config.environment;
    process.env.DEPLOYMENT_SLOT = this.config.slot;
    process.env.DEPLOYMENT_ID = this.config.deploymentId;
    process.env.CDK_DEFAULT_ACCOUNT = this.config.accountId;
    process.env.CDK_DEFAULT_REGION = this.config.region;

    try {
      // Deploy main application stack
      execSync(`npx cdk deploy ${stackName} --require-approval never --outputs-file cdk-outputs.json`, {
        stdio: 'inherit',
        cwd: process.cwd(),
      });

      // Deploy observability stack
      execSync(`npx cdk deploy ${stackName}-observability --require-approval never`, {
        stdio: 'inherit',
        cwd: process.cwd(),
      });

      // Deploy security stack
      execSync(`npx cdk deploy ${stackName}-security --require-approval never`, {
        stdio: 'inherit',
        cwd: process.cwd(),
      });

      console.log('Infrastructure deployment completed');
    } catch (error) {
      console.error('Infrastructure deployment failed:', error);
      throw error;
    }
  }

  private async deployApplication(): Promise<void> {
    console.log('Deploying application code...');

    // Read CDK outputs to get resource information
    const outputs = this.readCdkOutputs();
    
    // Update Lambda function code if needed
    await this.updateLambdaFunctions(outputs);

    // Update configuration parameters
    await this.updateConfiguration();

    // Update feature flags for the new deployment
    await this.updateFeatureFlags();

    console.log('Application deployment completed');
  }

  private async updateLambdaFunctions(outputs: any): Promise<void> {
    // Lambda functions are updated through CDK deployment
    // This method can be used for additional Lambda-specific updates
    console.log('Lambda functions updated through CDK deployment');
  }

  private async updateConfiguration(): Promise<void> {
    console.log('Updating configuration parameters...');

    // Update deployment-specific configuration
    const configUpdates = [
      {
        name: `/ai-model-gateway/${this.config.environment}/deployment/current-slot`,
        value: this.config.slot,
      },
      {
        name: `/ai-model-gateway/${this.config.environment}/deployment/last-deployment-id`,
        value: this.config.deploymentId,
      },
      {
        name: `/ai-model-gateway/${this.config.environment}/deployment/last-deployment-time`,
        value: new Date().toISOString(),
      },
    ];

    for (const config of configUpdates) {
      await this.ssm.putParameter({
        Name: config.name,
        Value: config.value,
        Type: 'String',
        Overwrite: true,
      }).promise();
    }

    console.log('Configuration parameters updated');
  }

  private async updateFeatureFlags(): Promise<void> {
    console.log('Updating feature flags for deployment...');

    // Enable deployment-specific feature flags
    const deploymentFlags = [
      {
        name: `/ai-model-gateway/${this.config.environment}/feature-flags/deployment-${this.config.slot}`,
        value: JSON.stringify({
          name: `deployment-${this.config.slot}`,
          enabled: true,
          description: `Feature flag for ${this.config.slot} deployment slot`,
          rolloutPercentage: 0, // Start with 0% rollout
          targeting: {},
          metadata: {
            deploymentId: this.config.deploymentId,
            slot: this.config.slot,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      },
    ];

    for (const flag of deploymentFlags) {
      await this.ssm.putParameter({
        Name: flag.name,
        Value: flag.value,
        Type: 'String',
        Overwrite: true,
      }).promise();
    }

    console.log('Feature flags updated');
  }

  private async runHealthChecks(): Promise<void> {
    console.log('Running health checks...');

    const outputs = this.readCdkOutputs();
    const apiEndpoint = outputs[`ai-gateway-${this.config.environment}-${this.config.slot}`]?.ApiEndpoint;

    if (!apiEndpoint) {
      throw new Error('API endpoint not found in CDK outputs');
    }

    // Wait for API to be ready
    await this.waitForApiReady(apiEndpoint);

    // Run comprehensive health checks
    await this.runComprehensiveHealthChecks(apiEndpoint);

    console.log('Health checks completed successfully');
  }

  private async waitForApiReady(apiEndpoint: string, maxAttempts: number = 30): Promise<void> {
    console.log(`Waiting for API to be ready at ${apiEndpoint}`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(`${apiEndpoint}/api/v1/health`);
        if (response.ok) {
          console.log('API is ready');
          return;
        }
      } catch (error) {
        console.log(`Attempt ${attempt}/${maxAttempts}: API not ready yet`);
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
      }
    }

    throw new Error('API failed to become ready within timeout period');
  }

  private async runComprehensiveHealthChecks(apiEndpoint: string): Promise<void> {
    const healthChecks = [
      { name: 'Basic Health', path: '/api/v1/health' },
      { name: 'Detailed Health', path: '/api/v1/health/detailed' },
      { name: 'Metrics Health', path: '/api/v1/health/metrics' },
      { name: 'Incidents Health', path: '/api/v1/health/incidents' },
    ];

    for (const check of healthChecks) {
      console.log(`Running ${check.name} check...`);
      
      try {
        const response = await fetch(`${apiEndpoint}${check.path}`);
        
        if (!response.ok) {
          throw new Error(`${check.name} check failed with status ${response.status}`);
        }

        const data = await response.json();
        console.log(`${check.name} check passed`);
        
        // Log key metrics for monitoring
        if (check.name === 'Detailed Health' && data.system) {
          console.log(`System status: ${data.system.status}`);
          console.log(`Providers healthy: ${data.system.providers?.filter((p: any) => p.healthy).length || 0}`);
        }
      } catch (error) {
        console.error(`${check.name} check failed:`, error);
        throw error;
      }
    }
  }

  private readCdkOutputs(): any {
    const outputsPath = path.join(process.cwd(), 'cdk-outputs.json');
    
    if (!fs.existsSync(outputsPath)) {
      throw new Error('CDK outputs file not found');
    }

    return JSON.parse(fs.readFileSync(outputsPath, 'utf8'));
  }

  private getVersion(): string {
    const packagePath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return packageJson.version;
  }

  private getGitCommit(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }
}

// Main execution
async function main() {
  const environment = process.env.ENVIRONMENT || 'dev';
  const slot = (process.env.DEPLOYMENT_SLOT as 'blue' | 'green') || 'blue';
  const deploymentId = process.env.DEPLOYMENT_ID || `deploy-${Date.now()}`;
  const region = process.env.AWS_REGION || 'us-east-1';
  const accountId = process.env.CDK_DEFAULT_ACCOUNT;

  if (!accountId) {
    throw new Error('CDK_DEFAULT_ACCOUNT environment variable is required');
  }

  const config: DeploymentConfig = {
    environment,
    slot,
    deploymentId,
    region,
    accountId,
  };

  const deployment = new BlueGreenDeployment(config);
  await deployment.deploy();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });
}

export { BlueGreenDeployment };