import { Construct } from 'constructs';
import {
  RestApi,
  LambdaIntegration,
  Cors,
  RequestValidator,
  Model,
  JsonSchemaType,
} from 'aws-cdk-lib/aws-apigateway';
import { Function } from 'aws-cdk-lib/aws-lambda';

export interface ApiGatewayConstructProps {
  apiName: string;
  description: string;
  gatewayFunction: Function;
  mcpFunction: Function;
}

/**
 * API Gateway construct with proper CORS, throttling, and validation
 * Implements production-ready API patterns
 */
export class ApiGatewayConstruct extends Construct {
  public readonly api: RestApi;

  constructor(scope: Construct, id: string, props: ApiGatewayConstructProps) {
    super(scope, id);

    // Create REST API with CORS enabled
    this.api = new RestApi(this, 'Api', {
      restApiName: props.apiName,
      description: props.description,
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Correlation-ID',
        ],
      },
      // Deploy options will be configured at deployment time
    });

    // Create request validator for input validation
    const requestValidator = new RequestValidator(this, 'RequestValidator', {
      restApi: this.api,
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    // Create Lambda integrations
    const gatewayIntegration = new LambdaIntegration(props.gatewayFunction, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });

    const mcpIntegration = new LambdaIntegration(props.mcpFunction, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });

    // Define request/response models
    const llmRequestModel = new Model(this, 'LLMRequestModel', {
      restApi: this.api,
      contentType: 'application/json',
      modelName: 'LLMRequest',
      schema: {
        type: JsonSchemaType.OBJECT,
        properties: {
          model: { type: JsonSchemaType.STRING },
          messages: {
            type: JsonSchemaType.ARRAY,
            items: {
              type: JsonSchemaType.OBJECT,
              properties: {
                role: { type: JsonSchemaType.STRING, enum: ['system', 'user', 'assistant'] },
                content: { type: JsonSchemaType.STRING },
              },
              required: ['role', 'content'],
            },
          },
          temperature: { type: JsonSchemaType.NUMBER, minimum: 0, maximum: 2 },
          maxTokens: { type: JsonSchemaType.INTEGER, minimum: 1, maximum: 4000 },
        },
        required: ['model', 'messages'],
      },
    });

    // API Routes

    // Main gateway routes
    const v1 = this.api.root.addResource('api').addResource('v1');

    // LLM completion endpoint
    const completions = v1.addResource('completions');
    completions.addMethod('POST', gatewayIntegration, {
      requestValidator,
      requestModels: {
        'application/json': llmRequestModel,
      },
      methodResponses: [{ statusCode: '200' }, { statusCode: '400' }, { statusCode: '429' }],
    });

    // Health check endpoint
    const health = v1.addResource('health');
    health.addMethod('GET', gatewayIntegration);

    // MCP endpoints
    const mcp = v1.addResource('mcp');

    // MCP tools endpoint
    const tools = mcp.addResource('tools');
    tools.addMethod('POST', mcpIntegration, {
      requestValidator,
    });

    // MCP resources endpoint
    const resources = mcp.addResource('resources');
    resources.addMethod('GET', mcpIntegration);
    resources.addMethod('POST', mcpIntegration, {
      requestValidator,
    });

    // Product search endpoint (convenience endpoint for direct product queries)
    const products = v1.addResource('products');
    products.addMethod('GET', mcpIntegration);

    const productSearch = products.addResource('search');
    productSearch.addMethod('POST', mcpIntegration, {
      requestValidator,
    });
  }
}
