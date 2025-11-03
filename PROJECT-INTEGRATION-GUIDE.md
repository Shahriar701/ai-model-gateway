# AI Model Gateway - Complete Integration Guide

## 🎯 **Project Overview**
This is a **production-grade AI Model Gateway** that routes requests to multiple LLM providers (OpenAI, AWS Bedrock) with enterprise security, authentication, rate limiting, and MCP (Model Context Protocol) integration for e-commerce context injection.

---

## 🏗️ **Architecture Overview**

### **High-Level Flow:**
```
Client Request → API Gateway → WAF → Lambda Authorizer → Main Lambda → LLM Provider → Response
                     ↓
                DynamoDB Tables (API Keys, Products, Logs)
                     ↓
                CloudWatch (Metrics, Logs, Alarms)
```

---

## 📁 **Project Structure Deep Dive**

### **1. Infrastructure (CDK)**

#### **`lib/ai-model-gateway-stack.ts`** - Main Infrastructure Stack
**Lines 1-15:** Imports and interfaces
- Defines `GatewayResources` interface with all deployed resources
- `AiModelGatewayStackProps` for configuration

**Lines 50-80:** Constructor and resource creation flow
```typescript
// 1. Create security resources (KMS, Secrets, WAF, IAM)
const securityResources = this.createSecurityResources(resourcePrefix);

// 2. Create data resources (DynamoDB tables with encryption)  
const dataResources = this.createDataResources(resourcePrefix, securityResources.kmsKey);

// 3. Create Lambda functions
const computeResources = this.createComputeResources(resourcePrefix, securityAndDataResources, props);

// 4. Create API Gateway with routes
const apiGatewayResources = this.createApiGatewayResources(resourcePrefix, computeResources, props);
```

**Lines 95-180:** `createSecurityResources()` method
- **KMS Key** (lines 105-110): Customer-managed encryption for all data
- **Secrets Manager** (lines 112-125): Secure OpenAI API key storage
- **WAF Web ACL** (lines 127-175): API protection with rate limiting and attack prevention
- **IAM Role** (lines 177-185): Lambda execution role with basic permissions

**Lines 190-280:** `createDataResources()` method
- **API Key Table** (lines 200-220): Stores user API keys and permissions
  - GSI: `UserIdGlobalSecondaryIndex` for user-based queries
  - GSI: `ApiKeyLookupGlobalSecondaryIndex` for key validation
- **Product Catalog Table** (lines 230-260): MCP product data
  - GSI: `CategoryPriceGlobalSecondaryIndex` for category searches
  - GSI: `BrandAvailabilityGlobalSecondaryIndex` for brand filtering
- **Request Log Table** (lines 270-290): Analytics and audit logs
  - GSI: `UserAnalyticsGlobalSecondaryIndex` for user metrics
  - TTL enabled for automatic cleanup

**Lines 300-420:** `createComputeResources()` method
- **Main Gateway Lambda** (lines 310-380): Handles all API requests
  - Environment variables for configuration (lines 340-375)
  - Feature flags, provider settings, rate limits
- **Authorizer Lambda** (lines 385-415): API Gateway custom authorizer
  - Validates API keys and injects user context

**Lines 430-520:** `createApiGatewayResources()` method
- **REST API** (lines 440-480): Professional configuration with CORS
- **Custom Authorizer** (lines 485-495): Token-based with caching
- **Lambda Integration** (lines 500-510): Connects API Gateway to Lambda

**Lines 530-600:** `createApiResourceStructure()` method
- **Health endpoints** (lines 540-550): `/health`, `/api/v1/health/*`
- **Completions endpoint** (lines 570-580): `/api/v1/completions` (authenticated)
- **Admin endpoints** (lines 585-595): Configuration and metrics
- **Catch-all proxy** (lines 598): Handles unmatched routes

**Lines 610-680:** `addIamPolicies()` method
- **DynamoDB permissions** (lines 620-635): Table and index access
- **KMS permissions** (lines 640-650): Encryption/decryption
- **Secrets Manager** (lines 655-665): API key retrieval
- **Bedrock access** (lines 670-680): AWS LLM models
- **CloudWatch metrics** (lines 685-695): Custom metrics publishing

#### **`lib/observability-stack.ts`** - Monitoring and Alerting
**Lines 1-25:** Imports and interfaces
- Depends on main stack resources via `GatewayResources`

**Lines 30-60:** SNS Topics for alerts
- `AlertTopic`: Operational alerts (errors, latency)
- `SecurityAlertTopic`: Security events (auth failures, attacks)

**Lines 70-150:** CloudWatch Dashboards
- **Operational Dashboard**: API metrics, Lambda performance, DynamoDB throttling
- **Security Dashboard**: Authentication metrics, security events
- **Business Dashboard**: Usage trends, cost metrics, cache performance

