import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { getConfig } from '../config/environments';

export interface SecurityResources {
  // Will be populated by SecurityStack
  kmsKey?: cdk.aws_kms.Key;
  vpc?: cdk.aws_ec2.Vpc;
  securityGroup?: cdk.aws_ec2.SecurityGroup;
}

export interface AppResources {
  // Will be populated by this stack for ObservabilityStack
  apiGateway?: cdk.aws_apigateway.RestApi;
  lambdaFunctions?: cdk.aws_lambda.Function[];
  dynamoTables?: cdk.aws_dynamodb.Table[];
}

export interface AiModelGatewayStackProps extends cdk.StackProps {
  securityResources?: SecurityResources;
}

export class AiModelGatewayStack extends cdk.Stack {
  public readonly appResources: AppResources = {};
  
  constructor(scope: Construct, id: string, props: AiModelGatewayStackProps) {
    super(scope, id, props);

    // Get environment configuration
    const config = getConfig();
    
    // Add stack-level tags
    cdk.Tags.of(this).add('Environment', config.environment);
    cdk.Tags.of(this).add('Project', config.app.name);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    
    // Output important information
    new cdk.CfnOutput(this, 'Environment', {
      value: config.environment,
      description: 'Deployment environment',
    });
    
    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'AWS region for deployment',
    });
    
    new cdk.CfnOutput(this, 'StackName', {
      value: this.stackName,
      description: 'CloudFormation stack name',
    });

    // Placeholder for future resources
    // Resources will be added in subsequent tasks:
    // - DynamoDB tables (Task 3.1)
    // - Lambda functions (Task 3.2)
    // - API Gateway (Task 3.2)
    // - ElastiCache Redis (Task 3.3)
  }
}
