# AI Model Gateway

🚀 **Production-ready AI model gateway** with unified access to multiple LLM providers, authentication, rate limiting, MCP integration, and comprehensive monitoring.

## ✨ Features

- **🤖 Multi-Provider Support**: OpenAI, AWS Bedrock with intelligent routing
- **🔐 Authentication**: API key management with tiered access control  
- **⚡ Rate Limiting**: Configurable limits per user tier
- **💰 Cost Optimization**: Real-time cost tracking and optimization
- **🛍️ MCP Integration**: Product search and e-commerce context injection
- **📊 Observability**: Comprehensive logging, metrics, and tracing
- **🔄 Circuit Breakers**: Automatic failover and error handling
- **🚦 Request Batching**: Intelligent request optimization

## 🚀 Quick Start (5 Minutes)

```bash
# 1. Deploy the gateway
cd ai-model-gateway
./deploy-full.sh

# 2. Test it works
curl "https://your-api-gateway-url/health"
```

**That's it!** Your AI Model Gateway is running.

## 📋 Complete Setup

For full configuration with OpenAI integration, API keys, and product data:

👉 **[Follow the Complete Setup Instructions](./SETUP_INSTRUCTIONS.md)**

## 🧪 Test Your Deployment

```bash
# Health check
curl "https://your-api-url/health"

# Test with API key
curl -X POST "https://your-api-url/api/v1/completions" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"Hello!"}]}'
```

## 🏗️ Architecture

```
API Gateway → Lambda Handler → LLM Providers (OpenAI/Bedrock)
     ↓              ↓
DynamoDB Tables   Monitoring & Caching
```

## 📁 Project Structure

**Essential Files:**
- `SETUP_INSTRUCTIONS.md` - Complete setup guide
- `deploy-full.sh` - Main deployment script  
- `bin/ai-model-gateway-deploy.ts` - CDK deployment configuration
- `src/` - Full TypeScript implementation (47 completed tasks)

## 🎯 What's Deployed

✅ **All 47 tasks completed** including:
- Authentication & API key management
- Rate limiting with multiple tiers
- OpenAI & Bedrock provider integration
- MCP product search integration  
- Circuit breakers & error handling
- Comprehensive monitoring & health checks
- Request caching & optimization
- Security logging & compliance

## 📞 Support

1. Check `SETUP_INSTRUCTIONS.md` for detailed configuration
2. View Lambda logs: `aws logs tail /aws/lambda/your-function-name --follow`
3. Test health endpoints: `/health`, `/api/v1/health/detailed`

## 🎉 Ready for Production

Your AI Model Gateway includes enterprise-grade features and is ready for production use with proper configuration following the setup instructions.

---

**Next Step**: Open `SETUP_INSTRUCTIONS.md` for complete configuration! 🚀