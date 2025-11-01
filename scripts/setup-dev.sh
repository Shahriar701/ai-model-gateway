#!/bin/bash

# Development Environment Setup Script
# This script sets up the local development environment for the AI Model Gateway

set -e

echo "🚀 Setting up AI Model Gateway development environment..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18 or later."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18 or later is required. Current version: $(node --version)"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

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
npm ci

# Build the project
echo "🔨 Building project..."
npm run build

# Run tests to ensure everything is working
echo "🧪 Running tests..."
npm run test

# Check linting
echo "🔍 Running linter..."
npm run lint

# Check formatting
echo "💅 Checking code formatting..."
npm run format:check

# Setup Husky hooks
echo "🪝 Setting up Git hooks..."
npm run prepare

# Create local environment file if it doesn't exist
if [ ! -f .env.local ]; then
    echo "📝 Creating local environment file..."
    cp .env.example .env.local
    echo "⚠️  Please update .env.local with your actual configuration values"
fi

# CDK Bootstrap check
echo "☁️  Checking CDK bootstrap status..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo "⚠️  AWS credentials not configured. Please run 'aws configure' or set up your AWS profile."
else
    echo "✅ AWS credentials configured"
    echo "💡 Run 'npm run bootstrap' to bootstrap CDK if you haven't already"
fi

echo ""
echo "🎉 Development environment setup complete!"
echo ""
echo "Next steps:"
echo "1. Update .env.local with your configuration"
echo "2. Run 'npm run bootstrap' to bootstrap CDK (if needed)"
echo "3. Run 'npm run dev' to start development mode"
echo "4. Run 'npm run deploy:dev' to deploy to development environment"
echo ""