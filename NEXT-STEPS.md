# AI Model Gateway - Next Steps

## 🎯 **Remaining Tasks to Complete the Project**

### 1. **🔑 Configure OpenAI API Key (CRITICAL)**
```bash
# Replace 'your-actual-openai-key' with your real OpenAI API key
aws secretsmanager update-secret \
  --secret-id "ai-gateway-dev/openai-api-key" \
  --secret-string '{"apiKey":"sk-your-actual-openai-key-here"}'
```

**Why needed:** The Lambda functions need this to call OpenAI's API for LLM completions.

### 2. **🔐 Create Test API Keys**
```bash
# Create a test API key for authentication
aws dynamodb put-item \
  --table-name "ai-gateway-dev-api-keys" \
  --item '{
    "apiKeyId": {"S": "test-key-123"},
    "userId": {"S": "test-user-001"},
    "tier": {"S": "free"},
    "apiKeyHash": {"S": "test-key-123"},
    "createdAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"},
    "permissions": {"SS": ["completions", "health"]},
    "active": {"BOOL": true}
  }'

# Create a premium tier key
aws dynamodb put-item \
  --table-name "ai-gateway-dev-api-keys" \
  --item '{
    "apiKeyId": {"S": "premium-key-456"},
    "userId": {"S": "premium-user-001"},
    "tier": {"S": "premium"},
    "apiKeyHash": {"S": "premium-key-456"},
    "createdAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"},
    "permissions": {"SS": ["completions", "health", "admin"]},
    "active": {"BOOL": true}
  }'
```

### 3. **🛍️ Add Sample Product Data (MCP Integration)**
```bash
# Add sample products for MCP context injection
aws dynamodb put-item \
  --table-name "ai-gateway-dev-product-catalog" \
  --item '{
    "productId": {"S": "prod-001"},
    "name": {"S": "Wireless Bluetooth Headphones"},
    "category": {"S": "Electronics"},
    "price": {"N": "99.99"},
    "brand": {"S": "TechCorp"},
    "availability": {"S": "in-stock"},
    "description": {"S": "High-quality wireless headphones with noise cancellation"},
    "rating": {"N": "4.5"}
  }'

aws dynamodb put-item \
  --table-name "ai-gateway-dev-product-catalog" \
  --item '{
    "productId": {"S": "prod-002"},
    "name": {"S": "Smart Fitness Watch"},
    "category": {"S": "Wearables"},
    "price": {"N": "299.99"},
    "brand": {"S": "FitTech"},
    "availability": {"S": "in-stock"},
    "description": {"S": "Advanced fitness tracking with heart rate monitor"},
    "rating": {"N": "4.8"}
  }'

aws dynamodb put-item \
  --table-name "ai-gateway-dev-product-catalog" \
  --item '{
    "productId": {"S": "prod-003"},
    "name": {"S": "Organic Coffee Beans"},
    "category": {"S": "Food"},
    "price": {"N": "24.99"},
    "brand": {"S": "BrewMaster"},
    "availability": {"S": "limited"},
    "description": {"S": "Premium organic coffee beans from Colombia"},
    "rating": {"N": "4.7"}
  }'
```

### 4. **🧪 Test All Endpoints**

#### Test Health Endpoints (No Auth Required)
```bash
# Basic health check
curl -X GET "https://wegkfrv0gh.execute-api.us-east-1.amazonaws.com/v1/health"

# Detailed health check
curl -X GET "https://wegkfrv0gh.execute-api.us-east-1.amazonaws.com/v1/api/v1/health/detailed"
```

#### Test Authenticated Endpoints
```bash
# Test completions endpoint with free tier key
curl -X POST "https://wegkfrv0gh.execute-api.us-east-1.amazonaws.com/v1/api/v1/completions" \
  -H "X-API-Key: test-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "What wireless headphones do you recommend?"}
    ],
    "max_tokens": 150,
    "temperature": 0.7
  }'

# Test with MCP context injection (should include product info)
curl -X POST "https://wegkfrv0gh.execute-api.us-east-1.amazonaws.com/v1/api/v1/completions" \
  -H "X-API-Key: premium-key-456" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "I need a fitness tracker under $300. What do you recommend?"}
    ],
    "max_tokens": 200,
    "temperature": 0.5
  }'
```

### 5. **🔔 Configure Alert Notifications**
```bash
# Subscribe to operational alerts
aws sns subscribe \
  --topic-arn "arn:aws:sns:us-east-1:084828566306:ai-gateway-dev-observability-AlertTopic2720D535-80r6Bt6UnX5N" \
  --protocol email \
  --notification-endpoint "your-email@example.com"

# Subscribe to security alerts
aws sns subscribe \
  --topic-arn "arn:aws:sns:us-east-1:084828566306:ai-gateway-dev-observability-SecurityAlertTopic8D84EA7A-I9oE3ZjlqwjF" \
  --protocol email \
  --notification-endpoint "security-team@example.com"
```

### 6. **📊 Access Monitoring Dashboards**

Open these URLs in your browser:

- **Operational Dashboard:** https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=AI-Model-Gateway-Operations
- **Security Dashboard:** https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=AI-Model-Gateway-Security  
- **Business Dashboard:** https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=AI-Model-Gateway-Business

### 7. **🔍 Verify WAF Protection**
```bash
# Test rate limiting (should block after 2000 requests in 5 minutes)
for i in {1..10}; do
  curl -X GET "https://wegkfrv0gh.execute-api.us-east-1.amazonaws.com/v1/health"
  echo "Request $i completed"
done
```

### 8. **📝 Update Documentation**
- [ ] Update README.md with API usage examples
- [ ] Document authentication flow
- [ ] Add troubleshooting guide
- [ ] Create API reference documentation

## ✅ **Success Criteria**
- [ ] Health endpoints return 200 OK
- [ ] Authentication works with API keys
- [ ] LLM completions work with OpenAI
- [ ] MCP context injection includes product data
- [ ] WAF blocks malicious requests
- [ ] Monitoring dashboards show metrics
- [ ] Alerts are received via email

## 🚨 **Important Notes**
1. **Replace placeholder values** with real data (API keys, email addresses)
2. **Test in order** - start with health checks, then authentication
3. **Monitor costs** - OpenAI API calls will incur charges
4. **Security** - Never commit real API keys to version control

## 📞 **Support**
If you encounter issues:
1. Check CloudWatch logs for Lambda functions
2. Verify DynamoDB table contents
3. Test individual components in isolation
4. Review WAF logs for blocked requests