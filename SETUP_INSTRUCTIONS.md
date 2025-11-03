# AI Model Gateway - Complete Setup Instructions

## 🚀 Quick Start (5 Minutes)

### Prerequisites
- AWS CLI configured with appropriate permissions
- Node.js 18+ installed
- AWS CDK installed globally: `npm install -g aws-cdk`

### Step 1: Deploy the Gateway
```bash
# Clone and navigate to project
cd ai-model-gateway

# Deploy the full system
./deploy-full.sh
```

**Expected Output:**
```
✅ AI Model Gateway FULL VERSION is now deployed!
API URL: https://your-api-gateway-url.amazonaws.com/prod/
```

### Step 2: Test Basic Functionality
```bash
# Test health endpoint
curl "https://your-api-gateway-url/health"

# Should return:
{
  "status": "healthy",
  "version": "2.0.0",
  "message": "AI Model Gateway FULL VERSION is running!"
}
```

## 🔧 Complete Configuration

### 1. Set Up OpenAI Integration

```bash
# Store your OpenAI API key securely
aws ssm put-parameter \
  --name "/ai-gateway/dev/openai/api-key" \
  --value "sk-your-openai-api-key-here" \
  --type "SecureString"
```

### 2. Create API Keys for Authentication

```bash
# Get your DynamoDB table name from deployment output
TABLE_NAME="ai-gateway-api-keys-ai-gateway-full-dev"

# Create a premium API key
aws dynamodb put-item \
  --table-name $TABLE_NAME \
  --item '{
    "id": {"S": "premium-key-1"},
    "key": {"S": "ak_premium_1234567890abcdef1234567890abcdef"},
    "name": {"S": "Premium API Key"},
    "userId": {"S": "user-premium-1"},
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

# Create a basic API key
aws dynamodb put-item \
  --table-name $TABLE_NAME \
  --item '{
    "id": {"S": "basic-key-1"},
    "key": {"S": "ak_basic_abcdef1234567890abcdef1234567890"},
    "name": {"S": "Basic API Key"},
    "userId": {"S": "user-basic-1"},
    "tier": {"S": "basic"},
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

### 3. Add Sample Product Data for MCP Testing

```bash
# Get your products table name
PRODUCTS_TABLE="ai-gateway-products-ai-gateway-full-dev"

# Add sample electronics products
aws dynamodb put-item \
  --table-name $PRODUCTS_TABLE \
  --item '{
    "id": {"S": "prod-headphones-1"},
    "name": {"S": "Sony WH-1000XM4 Wireless Headphones"},
    "category": {"S": "Electronics"},
    "price": {"N": "199.99"},
    "available": {"BOOL": true},
    "description": {"S": "Premium noise-canceling wireless headphones"},
    "rating": {"N": "4.5"},
    "brand": {"S": "Sony"}
  }'

aws dynamodb put-item \
  --table-name $PRODUCTS_TABLE \
  --item '{
    "id": {"S": "prod-watch-1"},
    "name": {"S": "Apple Watch Series 9"},
    "category": {"S": "Wearables"},
    "price": {"N": "399.99"},
    "available": {"BOOL": true},
    "description": {"S": "Advanced smartwatch with health monitoring"},
    "rating": {"N": "4.8"},
    "brand": {"S": "Apple"}
  }'

aws dynamodb put-item \
  --table-name $PRODUCTS_TABLE \
  --item '{
    "id": {"S": "prod-headphones-2"},
    "name": {"S": "Bose QuietComfort 45"},
    "category": {"S": "Electronics"},
    "price": {"N": "179.99"},
    "available": {"BOOL": true},
    "description": {"S": "Comfortable noise-canceling headphones"},
    "rating": {"N": "4.3"},
    "brand": {"S": "Bose"}
  }'
```

## 🧪 Testing Your Setup

### Test 1: Basic Health Check
```bash
API_URL="https://your-api-gateway-url"
curl "$API_URL/health"
```

### Test 2: Authentication Test
```bash
# This should fail (no API key)
curl -X POST "$API_URL/api/v1/completions" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"Hello"}]}'

# Expected: 401 Authentication Error
```

### Test 3: Successful LLM Request
```bash
# This should work (with API key)
curl -X POST "$API_URL/api/v1/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ak_premium_1234567890abcdef1234567890abcdef" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Hello! How are you?"}
    ],
    "max_tokens": 100
  }'
```

### Test 4: MCP Product Search (Once Real Implementation is Connected)
```bash
curl -X POST "$API_URL/api/v1/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ak_premium_1234567890abcdef1234567890abcdef" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "I want to search for wireless headphones under $200"}
    ],
    "max_tokens": 200
  }'
```

### Test 5: System Health Monitoring
```bash
# Detailed health check
curl "$API_URL/api/v1/health/detailed"

# Circuit breaker status
curl "$API_URL/api/v1/health/circuit-breakers"
```

## 🔄 Connecting Real LLM Providers

### For OpenAI Integration:
1. Ensure your OpenAI API key is stored in Parameter Store (Step 1 above)
2. The system will automatically use OpenAI when properly configured
3. Monitor costs through the gateway's cost tracking

### For AWS Bedrock Integration:
1. Ensure your Lambda execution role has Bedrock permissions (already configured)
2. The system supports Claude, Llama, and other Bedrock models
3. No additional API keys needed (uses IAM roles)

## 📊 Monitoring and Maintenance

### View Logs
```bash
# Find your Lambda function name
aws lambda list-functions --query 'Functions[?contains(FunctionName, `ai-gateway-full-dev`)].FunctionName'

# View logs (replace with your function name)
aws logs tail "/aws/lambda/your-function-name" --follow
```

### Monitor Costs
- Check CloudWatch metrics for token usage
- Monitor DynamoDB read/write capacity
- Track Lambda invocation costs

### Update Configuration
```bash
# Update OpenAI API key
aws ssm put-parameter \
  --name "/ai-gateway/dev/openai/api-key" \
  --value "new-api-key" \
  --type "SecureString" \
  --overwrite
```

## 🚨 Troubleshooting

### Common Issues:

1. **"Internal Server Error"**
   - Check Lambda logs for detailed error messages
   - Verify IAM permissions for DynamoDB and Parameter Store

2. **"Authentication Failed"**
   - Verify API key exists in DynamoDB
   - Check the exact key format and enabled status

3. **"Provider Unavailable"**
   - Check OpenAI API key in Parameter Store
   - Verify internet connectivity from Lambda

4. **High Costs**
   - Monitor token usage in CloudWatch
   - Implement rate limiting per user
   - Use cost-optimized routing

### Getting Help:
1. Check Lambda logs first
2. Verify DynamoDB table contents
3. Test individual components (health endpoints)
4. Check AWS service limits and quotas

## 🎯 Production Checklist

Before going to production:

- [ ] Set up proper API key management
- [ ] Configure rate limiting per user tier
- [ ] Set up CloudWatch alarms for costs and errors
- [ ] Enable AWS X-Ray tracing for debugging
- [ ] Set up backup strategies for DynamoDB
- [ ] Configure custom domain name
- [ ] Set up staging environment
- [ ] Implement proper logging and monitoring
- [ ] Review security settings and IAM policies
- [ ] Test disaster recovery procedures

## 📞 Support

For issues:
1. Check the troubleshooting section above
2. Review CloudWatch logs and metrics
3. Verify configuration in Parameter Store and DynamoDB
4. Test with the provided test commands

Your AI Model Gateway is now ready for production use! 🚀