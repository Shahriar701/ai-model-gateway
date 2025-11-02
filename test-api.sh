#!/bin/bash

# API Testing Script for AI Model Gateway
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
API_URL="${API_URL:-}"
API_KEY="${API_KEY:-ak_test_1234567890abcdef1234567890abcdef}"

if [ -z "$API_URL" ]; then
    echo -e "${RED}❌ Please set API_URL environment variable${NC}"
    echo "Example: export API_URL=https://your-api-gateway-url.amazonaws.com"
    exit 1
fi

echo -e "${BLUE}🧪 AI Model Gateway API Testing${NC}"
echo -e "${YELLOW}API URL: $API_URL${NC}"
echo -e "${YELLOW}API Key: ${API_KEY:0:10}...${NC}"
echo ""

# Test 1: Simple LLM Request
echo -e "${YELLOW}Test 1: Simple LLM Completion${NC}"
curl -X POST "$API_URL/api/v1/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Say hello in a friendly way"}
    ],
    "max_tokens": 50,
    "temperature": 0.7
  }' | jq .
echo ""

# Test 2: MCP Product Search
echo -e "${YELLOW}Test 2: MCP Product Search Integration${NC}"
curl -X POST "$API_URL/api/v1/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "I want to search for wireless headphones under $200"}
    ],
    "max_tokens": 300,
    "temperature": 0.3
  }' | jq .
echo ""

# Test 3: Complex Product Query
echo -e "${YELLOW}Test 3: Complex Product Query with MCP${NC}"
curl -X POST "$API_URL/api/v1/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [
      {"role": "user", "content": "Show me the best smartwatches in the Electronics category with good ratings"}
    ],
    "max_tokens": 400,
    "temperature": 0.2
  }' | jq .
echo ""

# Test 4: Rate Limiting (multiple requests)
echo -e "${YELLOW}Test 4: Rate Limiting Test (5 rapid requests)${NC}"
for i in {1..5}; do
    echo -e "${BLUE}Request $i:${NC}"
    curl -X POST "$API_URL/api/v1/completions" \
      -H "Content-Type: application/json" \
      -H "X-API-Key: $API_KEY" \
      -w "HTTP Status: %{http_code}, Time: %{time_total}s\n" \
      -s -o /dev/null \
      -d '{
        "model": "gpt-3.5-turbo",
        "messages": [
          {"role": "user", "content": "Quick test message"}
        ],
        "max_tokens": 10
      }'
    sleep 1
done
echo ""

# Test 5: Error Handling
echo -e "${YELLOW}Test 5: Error Handling (Invalid Model)${NC}"
curl -X POST "$API_URL/api/v1/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "model": "invalid-model",
    "messages": [
      {"role": "user", "content": "This should fail"}
    ]
  }' | jq .
echo ""

# Test 6: Caching Test
echo -e "${YELLOW}Test 6: Response Caching Test (Same Request Twice)${NC}"
REQUEST_PAYLOAD='{
  "model": "gpt-3.5-turbo",
  "messages": [
    {"role": "user", "content": "What is 2+2? Give a very short answer."}
  ],
  "max_tokens": 20,
  "temperature": 0
}'

echo -e "${BLUE}First request (should hit provider):${NC}"
curl -X POST "$API_URL/api/v1/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -w "Time: %{time_total}s\n" \
  -d "$REQUEST_PAYLOAD" | jq '.gateway_metadata.cached // false'

echo -e "${BLUE}Second request (should be cached):${NC}"
curl -X POST "$API_URL/api/v1/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -w "Time: %{time_total}s\n" \
  -d "$REQUEST_PAYLOAD" | jq '.gateway_metadata.cached // false'
echo ""

echo -e "${GREEN}🎉 API testing completed!${NC}"
echo ""
echo -e "${YELLOW}📊 Check the following for detailed analysis:${NC}"
echo "1. CloudWatch metrics for latency and error rates"
echo "2. Circuit breaker status: curl $API_URL/api/v1/health/circuit-breakers"
echo "3. Detailed health: curl $API_URL/api/v1/health/detailed"
echo "4. Lambda logs for detailed request traces"