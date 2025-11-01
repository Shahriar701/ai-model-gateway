#!/bin/bash

# AWS CDK Bootstrap Script for AI Model Gateway
# This script bootstraps CDK in your AWS account for deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
AWS_REGION=${AWS_REGION:-"us-east-1"}
ENVIRONMENT=${ENVIRONMENT:-"dev"}

echo -e "${GREEN}🚀 Bootstrapping AWS CDK for AI Model Gateway${NC}"
echo "Region: $AWS_REGION"
echo "Environment: $ENVIRONMENT"

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo -e "${RED}❌ AWS CLI is not configured or credentials are invalid${NC}"
    echo "Please run 'aws configure' or set AWS environment variables"
    exit 1
fi

# Get AWS Account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account ID: $AWS_ACCOUNT_ID"

# Check if CDK is installed
if ! command -v cdk &> /dev/null; then
    echo -e "${YELLOW}⚠️  CDK CLI not found. Installing...${NC}"
    npm install -g aws-cdk
fi

# Bootstrap CDK
echo -e "${GREEN}📦 Bootstrapping CDK...${NC}"
npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION \
    --toolkit-stack-name "CDKToolkit-ai-model-gateway" \
    --qualifier "aimgw" \
    --tags "Project=ai-model-gateway,Environment=$ENVIRONMENT"

# Verify bootstrap
echo -e "${GREEN}✅ Verifying CDK bootstrap...${NC}"
if aws cloudformation describe-stacks --stack-name "CDKToolkit-ai-model-gateway" --region $AWS_REGION > /dev/null 2>&1; then
    echo -e "${GREEN}✅ CDK bootstrap successful!${NC}"
else
    echo -e "${RED}❌ CDK bootstrap failed${NC}"
    exit 1
fi

echo -e "${GREEN}🎉 AWS CDK bootstrap completed successfully!${NC}"
echo ""
echo "Next steps:"
echo "1. Set up GitHub secrets (see docs/AWS_GITHUB_SETUP.md)"
echo "2. Push code to trigger deployment pipeline"
echo "3. Monitor deployment in GitHub Actions and AWS CloudFormation"