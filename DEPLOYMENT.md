# AI Model Gateway - AWS Deployment Guide

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** configured with credentials
3. **Node.js 18+** installed
4. **AWS CDK CLI** installed globally

## Quick Start Deployment

### 1. Configure AWS Credentials

```bash
aws configure
```

Enter your:
- AWS Access Key ID
- AWS Secret Access Key
- Default region (e.g., `us-east-1`)
- Default output format (e.g., `json`)

### 2. Verify AWS Configuration

```bash
aws sts get-caller-identity
```

This should return your AWS account details.

### 3. Bootstrap CDK (First Time Only)

```bash
npm run bootstrap
```

This sets up the necessary AWS resources for CDK deployments.

### 4. Deploy to Development

```bash
npm run deploy:dev
```

This will:
- Build the TypeScript code
- Synthesize CloudFormation templates
- Deploy all stacks to AWS
- Output the API Gateway URL

### 5. Deploy to Production

```bash
npm run deploy:prod
```

## What Gets Deployed

### Infrastructure Components:

1. **DynamoDB Tables**
   - Request logs table (for analytics)
   - API keys table (for authentication)

2. **Lambda Functions**
   - Gateway function (main LLM routing)
   - MCP function (product data integration)

3. **API Gateway**
   - REST API with CORS enabled
   - Routes: `/api/v1/health`, `/api/v1/completions`, `/api/v1/products`

4. **IAM Roles & Policies**
   - Lambda execution roles
   - DynamoDB access permissions

5. **CloudWatch**
   - Log groups for each Lambda
   - X-Ray tracing enabled

## Post-Deployment

### Get API URL

After deployment, the API URL will be in the outputs:

```bash
# From CDK output
API URL: https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/
```

### Test the API

```bash
# Health check
curl https://YOUR_API_URL/api/v1/health

# Test completion (will return placeholder response)
curl -X POST https://YOUR_API_URL/api/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Test product search
curl -X POST https://YOUR_API_URL/api/v1/products/search \
  -H "Content-Type: application/json" \
  -d '{"query": "headphones"}'
```

## Environment Variables

To add API keys for LLM providers:

### OpenAI API Key

```bash
aws ssm put-parameter \
  --name "/ai-gateway/dev/openai-api-key" \
  --value "your-openai-api-key" \
  --type "SecureString"
```

### AWS Bedrock

Bedrock uses IAM roles, so ensure your Lambda execution role has:
- `bedrock:InvokeModel` permission

## Monitoring

### CloudWatch Logs

```bash
# View Gateway function logs
aws logs tail /aws/lambda/ai-model-gateway-gateway-dev --follow

# View MCP function logs
aws logs tail /aws/lambda/ai-model-gateway-mcp-dev --follow
```

### CloudWatch Metrics

Navigate to CloudWatch Console to view:
- Lambda invocations
- API Gateway requests
- DynamoDB operations
- Error rates and latency

### X-Ray Tracing

Navigate to X-Ray Console to view:
- Request traces
- Service map
- Performance bottlenecks

## Cost Estimation

### Development Environment (Low Traffic)
- Lambda: ~$0.20/month (1M requests)
- DynamoDB: ~$0.25/month (on-demand)
- API Gateway: ~$3.50/month (1M requests)
- **Total: ~$4/month**

### Production Environment (Moderate Traffic)
- Lambda: ~$20/month (100M requests)
- DynamoDB: ~$25/month
- API Gateway: ~$350/month (100M requests)
- **Total: ~$395/month**

Note: LLM provider costs (OpenAI, Bedrock) are additional.

## Cleanup

To remove all resources:

```bash
npm run destroy
```

⚠️ **Warning**: This will delete all data in DynamoDB tables!

## Troubleshooting

### Deployment Fails

1. **Check AWS credentials**:
   ```bash
   aws sts get-caller-identity
   ```

2. **Check CDK bootstrap**:
   ```bash
   cdk bootstrap
   ```

3. **Check for existing resources**:
   - Stack names must be unique
   - Some resources may have naming conflicts

### Lambda Function Errors

1. **Check CloudWatch Logs**:
   ```bash
   aws logs tail /aws/lambda/FUNCTION_NAME --follow
   ```

2. **Check environment variables**:
   - Ensure all required env vars are set
   - Check Parameter Store for secrets

### API Gateway 403 Errors

1. **Check CORS configuration**
2. **Verify API key if using authentication**
3. **Check Lambda permissions**

## GitHub Actions CI/CD

The repository includes a GitHub Actions workflow for automated deployment.

### Setup GitHub Secrets

Add these secrets to your GitHub repository:

1. `AWS_ACCESS_KEY_ID` - Your AWS access key
2. `AWS_SECRET_ACCESS_KEY` - Your AWS secret key
3. `AWS_ACCOUNT_ID` - Your AWS account ID

### Automatic Deployment

- Push to `develop` branch → Deploys to dev environment
- Push to `master` branch → Deploys to production environment

## Next Steps

1. **Add LLM Provider Keys** - Configure OpenAI/Bedrock credentials
2. **Set up Monitoring** - Create CloudWatch dashboards
3. **Configure Rate Limiting** - Set up API Gateway usage plans
4. **Add Custom Domain** - Use Route53 and ACM for custom domain
5. **Enable Caching** - Add ElastiCache Redis for response caching

## Support

For issues or questions:
- Check CloudWatch Logs
- Review X-Ray traces
- Check GitHub Issues

---

**Built for idealo interview - Production-ready AI platform engineering**