import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AiModelGatewayStack } from '../lib/ai-model-gateway-stack';
import { SecurityStack } from '../lib/security-stack';
import { ObservabilityStack } from '../lib/observability-stack';

describe('AI Model Gateway Stack Tests', () => {
  let app: cdk.App;

  beforeEach(() => {
    app = new cdk.App();
  });

  test('Security Stack creates successfully', () => {
    // WHEN
    const securityStack = new SecurityStack(app, 'TestSecurityStack', {});

    // THEN
    const template = Template.fromStack(securityStack);

    // Verify VPC is created
    template.hasResourceProperties('AWS::EC2::VPC', {});
  });

  test('Main Application Stack creates successfully', () => {
    // GIVEN
    const securityStack = new SecurityStack(app, 'TestSecurityStack', {});

    // WHEN
    const appStack = new AiModelGatewayStack(app, 'TestAppStack', {
      securityResources: securityStack.securityResources,
    });

    // THEN
    const template = Template.fromStack(appStack);

    // Verify API Gateway is created
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {});
  });

  test('Observability Stack creates successfully', () => {
    // GIVEN
    const securityStack = new SecurityStack(app, 'TestSecurityStack', {});
    const appStack = new AiModelGatewayStack(app, 'TestAppStack', {
      securityResources: securityStack.securityResources,
    });

    // WHEN
    const observabilityStack = new ObservabilityStack(app, 'TestObservabilityStack', {
      appResources: appStack.appResources,
    });

    // THEN
    const template = Template.fromStack(observabilityStack);

    // Verify CloudWatch dashboard is created
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {});
  });

  test('Environment configuration works correctly', () => {
    // Test that environment variables are properly handled
    process.env.ENVIRONMENT = 'test';

    const securityStack = new SecurityStack(app, 'TestSecurityStack', {});
    const appStack = new AiModelGatewayStack(app, 'TestAppStack', {
      securityResources: securityStack.securityResources,
    });
    const template = Template.fromStack(appStack);

    // Verify DynamoDB tables are created
    template.hasResourceProperties('AWS::DynamoDB::Table', {});

    // Clean up
    delete process.env.ENVIRONMENT;
  });

  test('Stack dependencies are properly configured', () => {
    // GIVEN
    const securityStack = new SecurityStack(app, 'TestSecurityStack', {});
    const appStack = new AiModelGatewayStack(app, 'TestAppStack', {
      securityResources: securityStack.securityResources,
    });
    const observabilityStack = new ObservabilityStack(app, 'TestObservabilityStack', {
      appResources: appStack.appResources,
    });

    // WHEN
    appStack.addDependency(securityStack);
    observabilityStack.addDependency(appStack);

    // THEN - No errors should be thrown
    expect(appStack).toBeDefined();
    expect(observabilityStack).toBeDefined();
  });
});
