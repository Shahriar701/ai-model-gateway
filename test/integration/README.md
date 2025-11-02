# Integration Tests for AI Model Gateway

This directory contains comprehensive integration tests for the AI Model Gateway system, covering all major components and their interactions.

## Overview

The integration tests validate the complete system functionality including:

- **System Integration**: Gateway handler with provider router, MCP server, and caching
- **Authentication & Authorization**: API key validation across all endpoints
- **MCP E-commerce Scenarios**: Product search workflows and LLM integration
- **Load Testing**: Concurrent requests and performance validation
- **Provider Failover**: Disaster recovery and circuit breaker scenarios
- **Security Controls**: Input validation, rate limiting, and compliance
- **Configuration Management**: Feature flags and hot reloading
- **Observability**: Monitoring, metrics, and health checks

## Test Structure

### Test Files

1. **`system-integration.test.ts`**
   - Complete system integration tests
   - Authentication and authorization validation
   - Observability and monitoring verification
   - Configuration management integration
   - CORS and security middleware testing

2. **`mcp-ecommerce-scenarios.test.ts`**
   - Product search workflows through LLM requests
   - MCP context integration and formatting validation
   - Real-time inventory and pricing updates
   - E-commerce conversation flows
   - Product recommendations and comparisons

3. **`comprehensive-system.test.ts`**
   - Load testing with concurrent requests
   - Provider failover and disaster recovery
   - Security controls and compliance validation
   - Configuration changes and feature flag rollouts
   - Performance benchmarking and SLA validation

### Support Files

1. **`test-config.ts`**
   - Test environment setup and configuration
   - API key management for tests
   - Feature flag creation and management
   - Test data generators and utilities

2. **`run-integration-tests.ts`**
   - Test runner orchestration
   - Environment setup and teardown
   - Test reporting and analysis
   - Performance metrics collection

3. **`setup.ts`**
   - Global test setup and teardown
   - Environment variable configuration
   - Test timeout and cleanup settings

## Running Tests

### Prerequisites

1. **AWS Credentials**: Ensure AWS credentials are configured for DynamoDB, Parameter Store, and other AWS services
2. **Redis**: Redis server should be available for caching tests
3. **Environment Variables**: Set required environment variables for test configuration

### Test Commands

```bash
# Run all integration tests
npm run test:integration:all

# Run specific test categories
npm run test:integration:system      # System integration tests
npm run test:integration:mcp         # MCP e-commerce scenarios
npm run test:integration:comprehensive # Comprehensive system tests

# Run with Jest directly
npm run test:integration
```

### Test Configuration

The tests use a separate Jest configuration (`jest.integration.config.js`) with:

- **Sequential Execution**: Tests run one at a time to avoid conflicts
- **Extended Timeouts**: 60-second timeout for integration tests
- **Custom Sequencer**: Optimal test execution order
- **Coverage Reporting**: Integration-specific coverage reports

## Test Scenarios

### 11.1 Complete System Integration

**Objective**: Verify all components work together correctly

**Test Cases**:
- Gateway handler integration with provider router, MCP server, and caching
- Authentication and authorization across all endpoints
- Observability and monitoring functionality end-to-end
- Configuration management integration with all services
- CORS preflight request handling
- Rate limiting enforcement

**Success Criteria**:
- All API endpoints respond correctly with proper authentication
- MCP context is injected into LLM requests
- Caching and rate limiting work as expected
- Health checks return accurate system status
- Configuration changes propagate correctly

### 11.2 MCP E-commerce Scenarios

**Objective**: Validate MCP integration with e-commerce use cases

**Test Cases**:
- Product search workflows through LLM requests
- LLM responses with product context integration
- Real-time inventory and pricing updates
- E-commerce conversation flows with recommendations
- Complex product comparison scenarios
- Structured product data in responses

**Success Criteria**:
- LLM responses contain relevant product information
- MCP tools are executed correctly for product queries
- Product recommendations are contextually appropriate
- Inventory and pricing data is current and accurate
- Conversation flows maintain context across multiple turns

### 11.3 Comprehensive System Testing

**Objective**: Validate system performance, reliability, and security

**Test Cases**:
- **Load Testing**: Concurrent requests with multiple providers
- **Failover Testing**: Provider failures and circuit breaker scenarios
- **Security Testing**: Input validation, XSS prevention, authentication
- **Configuration Testing**: Feature flag rollouts and A/B testing
- **Performance Testing**: SLA compliance and optimization
- **Monitoring Testing**: Health checks, metrics, and incident reporting

**Success Criteria**:
- System maintains >80% success rate under load
- Provider failover works automatically
- Security controls prevent malicious input
- Feature flags roll out correctly with proper targeting
- Performance meets SLA requirements (P95 < 2s)
- Monitoring provides accurate system visibility