**Lines 160-250:** CloudWatch Metrics definitions
- **API Gateway metrics** (lines 170-190): Request count, latency, errors
- **Lambda metrics** (lines 200-230): Invocations, errors, duration
- **DynamoDB metrics** (lines 240-250): Throttling events

**Lines 260-350:** CloudWatch Alarms
- **High error rate** (lines 270-280): 5XX errors > 10 in 2 periods
- **High latency** (lines 290-300): Latency > 5 seconds for 3 periods
- **Lambda errors** (lines 310-330): Function-specific error thresholds
- **Security events** (lines 340-350): Critical security alerts

---

### **2. Lambda Functions**

#### **`dist/src/lambda/gateway/handler.js`** - Main Request Handler
**Lines 1-30:** Imports and service initialization
- Imports all services: auth, routing, providers, MCP, monitoring
- Initializes singleton services for performance

**Lines 40-80:** Provider configuration
- **OpenAI Provider** (lines 45-55): Configuration with retry logic
- **Bedrock Provider** (lines 60-75): AWS native LLM access
- **Router setup** (lines 78): Intelligent provider selection

**Lines 90-150:** Main handler function
- **Correlation ID** (lines 95): Request tracking across services
- **CORS handling** (lines 105-115): Preflight request support
- **Security middleware** (lines 120-140): Input validation and sanitization
- **Authentication** (lines 145): API key validation

**Lines 160-200:** Request routing
- **Health endpoints** (lines 165-175): System status checks
- **Admin endpoints** (lines 180-190): Configuration management
- **Completions** (lines 195): Main LLM processing

**Lines 210-300:** `handleCompletions()` function
- **Request validation** (lines 220-230): JSON parsing and schema validation
- **MCP context injection** (lines 240-260): Product data enhancement
- **Provider routing** (lines 270-290): Intelligent LLM selection
- **Response caching** (lines 295): Performance optimization

#### **`dist/src/lambda/authorizer/index.js`** - API Gateway Authorizer
**Lines 1-20:** Imports and initialization
- API key service for validation
- Logger for security events

**Lines 30-80:** Main authorizer handler
- **API key extraction** (lines 35-45): From authorization header
- **Key validation** (lines 50-65): Database lookup and verification
- **Policy generation** (lines 70-80): IAM policy for API Gateway

**Lines 90-120:** Helper functions
- **`extractApiKey()`** (lines 95-105): Supports multiple auth formats
- **`generatePolicy()`** (lines 110-120): Creates allow/deny policies
- **Rate limit context** (lines 115): Injects user tier information

---

### **3. Core Services**

#### **Authentication Flow:**
1. **Client sends request** with `X-API-Key` header
2. **API Gateway** calls Lambda Authorizer (`dist/src/lambda/authorizer/index.js`)
3. **Authorizer validates key** against DynamoDB (`ai-gateway-dev-api-keys` table)
4. **Policy returned** to API Gateway (Allow/Deny)
5. **Main Lambda receives** authenticated request with user context

#### **MCP Integration Flow:**
1. **Request received** in main Lambda handler
2. **MCP service** (`src/services/mcp/`) analyzes request content
3. **Product search** performed against `ai-gateway-dev-product-catalog` table
4. **Context injection** adds relevant product data to LLM prompt
5. **Enhanced request** sent to LLM provider

#### **Rate Limiting:**
- **WAF level** (lines 140-155 in stack): 2000 requests per 5 minutes per IP
- **Application level**: Based on user tier (free: 10/min, premium: 1000/min)
- **DynamoDB tracking**: Request counts stored in `ai-gateway-dev-request-analytics`

---

### **4. Data Models**

#### **API Key Table Schema** (`ai-gateway-dev-api-keys`)
```json
{
  "apiKeyId": "unique-key-identifier",
  "userId": "user-identifier", 
  "tier": "free|basic|premium|enterprise",
  "apiKeyHash": "hashed-api-key-value",
  "createdAt": "2024-01-01T00:00:00Z",
  "permissions": ["completions", "health", "admin"],
  "active": true,
  "rateLimit": {
    "requestsPerMinute": 10,
    "requestsPerHour": 100
  }
}
```

#### **Product Catalog Schema** (`ai-gateway-dev-product-catalog`)
```json
{
  "productId": "prod-001",
  "name": "Product Name",
  "category": "Electronics|Food|Wearables",
  "price": 99.99,
  "brand": "Brand Name",
  "availability": "in-stock|limited|out-of-stock",
  "description": "Product description",
  "rating": 4.5
}
```

#### **Request Log Schema** (`ai-gateway-dev-request-analytics`)
```json
{
  "requestId": "unique-request-id",
  "timestamp": "2024-01-01T00:00:00Z",
  "userId": "user-identifier",
  "model": "gpt-4",
  "tokens": 150,
  "cost": 0.003,
  "latency": 1200,
  "provider": "openai",
  "expirationTimestamp": 1704067200
}
```

