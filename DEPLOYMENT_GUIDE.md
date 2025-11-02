# AI Model Gateway - Deployment Guide

## 🚀 Quick Start Deployment

### Prerequisites

1. **AWS CLI configured** with appropriate permissions
2. **Node.js 18+** installed
3. **AWS CDK** installed globally: `npm install -g aws-cdk`
4. **jq** installed for JSON parsing (for testing scripts)

### Step 1: Deploy to AWS

```bash
# Clone and navigate to the project
cd ai-model-gateway

# Run the simple deployment script
./deploy-simple.sh
```

This will:
- Install dependencies
- Build the project
- Bootstrap CDK (if needed)
- Deploy all stacks (Security, Application, Observability)

### Step 2: Test the Deployment

```bash
# Run basic deployment tests
./test-deployment.sh
```

This will test:
- Health endpoints
- Authentication (should properly reject)
- CORS handling
- Circuit breaker status

## 🔧 Configuration

### Environment Variables

Set these before deployment:

```bash
export ENVIRONMENT=dev  # or staging, prod
export CDK_DEFAULT_REGION=us-east-1  # your preferred region
export CDK_DEFAULT_ACCOUNT=123456789012  # your AWS account ID
```

### API Keys Setup

After deployment, create API keys in DynamoDB:

```bash
# Get the API Keys table name
TABLE_NAME=$(aws dynamodb list-tables --query 'TableNames[?contains(@, `ApiKeys`)]' --output text)

# Create a test API key
aws dynamodb put-item \
  --table-name $TABLE_NAME \
  --item '{
    "id": {"S": "test-key-1"},
    "key": {"S": "ak_test_1234567890abcdef1234567890abcdef"},
    "name": {"S": "Test API Key"},
    "userId": {"S": "test-user-1"},
    "tier": {"S": "premium"},
    "enabled": {"BOOL": true},
    "createdAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"},
    "permissions": {"L": [
      {"M": {
        "resource": {"S": "completions"},
        "actions": {"L": [{"S": "create"}]}
      }}
    ]}
  }'
```

### Provider Configuration

#### OpenAI Setup
```bash
# Store OpenAI API key in Parameter Store
aws ssm put-parameter \
  --name "/ai-gateway/dev/openai/api-key" \
  --value "your-openai-api-key" \
  --type "SecureString"
```

#### AWS Bedrock Setup
```bash
# Ensure your Lambda execution role has Bedrock permissions
# The CDK stack should have created this automatically
```

## 🧪 Testing Your Integration

### Test 1: Health Check
```bash
API_URL="your-api-gateway-url"
curl "$API_URL/api/v1/health"
```

### Test 2: LLM Completion
```bash
curl -X POST "$API_URL/api/v1/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ak_test_1234567890abcdef1234567890abcdef" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "max_tokens": 100
  }'
```

### Test 3: MCP Integration (Product Search)
```bash
curl -X POST "$API_URL/api/v1/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ak_test_1234567890abcdef1234567890abcdef" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "I want to search for wireless headphones under $200"}
    ],
    "max_tokens": 200
  }'
```

### Test 4: Circuit Breaker Status
```bash
curl "$API_URL/api/v1/health/circuit-breakers"
```

## 📊 Monitoring

### CloudWatch Dashboards
- Navigate to CloudWatch → Dashboards
- Look for dashboards prefixed with your environment name

### Key Metrics to Monitor
- **Request Latency**: Average response time
- **Error Rate**: 4xx and 5xx responses
- **Provider Health**: Circuit breaker states
- **Cost Tracking**: Token usage and costs
- **Cache Hit Rate**: Response caching effectiveness

### Logs
```bash
# Gateway handler logs
aws logs tail /aws/lambda/ai-gateway-dev-app-GatewayHandler --follow

# MCP service logs
aws logs tail /aws/lambda/ai-gateway-dev-app-MCPHandler --follow
```

## 🔒 Security

### API Key Management
- API keys are stored in DynamoDB with encryption at rest
- Use different tiers (free, basic, premium, enterprise) for rate limiting
- Regularly rotate API keys

### Network Security
- All Lambda functions run in VPC
- Redis cache in private subnets
- Security groups restrict access

### Monitoring Security Events
```bash
# Check security logs
aws logs filter-log-events \
  --log-group-name /aws/lambda/ai-gateway-dev-app-GatewayHandler \
  --filter-pattern "AUTHENTICATION_FAILURE"
```

## 🚨 Troubleshooting

### Common Issues

1. **Deployment Fails**
   ```bash
   # Check CDK bootstrap
   npx cdk bootstrap
   
   # Check AWS credentials
   aws sts get-caller-identity
   ```

2. **Health Check Fails**
   ```bash
   # Check Lambda logs
   aws logs tail /aws/lambda/ai-gateway-dev-app-GatewayHandler --follow
   ```

3. **Authentication Issues**
   ```bash
   # Verify API key in DynamoDB
   aws dynamodb scan --table-name YourApiKeysTable
   ```

4. **Provider Errors**
   ```bash
   # Check circuit breaker status
   curl "$API_URL/api/v1/health/circuit-breakers"
   ```

### Performance Optimization

1. **Enable Response Caching**
   - Responses are cached in Redis automatically
   - Adjust TTL in environment variables

2. **Monitor Circuit Breakers**
   - Check `/api/v1/health/circuit-breakers` regularly
   - Reset if needed via admin API

3. **Cost Optimization**
   - Monitor token usage in CloudWatch
   - Use cost-optimized routing strategy

## 🔄 Updates and Maintenance

### Updating the Deployment
```bash
# Pull latest changes
git pull

# Redeploy
./deploy-simple.sh
```

### Rolling Back
```bash
# List stack history
aws cloudformation describe-stack-events --stack-name ai-gateway-dev-app

# Rollback if needed
npx cdk deploy --rollback
```

### Scaling
- Lambda functions auto-scale
- Adjust DynamoDB capacity as needed
- Monitor Redis memory usage

## 📞 Support

For issues or questions:
1. Check CloudWatch logs first
2. Review circuit breaker status
3. Verify configuration in Parameter Store
4. Check security events in logs

## 🎯 Next Steps

After successful deployment:
1. Set up monitoring alerts
2. Configure backup strategies
3. Implement CI/CD pipeline
4. Add custom domain name
5. Set up staging environment