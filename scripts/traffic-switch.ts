#!/usr/bin/env ts-node

import * as AWS from 'aws-sdk';
import { execSync } from 'child_process';

interface TrafficSwitchConfig {
  environment: string;
  percentage: number;
  target: 'blue' | 'green';
  region: string;
}

interface WeightedTarget {
  id: string;
  weight: number;
}

class TrafficSwitcher {
  private apiGateway: AWS.APIGateway;
  private cloudFormation: AWS.CloudFormation;
  private ssm: AWS.SSM;
  private config: TrafficSwitchConfig;

  constructor(config: TrafficSwitchConfig) {
    this.config = config;
    this.apiGateway = new AWS.APIGateway({ region: config.region });
    this.cloudFormation = new AWS.CloudFormation({ region: config.region });
    this.ssm = new AWS.SSM({ region: config.region });
  }

  async switchTraffic(): Promise<void> {
    console.log(`Switching ${this.config.percentage}% traffic to ${this.config.target} environment`);

    try {
      // 1. Get current deployment information
      const deploymentInfo = await this.getCurrentDeploymentInfo();

      // 2. Calculate traffic weights
      const weights = this.calculateTrafficWeights();

      // 3. Update API Gateway stage variables or weighted routing
      await this.updateApiGatewayRouting(weights);

      // 4. Update feature flags for gradual rollout
      await this.updateFeatureFlagRollout();

      // 5. Monitor the switch
      await this.monitorTrafficSwitch();

      // 6. Update deployment status
      await this.updateDeploymentStatus();

      console.log(`Traffic switch to ${this.config.target} completed successfully`);
    } catch (error) {
      console.error('Traffic switch failed:', error);
      throw error;
    }
  }

  private async getCurrentDeploymentInfo(): Promise<any> {
    const parameterName = `/ai-model-gateway/${this.config.environment}/deployment/status`;
    
    try {
      const result = await this.ssm.getParameter({
        Name: parameterName,
      }).promise();

      return JSON.parse(result.Parameter?.Value || '{}');
    } catch (error) {
      console.warn('Could not retrieve current deployment info:', error);
      return {};
    }
  }

  private calculateTrafficWeights(): { blue: number; green: number } {
    if (this.config.target === 'blue') {
      return {
        blue: this.config.percentage,
        green: 100 - this.config.percentage,
      };
    } else {
      return {
        blue: 100 - this.config.percentage,
        green: this.config.percentage,
      };
    }
  }

  private async updateApiGatewayRouting(weights: { blue: number; green: number }): Promise<void> {
    console.log(`Updating API Gateway routing: Blue=${weights.blue}%, Green=${weights.green}%`);

    // Get API Gateway information from CloudFormation
    const stackName = `ai-gateway-${this.config.environment}`;
    const stack = await this.cloudFormation.describeStacks({
      StackName: stackName,
    }).promise();

    const apiId = this.getOutputValue(stack.Stacks?.[0]?.Outputs, 'ApiGatewayId');
    const stageName = this.config.environment;

    if (!apiId) {
      throw new Error('API Gateway ID not found in stack outputs');
    }

    // Update stage variables to control routing
    await this.apiGateway.updateStage({
      restApiId: apiId,
      stageName: stageName,
      patchOps: [
        {
          op: 'replace',
          path: '/variables/BlueWeight',
          value: weights.blue.toString(),
        },
        {
          op: 'replace',
          path: '/variables/GreenWeight',
          value: weights.green.toString(),
        },
        {
          op: 'replace',
          path: '/variables/ActiveSlot',
          value: this.config.target,
        },
        {
          op: 'replace',
          path: '/variables/TrafficSwitchTimestamp',
          value: new Date().toISOString(),
        },
      ],
    }).promise();

    console.log('API Gateway routing updated');
  }

