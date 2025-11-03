# AI Model Gateway - Postman Testing Guide

## 🚀 **Quick Start**

### **1. Import Collection & Environment**
1. Open Postman
2. Click **Import** → **Upload Files**
3. Import both files:
   - `AI-Model-Gateway.postman_collection.json`
   - `AI-Model-Gateway.postman_environment.json`
4. Select the **"AI Model Gateway - Development"** environment

### **2. Set Up API Key**
Before running authenticated tests, you need to create an API key:

```bash
# Run the setup script to create test API key
./setup-complete.sh
```

Or manually create one:
```bash
aws dynamodb put-item \
    --table-name ai-gateway-dev-api-keys \
    --item '{
        "apiKeyId": {"S": "test-key-1"},
        "apiKeyHash": {"S": "sk-test123456789abcdef"},
        "userId": {"S": "test-user-1"},
        "tier": {"S": "premium"},
        "createdAt": {"S": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"},
        "active": {"BOOL": true}
    }'
```

## 📋 **Test Collection Overview**

### **🏥 Health & Status Endpoints**
- ✅ **Basic Health Check** - `/health`
- ✅ **API v1 Health Check** - `/api/v1/health`
- ✅ **Detailed Health Check** - `/api/v1/health/detailed`
- ✅ **Circuit Breakers Status** - `/api/v1/health/circuit-breakers`
- ✅ **Metrics Health Check** - `/api/v1/health/metrics`

### **🔐 Authentication Tests**
- ❌ **No API Key (Should Fail)** - Tests authentication requirement
- ❌ **Invalid API Key (Should Fail)** - Tests key validation

### **🤖 LLM Completions**
- ✅ **Basic Completion Request** - Simple GPT-4 completion
- ✅ **Completion with MCP Context** - Product recommendation with context
- ✅ **Different Model** - GPT-3.5-turbo test
- ✅ **Bedrock Model** - Claude-3-sonnet test

### **🔧 Admin Endpoints**
- ✅ **Get Configuration** - System configuration
- ✅ **Update Configuration** - Modify settings
- ✅ **Get Admin Metrics** - Detailed metrics
- ✅ **Circuit Breaker Management** - Status and reset

### **🌐 CORS & Options**
- ✅ **CORS Preflight Tests** - Cross-origin request support

### **⚠️ Error Scenarios**
- ❌ **Invalid JSON Body** - Error handling test
- ❌ **Missing Required Fields** - Validation test
- ❌ **Unsupported Model** - Model validation
- ❌ **404 Non-existent Endpoint** - Route handling

### **🚀 Performance Tests**
- ⚡ **Load Test** - Multiple concurrent requests
- ⚡ **Concurrent Completions** - Performance under load

## 🧪 **Testing Scenarios**

### **Scenario 1: Basic Functionality Test**
Run these requests in order:
1. **Basic Health Check** ✅
2. **Detailed Health Check** ✅
3. **Basic Completion Request** ✅

### **Scenario 2: Authentication Flow**
1. **Completions - No API Key** ❌ (should fail)
2. **Completions - Invalid API Key** ❌ (should fail)
3. **Basic Completion Request** ✅ (with valid key)

### **Scenario 3: MCP Integration Test**
1. **Completion with MCP Context** ✅
2. Check response includes product recommendations

### **Scenario 4: Multi-Provider Test**
1. **Basic Completion Request** (GPT-4) ✅
2. **Completion with Different Model** (GPT-3.5) ✅
3. **Completion with Bedrock Model** (Claude) ✅

### **Scenario 5: Admin Operations**
1. **Get Configuration** ✅
2. **Get Admin Metrics** ✅
3. **Get Circuit Breaker Status** ✅
4. **Update Configuration** ✅

### **Scenario 6: Error Handling**
1. **Invalid JSON Body** ❌
2. **Missing Required Fields** ❌
3. **Unsupported Model** ❌
4. **404 Non-existent Endpoint** ❌

### **Scenario 7: Performance Testing**
1. Run **Load Test - Multiple Health Checks** 10 times
2. Run **Concurrent Completion Requests** 5 times
3. Monitor response times and success rates

## 📊 **Expected Results**

### **✅ Success Responses**
- **Health Endpoints:** `200 OK` with `"status": "healthy"`
- **Completions:** `200 OK` with completion data or `202 Accepted`
- **Admin Endpoints:** `200 OK` with configuration/metrics data

