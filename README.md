# AI Model Gateway with MCP Integration

A production-ready AI platform that provides secure, observable, and cost-efficient access to multiple LLM providers while integrating e-commerce product data through the Model Context Protocol (MCP).

## 🏗️ Architecture Overview

This project demonstrates enterprise-grade AI platform engineering with:

- **Multi-Provider LLM Gateway**: Unified API for OpenAI, AWS Bedrock, and local models
- **MCP Integration**: Seamless connection between LLMs and e-commerce product data
- **Infrastructure as Code**: Complete AWS deployment using CDK with TypeScript
- **Production Observability**: Comprehensive monitoring, logging, and alerting
- **Cost Optimization**: Intelligent caching, rate limiting, and request batching
- **Security First**: End-to-end encryption, authentication, and audit trails

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- AWS CLI configured with appropriate credentials
- AWS CDK CLI installed globally

### Installation

```bash
# Clone and install dependencies
npm install

# Bootstrap CDK (first time only)
npm run bootstrap

# Build the project
npm run build
```

### Development

```bash
# Watch mode for development
npm run watch

# Run tests
npm test

# Lint and format code
npm run lint
npm run format

# Deploy to development environment
npm run deploy:dev
```

## 🏭 Production Deployment

```bash
# Deploy to production
ENVIRONMENT=prod npm run deploy:prod

# View deployment differences
npm run diff

# Destroy resources (careful!)
npm run destroy
```

## 📊 Key Features

### Multi-Provider Support
- **OpenAI Integration**: GPT-4, GPT-3.5-turbo with streaming support
- **AWS Bedrock**: Claude, Llama2, and other foundation models
- **Intelligent Routing**: Cost and latency-based provider selection
- **Automatic Failover**: Circuit breaker pattern with exponential backoff

### MCP Protocol Implementation
- **Product Data Integration**: Real-time e-commerce product information
- **Structured Search**: Category, price, and availability filtering
- **Context-Aware Responses**: LLM responses enriched with product data
- **WebSocket Support**: Real-time MCP communication

### Production-Grade Infrastructure
- **Auto-Scaling**: Lambda functions with reserved concurrency
- **High Availability**: Multi-AZ deployment with Redis clustering
- **Security**: VPC isolation, encryption at rest and in transit
- **Monitoring**: CloudWatch dashboards, X-Ray tracing, automated alerts

## 🛠️ Development Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run watch` | Watch for changes and compile |
| `npm run test` | Run Jest unit tests |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Run ESLint for code quality |
| `npm run format` | Format code with Prettier |
| `npm run cdk` | Run CDK commands |
| `npm run synth` | Synthesize CloudFormation templates |

## 📁 Project Structure

```
ai-model-gateway/
├── bin/                    # CDK app entry point
├── lib/                    # CDK stack definitions
├── config/                 # Environment configurations
├── src/                    # Lambda function source code
├── test/                   # Unit and integration tests
├── docs/                   # Documentation
└── scripts/                # Deployment and utility scripts
```

## 🔧 Configuration

Environment-specific configurations are managed in `config/environments.ts`:

- **Development**: Debug logging, relaxed CORS, lower rate limits
- **Production**: Info logging, strict CORS, production rate limits

## 🔐 Security Features

- **API Key Authentication**: Secure API access with revocable keys
- **Rate Limiting**: Per-user and per-API-key throttling
- **Input Validation**: Comprehensive request validation with Zod
- **Audit Logging**: Complete audit trail for security events
- **Encryption**: TLS 1.3 in transit, KMS encryption at rest

## 📈 Monitoring & Observability

- **Custom Metrics**: Latency, throughput, error rates, and costs
- **Dashboards**: Real-time operational visibility
- **Alerting**: Automated notifications for SLA breaches
- **Tracing**: End-to-end request flow with X-Ray
- **Structured Logging**: JSON logs with correlation IDs

## 💰 Cost Optimization

- **Intelligent Caching**: Redis-based response caching with TTL
- **Request Batching**: Optimize provider API usage
- **Provider Selection**: Cost-aware routing algorithms
- **Resource Optimization**: Right-sized Lambda functions and DynamoDB

## 🧪 Testing Strategy

- **Unit Tests**: Core business logic with mocked dependencies
- **Integration Tests**: End-to-end API testing
- **Load Testing**: Performance validation under load
- **Security Testing**: Authentication and input validation

## 📚 Documentation

- [Architecture Decision Records](docs/adr/)
- [API Documentation](docs/api/)
- [Deployment Guide](docs/deployment.md)
- [Monitoring Runbook](docs/monitoring.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Run linting and formatting
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.