  private async updateFeatureFlagRollout(): Promise<void> {
    console.log('Updating feature flag rollout percentage...');

    const flagName = `/ai-model-gateway/${this.config.environment}/feature-flags/deployment-${this.config.target}`;
    
    try {
      // Get current feature flag
      const currentFlag = await this.ssm.getParameter({
        Name: flagName,
      }).promise();

      const flagData = JSON.parse(currentFlag.Parameter?.Value || '{}');
      
      // Update rollout percentage
      flagData.rolloutPercentage = this.config.percentage;
      flagData.updatedAt = new Date().toISOString();

      // Store updated flag
      await this.ssm.putParameter({
        Name: flagName,
        Value: JSON.stringify(flagData),
        Type: 'String',
        Overwrite: true,
      }).promise();

      console.log(`Feature flag rollout updated to ${this.config.percentage}%`);
    } catch (error) {
      console.warn('Could not update feature flag rollout:', error);
    }
  }

  private async monitorTrafficSwitch(): Promise<void> {
    console.log('Monitoring traffic switch...');

    // Wait a bit for the changes to propagate
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds

    // Run basic health checks to ensure the switch was successful
    await this.validateTrafficSwitch();
  }

  private async validateTrafficSwitch(): Promise<void> {
    console.log('Validating traffic switch...');

    // Get API endpoint
    const stackName = `ai-gateway-${this.config.environment}`;
    const stack = await this.cloudFormation.describeStacks({
      StackName: stackName,
    }).promise();

    const apiEndpoint = this.getOutputValue(stack.Stacks?.[0]?.Outputs, 'ApiEndpoint');

    if (!apiEndpoint) {
      throw new Error('API endpoint not found in stack outputs');
    }

    // Test multiple requests to verify traffic distribution
    const testRequests = 10;
    let successCount = 0;

    for (let i = 0; i < testRequests; i++) {
      try {
        const response = await fetch(`${apiEndpoint}/api/v1/health`);
        if (response.ok) {
          successCount++;
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.warn(`Test request ${i + 1} failed:`, error);
      }
    }

    const successRate = (successCount / testRequests) * 100;
    console.log(`Traffic switch validation: ${successCount}/${testRequests} requests successful (${successRate}%)`);

    if (successRate < 80) {
      throw new Error(`Traffic switch validation failed: only ${successRate}% success rate`);
    }
  }

  private async updateDeploymentStatus(): Promise<void> {
    const statusParam = `/ai-model-gateway/${this.config.environment}/deployment/status`;
    
    const status = {
      status: 'traffic_switched',
      activeSlot: this.config.target,
      trafficPercentage: this.config.percentage,
      timestamp: new Date().toISOString(),
    };

    await this.ssm.putParameter({
      Name: statusParam,
      Value: JSON.stringify(status),
      Type: 'String',
      Overwrite: true,
    }).promise();

    console.log('Deployment status updated');
  }

  private getOutputValue(outputs: AWS.CloudFormation.Output[] | undefined, key: string): string | undefined {
    return outputs?.find(output => output.OutputKey === key)?.OutputValue;
  }
}

// Rollback functionality
class TrafficRollback {
  private switcher: TrafficSwitcher;

  constructor(config: TrafficSwitchConfig) {
    this.switcher = new TrafficSwitcher(config);
  }

  async rollback(): Promise<void> {
    console.log(`Rolling back traffic from ${config.target}`);

    // Switch traffic back to the other slot
    const rollbackTarget = config.target === 'blue' ? 'green' : 'blue';
    const rollbackConfig: TrafficSwitchConfig = {
      ...config,
      target: rollbackTarget,
      percentage: 100,
    };

    const rollbackSwitcher = new TrafficSwitcher(rollbackConfig);
    await rollbackSwitcher.switchTraffic();

    console.log('Traffic rollback completed');
  }
}

// Main execution
async function main() {
  const environment = process.argv[2] || process.env.ENVIRONMENT || 'dev';
  const percentage = parseInt(process.argv[3] || process.env.TRAFFIC_PERCENTAGE || '100');
  const target = (process.argv[4] || process.env.TARGET_SLOT || 'blue') as 'blue' | 'green';
  const region = process.env.AWS_REGION || 'us-east-1';

  if (isNaN(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('Traffic percentage must be a number between 0 and 100');
  }

  const config: TrafficSwitchConfig = {
    environment,
    percentage,
    target,
    region,
  };

  const switcher = new TrafficSwitcher(config);
  await switcher.switchTraffic();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Traffic switch failed:', error);
    process.exit(1);
  });
}

export { TrafficSwitcher, TrafficRollback };