### **❌ Error Responses**
- **No API Key:** `401 Unauthorized` or `403 Forbidden`
- **Invalid API Key:** `401 Unauthorized` or `403 Forbidden`
- **Invalid JSON:** `400 Bad Request`
- **Missing Fields:** `400 Bad Request`
- **Non-existent Endpoint:** `404 Not Found`

### **📈 Performance Expectations**
- **Health Checks:** < 2 seconds
- **Completions:** < 30 seconds (depends on LLM provider)
- **Admin Endpoints:** < 5 seconds

## 🔧 **Customization**

### **Update Environment Variables**
1. Click the **Environment** dropdown
2. Select **"AI Model Gateway - Development"**
3. Click the **eye icon** to view/edit variables:
   - `baseUrl` - Your API Gateway URL
   - `apiKey` - Your test API key
   - `environment` - Current environment (dev/staging/prod)

### **Add New Tests**
1. Right-click on a folder in the collection
2. Select **Add Request**
3. Configure the request and add test scripts

### **Custom Test Scripts**
Example test script for validating response structure:
```javascript
pm.test("Response has expected structure", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('status');
    pm.expect(jsonData).to.have.property('timestamp');
    pm.expect(jsonData).to.have.property('version');
});

pm.test("Response time is acceptable", function () {
    pm.expect(pm.response.responseTime).to.be.below(5000);
});
```

## 🏃‍♂️ **Running Tests**

### **Individual Requests**
1. Select a request from the collection
2. Click **Send**
3. Review the response and test results

### **Collection Runner**
1. Click **Runner** in Postman
2. Select **AI Model Gateway - Complete Test Suite**
3. Choose environment: **AI Model Gateway - Development**
4. Set iterations and delay as needed
5. Click **Run AI Model Gateway**

### **Automated Testing**
Use Newman (Postman CLI) for automated testing:
```bash
# Install Newman
npm install -g newman

# Run the collection
newman run AI-Model-Gateway.postman_collection.json \
    -e AI-Model-Gateway.postman_environment.json \
    --reporters cli,json \
    --reporter-json-export results.json
```

## 📝 **Test Results Interpretation**

### **Green Tests ✅**
- All assertions passed
- Response received within expected time
- Status codes match expectations

### **Red Tests ❌**
- Check the test results tab for specific failures
- Common issues:
  - Network connectivity problems
  - API key not configured
  - Service temporarily unavailable
  - Unexpected response format

### **Performance Monitoring**
- Monitor response times in the test results
- Look for patterns in failures
- Check correlation IDs for request tracking

## 🚨 **Troubleshooting**

### **Authentication Failures**
1. Verify API key is created in DynamoDB
2. Check the API key format (should start with `sk-`)
3. Ensure the key is active and not expired

### **Network Issues**
1. Verify the `baseUrl` in environment variables
2. Check AWS region and API Gateway deployment
3. Test basic connectivity with health endpoints

### **Timeout Issues**
1. Increase timeout in Postman settings
2. Check Lambda function timeout configuration
3. Monitor CloudWatch logs for errors

### **Rate Limiting**
1. Check your API key tier limits
2. Wait between requests if hitting rate limits
3. Monitor the `X-RateLimit-*` headers in responses

## 📊 **Monitoring & Observability**

### **Request Tracking**
- Each request includes a `X-Correlation-ID` header
- Use correlation IDs to track requests in CloudWatch logs
- Monitor request patterns and performance

### **CloudWatch Integration**
- View Lambda function logs: `/aws/lambda/ai-gateway-dev-gateway-handler`
- Monitor API Gateway metrics in CloudWatch
- Set up alarms for error rates and latency

### **Custom Metrics**
- The gateway publishes custom metrics to CloudWatch
- Monitor business metrics like cost per request
- Track provider performance and circuit breaker status

---

## 🎯 **Success Criteria**

Your AI Model Gateway is working correctly when:
- ✅ All health endpoints return `200 OK`
- ✅ Authentication properly blocks unauthorized requests
- ✅ Valid API keys allow access to protected endpoints
- ✅ Completions return valid responses from LLM providers
- ✅ Error scenarios return appropriate error codes
- ✅ Response times are within acceptable limits
- ✅ CORS headers are present for browser compatibility

**Happy Testing! 🚀**