---

### **5. Security Implementation**

#### **Encryption at Rest:**
- **KMS Key** (created in lines 105-110): Customer-managed encryption
- **DynamoDB tables** (lines 210, 240, 280): Encrypted with KMS key
- **Secrets Manager** (lines 120): OpenAI API key encrypted

#### **Encryption in Transit:**
- **API Gateway**: HTTPS only
- **Lambda to services**: AWS SDK uses TLS
- **WAF protection**: Blocks malicious requests

#### **Access Control:**
- **IAM roles** (lines 610-680): Least-privilege access
- **API key authentication**: Custom authorizer validation
- **Resource policies**: Restrict access to specific resources

#### **WAF Rules** (lines 140-175):
1. **Rate limiting**: 2000 requests per 5 minutes per IP
2. **Common attacks**: SQL injection, XSS protection
3. **Known bad inputs**: Malicious payload detection

---

### **6. Monitoring and Observability**

#### **CloudWatch Metrics:**
- **Custom namespace**: `AiModelGateway`
- **API Gateway**: Request count, latency, errors
- **Lambda**: Invocations, errors, duration
- **DynamoDB**: Throttling, consumed capacity

#### **Alarms and Alerts:**
- **High error rate**: > 10 5XX errors in 10 minutes
- **High latency**: > 5 seconds average for 15 minutes
- **Security events**: Failed authentication attempts
- **Cost alerts**: > $100 per hour

#### **Dashboards:**
- **Operational**: System health and performance
- **Security**: Authentication and threat metrics  
- **Business**: Usage trends and cost analysis

---

### **7. Configuration Management**

#### **Environment Variables** (lines 340-375 in stack):
```typescript
ENVIRONMENT: props.environment,
API_KEY_TABLE_NAME: dataResources.apiKeyDynamoDbTable.tableName,
OPENAI_PROVIDER_ENABLED: 'true',
RATE_LIMIT_FREE_TIER_RPM: '10',
CIRCUIT_BREAKER_FAILURE_THRESHOLD: '5'
```

#### **SSM Parameters** (lines 650-670):
- Configuration values stored in Parameter Store
- Environment-specific settings
- Feature flags and operational parameters

---

### **8. Deployment Process**

#### **CDK App** (`bin/ai-model-gateway.ts`):
1. **Environment validation** (lines 20-30)
2. **Main stack deployment** (lines 65-80)
3. **Observability stack** (lines 85-95) - depends on main stack
4. **Resource tagging** (lines 70-78) for cost tracking

#### **Build Process:**
1. **TypeScript compilation**: `npm run build`
2. **Lambda packaging**: CDK handles asset bundling
3. **CloudFormation deployment**: `cdk deploy`

---

## 🔄 **Request Flow Example**

### **Completions Request:**
1. **Client** → `POST /api/v1/completions` with `X-API-Key`
2. **WAF** → Checks rate limits and malicious patterns
3. **API Gateway** → Calls Lambda Authorizer
4. **Authorizer** → Validates API key in DynamoDB
5. **API Gateway** → Routes to main Lambda with user context
6. **Main Lambda** → Validates request, injects MCP context
7. **Provider Router** → Selects optimal LLM provider
8. **LLM Provider** → Processes enhanced request
9. **Response** → Cached and returned to client
10. **Analytics** → Request logged to DynamoDB

---

## 🚀 **Getting Started as New Developer**

1. **Read this guide** to understand architecture
2. **Review CDK stack** (`lib/ai-model-gateway-stack.ts`) for infrastructure
3. **Examine Lambda handlers** (`dist/src/lambda/`) for business logic
4. **Check service implementations** (`src/services/`) for core functionality
5. **Follow NEXT-STEPS.md** to configure and test
6. **Monitor dashboards** to understand system behavior
7. **Review logs** in CloudWatch for troubleshooting

---

## 📚 **Key Files Reference**

| File | Purpose | Key Lines |
|------|---------|-----------|
| `lib/ai-model-gateway-stack.ts` | Infrastructure definition | 95-180 (security), 300-420 (compute) |
| `lib/observability-stack.ts` | Monitoring setup | 160-250 (metrics), 260-350 (alarms) |
| `dist/src/lambda/gateway/handler.js` | Main request processing | 90-150 (handler), 210-300 (completions) |
| `dist/src/lambda/authorizer/index.js` | Authentication | 30-80 (validation), 90-120 (policies) |
| `bin/ai-model-gateway.ts` | Deployment configuration | 65-95 (stack creation) |

This guide provides the foundation to understand and work with the AI Model Gateway project effectively!