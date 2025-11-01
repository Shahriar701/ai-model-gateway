import { Construct } from 'constructs';
import { Function, Runtime, Code, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

export interface LambdaConstructProps {
  functionName: string;
  handler: string;
  codePath: string;
  environment?: Record<string, string>;
  timeout?: Duration;
  memorySize?: number;
  description?: string;
}

/**
 * Reusable Lambda construct with best practices
 * Includes CloudWatch logging, X-Ray tracing, and performance optimization
 */
export class LambdaConstruct extends Construct {
  public readonly function: Function;
  public readonly logGroup: LogGroup;

  constructor(scope: Construct, id: string, props: LambdaConstructProps) {
    super(scope, id);

    // Create CloudWatch Log Group with retention
    this.logGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${props.functionName}`,
      retention: RetentionDays.ONE_MONTH
    });

    // Create Lambda function with best practices
    this.function = new Function(this, 'Function', {
      functionName: props.functionName,
      runtime: Runtime.NODEJS_18_X,
      architecture: Architecture.ARM_64, // Better price/performance
      handler: props.handler,
      code: Code.fromAsset(props.codePath),
      timeout: props.timeout || Duration.seconds(30),
      memorySize: props.memorySize || 512,
      description: props.description,
      environment: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'INFO',
        ...props.environment
      },
      // Enable X-Ray tracing for observability
      tracing: Tracing.ACTIVE,
      // Enable function URL for direct invocation if needed
      // functionUrl: { authType: FunctionUrlAuthType.NONE }
    });
  }
}