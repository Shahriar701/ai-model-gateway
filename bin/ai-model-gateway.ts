#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AiModelGatewayStack } from '../lib/ai-model-gateway-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { SecurityStack } from '../lib/security-stack';

// Environment configuration
const getEnvironmentConfig = () => {
  const environment = process.env.ENVIRONMENT || 'dev';
  const account = process.env.CDK_DEFAULT_ACCOUNT;
  const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';

  return {
    environment,
    account,
    region,
    stackPrefix: `ai-gateway-${environment}`,
  };
};

const app = new cdk.App();
const config = getEnvironmentConfig();

// Define environment for all stacks
const env = {
  account: config.account,
  region: config.region,
};

// Security stack - foundational security resources
const securityStack = new SecurityStack(app, `${config.stackPrefix}-security`, {
  env,
  description: 'Security and compliance resources for AI Model Gateway',
  tags: {
    Environment: config.environment,
    Project: 'ai-model-gateway',
    Component: 'security',
  },
});

// Main application stack
const appStack = new AiModelGatewayStack(app, `${config.stackPrefix}-app`, {
  env,
  description: 'Main AI Model Gateway application stack',
  securityResources: securityStack.securityResources,
  tags: {
    Environment: config.environment,
    Project: 'ai-model-gateway',
    Component: 'application',
  },
});

// Observability stack - monitoring and alerting
const observabilityStack = new ObservabilityStack(app, `${config.stackPrefix}-observability`, {
  env,
  description: 'Monitoring and observability for AI Model Gateway',
  appResources: appStack.appResources,
  tags: {
    Environment: config.environment,
    Project: 'ai-model-gateway',
    Component: 'observability',
  },
});

// Stack dependencies
appStack.addDependency(securityStack);
observabilityStack.addDependency(appStack);
