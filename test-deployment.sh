#!/bin/bash

# Test script for AI Model Gateway deployment
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get API Gateway URL from CDK outputs
API_URL=$(npx cdk list --json | jq -r '.[] | select(.name | contains("app")) | .outputs.ApiGatewayUrl // empty' | head -1)

if [ -z "$API_URL" ]; then
    echo -e "${RED}❌ Could not find API Gateway URL. Make sure the stack is deployed.${NC}"
    exit 1
fi

echo -e "${GREEN}🧪 Testing AI Model Gateway deployment${NC}"
echo -e "${YELLOW}API URL: $API_URL${NC}"
echo ""

# Test 1: Health Check
echo -e "${YELLOW}Test 1: Basic Health Check${NC}"
HEALTH_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/health_response.json "$API_URL/api/v1/health")
HTTP_CODE="${HEALTH_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Health check passed${NC}"
    cat /tmp/health_response.json | jq .
else
    echo -e "${RED}❌ Health check failed (HTTP $HTTP_CODE)${NC}"
    cat /tmp/health_response.json
fi
echo ""

# Test 2: Detailed Health Check
echo -e "${YELLOW}Test 2: Detailed Health Check${NC}"
DETAILED_HEALTH_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/detailed_health_response.json "$API_URL/api/v1/health/detailed")
HTTP_CODE="${DETAILED_HEALTH_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Detailed health check passed${NC}"
    cat /tmp/detailed_health_response.json | jq .
else
    echo -e "${RED}❌ Detailed health check failed (HTTP $HTTP_CODE)${NC}"
    cat /tmp/detailed_health_response.json
fi
echo ""

# Test 3: Circuit Breaker Status
echo -e "${YELLOW}Test 3: Circuit Breaker Status${NC}"
CB_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/cb_response.json "$API_URL/api/v1/health/circuit-breakers")
HTTP_CODE="${CB_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Circuit breaker check passed${NC}"
    cat /tmp/cb_response.json | jq .
else
    echo -e "${RED}❌ Circuit breaker check failed (HTTP $HTTP_CODE)${NC}"
    cat /tmp/cb_response.json
fi
echo ""

# Test 4: Authentication (should fail without API key)
echo -e "${YELLOW}Test 4: Authentication Test (should fail)${NC}"
AUTH_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/auth_response.json "$API_URL/api/v1/completions" -X POST -H "Content-Type: application/json" -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"Hello"}]}')
HTTP_CODE="${AUTH_RESPONSE: -3}"

if [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✅ Authentication properly rejected unauthorized request${NC}"
    cat /tmp/auth_response.json | jq .
else
    echo -e "${RED}❌ Authentication test unexpected result (HTTP $HTTP_CODE)${NC}"
    cat /tmp/auth_response.json
fi
echo ""

# Test 5: CORS Preflight
echo -e "${YELLOW}Test 5: CORS Preflight${NC}"
CORS_RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/cors_response.json "$API_URL/api/v1/completions" -X OPTIONS -H "Origin: https://example.com" -H "Access-Control-Request-Method: POST")
HTTP_CODE="${CORS_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ CORS preflight handled correctly${NC}"
else
    echo -e "${RED}❌ CORS preflight failed (HTTP $HTTP_CODE)${NC}"
    cat /tmp/cors_response.json
fi
echo ""

echo -e "${GREEN}🎉 Basic deployment tests completed!${NC}"
echo ""
echo -e "${YELLOW}📋 Next Steps for Full Testing:${NC}"
echo "1. Create an API key in DynamoDB"
echo "2. Configure OpenAI/Bedrock credentials"
echo "3. Test LLM completions with valid API key"
echo "4. Test MCP integration with product queries"
echo ""
echo -e "${YELLOW}💡 Useful Commands:${NC}"
echo "  - View logs: aws logs tail /aws/lambda/ai-gateway-dev-app-GatewayHandler --follow"
echo "  - Check DynamoDB tables: aws dynamodb list-tables"
echo "  - Monitor metrics: aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Duration --dimensions Name=FunctionName,Value=ai-gateway-dev-app-GatewayHandler --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) --end-time $(date -u +%Y-%m-%dT%H:%M:%S) --period 300 --statistics Average"

# Cleanup temp files
rm -f /tmp/health_response.json /tmp/detailed_health_response.json /tmp/cb_response.json /tmp/auth_response.json /tmp/cors_response.json