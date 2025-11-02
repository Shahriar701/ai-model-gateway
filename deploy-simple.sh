#!/bin/bash

# Simple deployment script for AI Model Gateway
set -e

echo "🚀 Starting AI Model Gateway deployment..."

# Set environment variables
export ENVIRONMENT=${ENVIRONMENT:-dev}
export CDK_DEFAULT_REGION=${CDK_DEFAULT_REGION:-us-east-1}

echo "Environment: $ENVIRONMENT"
echo "Region: $CDK_DEFAULT_REGION"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project (excluding tests)
echo "🔨 Building project..."
npx tsc -p tsconfig.build.json --noEmit

# Bootstrap CDK if needed
echo "🏗️ Bootstrapping CDK..."
npx cdk bootstrap

# Deploy stacks
echo "🚀 Deploying stacks..."
npx cdk deploy --all --require-approval never

echo "✅ Deployment completed successfully!"
echo ""
echo "🔗 Next steps:"
echo "1. Set up your API keys in DynamoDB"
echo "2. Configure your OpenAI/Bedrock credentials"
echo "3. Test the endpoints"
echo ""
echo "📋 Useful commands:"
echo "  - View stack outputs: npx cdk list"
echo "  - Check logs: aws logs tail /aws/lambda/ai-gateway-dev-app-GatewayHandler --follow"
echo "  - Test health: curl https://your-api-gateway-url/api/v1/health"