## Test Data Management

### API Keys
- Test API keys are created for different tiers (basic, premium, enterprise)
- Keys are automatically cleaned up after test completion
- Each test uses isolated API keys to prevent interference

### Feature Flags
- Test-specific feature flags are created and managed
- Flags support percentage rollouts and A/B testing scenarios
- Automatic cleanup prevents flag accumulation

### Configuration
- Test configurations are isolated from production
- Hot reloading is tested with temporary configurations
- All test configurations are cleaned up automatically

## Performance Benchmarks

### Expected Performance Metrics

| Metric | Target | Test Validation |
|--------|--------|-----------------|
| Response Time (P95) | < 2s | Load testing scenarios |
| Throughput | 1000 req/s | Concurrent request tests |
| Success Rate | > 99% | Error handling validation |
| Failover Time | < 5s | Provider failover tests |
| Cache Hit Rate | > 80% | Caching effectiveness tests |

### Load Testing Results

The integration tests include load testing scenarios that validate:

- **Concurrent Processing**: 10+ simultaneous requests
- **Sustained Load**: Multiple batches with performance monitoring
- **Rate Limiting**: Proper enforcement across user tiers
- **Resource Utilization**: Memory and CPU usage under load

## Security Validation

### Security Test Coverage

1. **Input Validation**
   - SQL injection prevention
   - XSS attack mitigation
   - Command injection protection

2. **Authentication & Authorization**
   - API key validation
   - Invalid key rejection
   - Expired key handling

3. **Data Protection**
   - PII handling and sanitization
   - Request/response encryption
   - Audit logging for security events

4. **Rate Limiting**
   - Per-user rate limits
   - Tier-based restrictions
   - Abuse prevention

## Monitoring and Observability

### Health Check Validation

The tests validate multiple health check endpoints:

- **Basic Health**: `/api/v1/health` - Simple up/down status
- **Detailed Health**: `/api/v1/health/detailed` - Component-level status
- **Metrics**: `/api/v1/health/metrics` - Performance and usage metrics
- **Incidents**: `/api/v1/health/incidents` - Active incidents and alerts

### Metrics Collection

Integration tests verify that the system correctly collects:

- Request latency and throughput metrics
- Error rates and types
- Provider performance and costs
- Cache hit rates and effectiveness
- Security events and anomalies

## Troubleshooting

### Common Issues

1. **AWS Credentials**: Ensure proper AWS credentials are configured
2. **Redis Connection**: Verify Redis server is running and accessible
3. **DynamoDB Tables**: Check that required tables exist or can be created
4. **Network Timeouts**: Increase timeout values for slow environments
5. **Rate Limiting**: Tests may fail if rate limits are too restrictive

### Debug Mode

Enable debug logging by setting:
```bash
export LOG_LEVEL=debug
export NODE_ENV=test
```

### Test Isolation

Each test suite runs in isolation with:
- Separate API keys and user contexts
- Isolated configuration namespaces
- Independent feature flag sets
- Cleanup between test runs

## Continuous Integration

### CI/CD Integration

The integration tests are designed to run in CI/CD pipelines with:

- **Parallel Execution**: Tests can run in parallel environments
- **Environment Isolation**: Each CI run uses isolated resources
- **Artifact Collection**: Test reports and coverage data
- **Performance Regression**: Baseline performance comparison

### Pipeline Configuration

```yaml
# Example GitHub Actions configuration
- name: Run Integration Tests
  run: |
    npm install
    npm run test:integration:all
  env:
    AWS_REGION: us-east-1
    NODE_ENV: test
    LOG_LEVEL: warn
```

## Contributing

### Adding New Tests

1. **Follow Naming Convention**: Use descriptive test names
2. **Use Test Utilities**: Leverage `TestConfig` and `TestDataGenerator`
3. **Clean Up Resources**: Ensure proper cleanup in test teardown
4. **Document Test Cases**: Add clear descriptions and success criteria
5. **Validate Performance**: Include performance assertions where relevant

### Test Categories

When adding new tests, categorize them appropriately:

- **Unit Tests**: Single component testing
- **Integration Tests**: Multi-component interaction testing
- **E2E Tests**: Full user workflow testing
- **Performance Tests**: Load and stress testing
- **Security Tests**: Vulnerability and compliance testing

## Conclusion

The integration test suite provides comprehensive validation of the AI Model Gateway system, ensuring that all components work together correctly and meet performance, security, and reliability requirements. The tests serve as both validation tools and documentation of expected system behavior.

For questions or issues with the integration tests, please refer to the troubleshooting section or contact the platform engineering team.