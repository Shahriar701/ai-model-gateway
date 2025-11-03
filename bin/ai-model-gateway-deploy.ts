#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

class FullAiGatewayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Tables
    const apiKeyTable = new dynamodb.Table(this, 'ApiKeyTable', {
      tableName: `ai-gateway-api-keys-${this.stackName}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const productTable = new dynamodb.Table(this, 'ProductTable', {
      tableName: `ai-gateway-products-${this.stackName}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const requestLogTable = new dynamodb.Table(this, 'RequestLogTable', {
      tableName: `ai-gateway-request-logs-${this.stackName}`,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda execution role with comprehensive permissions
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
      ],
      inlinePolicies: {
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [
                apiKeyTable.tableArn,
                productTable.tableArn,
                requestLogTable.tableArn,
              ],
            }),
          ],
        }),
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
              ],
              resources: ['*'],
            }),
          ],
        }),
        ParameterStoreAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ssm:GetParameter',
                'ssm:GetParameters',
                'ssm:GetParametersByPath',
              ],
              resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/ai-gateway/*`],
            }),
          ],
        }),
        CloudWatchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cloudwatch:PutMetricData',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Main Gateway Lambda
    const gatewayLambda = new lambda.Function(this, 'GatewayFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('dist/src/lambda/gateway'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: lambdaRole,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        NODE_ENV: 'production',
        API_KEY_TABLE: apiKeyTable.tableName,
        PRODUCT_TABLE: productTable.tableName,
        REQUEST_LOG_TABLE: requestLogTable.tableName,
        ENVIRONMENT: process.env.ENVIRONMENT || 'dev',
        OPENAI_ENABLED: 'true',
        BEDROCK_ENABLED: 'true',
        CACHE_ENABLED: 'false', // Disable Redis for now
        MCP_ENABLED: 'true',
      },
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'AiGatewayApi', {
      restApiName: `ai-model-gateway-full-${this.stackName}`,
      description: 'AI Model Gateway API - Full Version',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
    });

    // Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(gatewayLambda);

    // Add routes
    api.root.addMethod('ANY', lambdaIntegration);
    const proxy = api.root.addResource('{proxy+}');
    proxy.addMethod('ANY', lambdaIntegration);

    // Outputs
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'ApiKeyTableName', {
      value: apiKeyTable.tableName,
      description: 'API Key Table Name',
    });

    new cdk.CfnOutput(this, 'ProductTableName', {
      value: productTable.tableName,
      description: 'Product Table Name',
    });
  }
}

const app = new cdk.App();
const environment = process.env.ENVIRONMENT || 'dev';

new FullAiGatewayStack(app, `ai-gateway-full-${environment}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: `AI Model Gateway - Full Version (${environment})`,
});
