#!/bin/bash

# Development environment setup script
set -e

echo "🚀 Setting up AI Model Gateway development environment..."

# Check Node.js version
NODE_VERSION=$(node --version)
echo "✅ Node.js version: $NODE_VERSION"

# Check AWS CLI
if command -v aws &> /dev/null; then
    AWS_VERSION=$(aws --version)
    echo "✅ AWS CLI: $AWS_VERSION"
else
    echo "❌ AWS CLI not found. Please install AWS CLI."
    exit 1
fi

# Check CDK CLI
if command -v cdk &> /dev/null; then
    CDK_VERSION=$(cdk --version)
    echo "✅ AWS CDK: $CDK_VERSION"
else
    echo "❌ AWS CDK CLI not found. Installing..."
    npm install -g aws-cdk
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build project
echo "🔨 Building project..."
npm run build

# Run tests
echo "🧪 Running tests..."
npm test

# Check linting
echo "🔍 Checking code quality..."
npm run lint

# Bootstrap CDK (if not already done)
echo "🏗️ Checking CDK bootstrap..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Please run 'aws configure'"
    exit 1
fi

echo "✅ Development environment setup complete!"
echo ""
echo "Next steps:"
echo "1. Configure your AWS credentials: aws configure"
echo "2. Bootstrap CDK: npm run bootstrap"
echo "3. Deploy to dev: npm run deploy:dev"
echo ""
echo "Happy coding! 🎉"