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

    // DynamoDB Tables
    const requestLogsTable = new cdk.aws_dynamodb.Table(this, 'RequestLogsTable', {
      tableName: `${config.app.name}-request-logs-${config.environment}`,
      partitionKey: { name: 'PK', type: cdk.aws_dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: cdk.aws_dynamodb.AttributeType.STRING },
      billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: config.environment === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    const apiKeysTable = new cdk.aws_dynamodb.Table(this, 'ApiKeysTable', {
      tableName: `${config.app.name}-api-keys-${config.environment}`,
      partitionKey: { name: 'PK', type: cdk.aws_dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: cdk.aws_dynamodb.AttributeType.STRING },
      billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: config.environment === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Lambda Functions
    const gatewayFunction = new cdk.aws_lambda.Function(this, 'GatewayFunction', {
      functionName: `${config.app.name}-gateway-${config.environment}`,
      runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
      architecture: cdk.aws_lambda.Architecture.ARM_64,
      handler: 'lambda/gateway/index.handler',
      code: cdk.aws_lambda.Code.fromAsset('lib'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        NODE_ENV: config.environment,
        LOG_LEVEL: config.app.logLevel,
        REQUEST_LOGS_TABLE: requestLogsTable.tableName,
        API_KEYS_TABLE: apiKeysTable.tableName,
      },
      tracing: cdk.aws_lambda.Tracing.ACTIVE,
    });

    const mcpFunction = new cdk.aws_lambda.Function(this, 'MCPFunction', {
      functionName: `${config.app.name}-mcp-${config.environment}`,
      runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
      architecture: cdk.aws_lambda.Architecture.ARM_64,
      handler: 'lambda/mcp-server/index.handler',
      code: cdk.aws_lambda.Code.fromAsset('lib'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        NODE_ENV: config.environment,
        LOG_LEVEL: config.app.logLevel,
      },
      tracing: cdk.aws_lambda.Tracing.ACTIVE,
    });

    // Grant permissions
    requestLogsTable.grantReadWriteData(gatewayFunction);
    apiKeysTable.grantReadWriteData(gatewayFunction);

    // API Gateway
    const api = new cdk.aws_apigateway.RestApi(this, 'Api', {
      restApiName: `${config.app.name}-api-${config.environment}`,
      description: 'AI Model Gateway API',
      defaultCorsPreflightOptions: {
        allowOrigins: cdk.aws_apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Correlation-ID'
        ],
      },
    });

    // API Routes
    const v1 = api.root.addResource('api').addResource('v1');
    
    // Health check
    const health = v1.addResource('health');
    health.addMethod('GET', new cdk.aws_apigateway.LambdaIntegration(gatewayFunction));

    // LLM completions
    const completions = v1.addResource('completions');
    completions.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(gatewayFunction));

    // MCP endpoints
    const mcp = v1.addResource('mcp');
    const tools = mcp.addResource('tools');
    tools.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(mcpFunction));

    const products = v1.addResource('products');
    products.addMethod('GET', new cdk.aws_apigateway.LambdaIntegration(mcpFunction));
    const productSearch = products.addResource('search');
    productSearch.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(mcpFunction));

    // Store resources for other stacks
    this.appResources.apiGateway = api;
    this.appResources.lambdaFunctions = [gatewayFunction, mcpFunction];
    this.appResources.dynamoTables = [requestLogsTable, apiKeysTable];

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
      exportName: `${config.app.name}-api-url-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: api.restApiId,
      description: 'API Gateway ID',
    });

    new cdk.CfnOutput(this, 'GatewayFunctionArn', {
      value: gatewayFunction.functionArn,
      description: 'Gateway Lambda Function ARN',
    });

    new cdk.CfnOutput(this, 'MCPFunctionArn', {
      value: mcpFunction.functionArn,
      description: 'MCP Lambda Function ARN',
    });
  }
}
