# Development Guide

This guide covers the development workflow, tooling, and best practices for the AI Model Gateway project.

## Prerequisites

- Node.js 18 or later
- AWS CLI configured with appropriate credentials
- Git

## Quick Start

1. **Clone and setup the project:**

   ```bash
   git clone <repository-url>
   cd ai-model-gateway
   npm run setup:dev
   ```

2. **Configure environment:**

   ```bash
   cp .env.example .env.local
   # Edit .env.local with your configuration
   ```

3. **Start development:**
   ```bash
   npm run dev
   ```

## Development Workflow

### Code Quality

The project uses several tools to maintain code quality:

- **ESLint**: Linting and code style enforcement
- **Prettier**: Code formatting
- **TypeScript**: Type checking
- **Jest**: Testing framework
- **Husky**: Git hooks for pre-commit validation

### Available Scripts

```bash
# Development
npm run dev              # Start development mode (watch + test)
npm run build            # Build the project
npm run watch            # Watch mode for TypeScript compilation

# Testing
npm run test             # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
npm run test:unit        # Run unit tests only
npm run test:integration # Run integration tests only
npm run test:e2e         # Run end-to-end tests

# Code Quality
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint issues automatically
npm run format           # Format code with Prettier
npm run format:check     # Check code formatting
npm run typecheck        # Run TypeScript type checking
npm run validate         # Run all quality checks

# AWS CDK
npm run cdk              # Run CDK CLI
npm run synth            # Synthesize CDK templates
npm run deploy           # Deploy all stacks
npm run deploy:dev       # Deploy to development environment
npm run deploy:prod      # Deploy to production environment
npm run bootstrap        # Bootstrap CDK
npm run destroy          # Destroy all stacks

# Utilities
npm run clean            # Clean build artifacts
npm run setup:dev        # Setup development environment
```

### Environment Configuration

The project supports multiple environments through configuration files:

- `config/environments.ts`: Environment-specific settings
- `.env.example`: Template for environment variables
- `.env.local`: Local development overrides (not committed)

### Git Workflow

1. **Pre-commit hooks** automatically run:
   - Type checking
   - Linting
   - Tests
   - Code formatting

2. **Branch naming conventions:**
   - `feature/description` - New features
   - `bugfix/description` - Bug fixes
   - `hotfix/description` - Critical fixes
   - `chore/description` - Maintenance tasks

3. **Commit message format:**

   ```
   type(scope): description

   [optional body]

   [optional footer]
   ```

### Testing Strategy

#### Unit Tests

- Located in `test/` directory
- Test individual functions and classes
- Mock external dependencies
- Aim for >70% coverage

#### Integration Tests

- Test component interactions
- Use real AWS services in test environment
- Test API endpoints end-to-end

#### E2E Tests

- Test complete user workflows
- Validate system behavior
- Performance and load testing

### Debugging

#### VS Code Configuration

The project includes VS Code configuration for:

- Debugging Jest tests
- Debugging CDK synthesis
- TypeScript debugging
- Recommended extensions

#### Debug Commands

```bash
# Debug specific test file
npm run test -- --testNamePattern="test name"

# Debug with Node.js inspector
node --inspect-brk node_modules/.bin/jest --runInBand

# CDK debugging
CDK_DEBUG=true npm run synth
```

### AWS Development

#### Local Development

- Use AWS LocalStack for local AWS services
- Configure local DynamoDB and Redis instances
- Use AWS SAM for local Lambda testing

#### CDK Best Practices

- Use constructs for reusable components
- Implement proper IAM least privilege
- Tag all resources appropriately
- Use environment-specific configurations

#### Deployment Pipeline

1. **Development**: Automatic deployment on `develop` branch
2. **Production**: Manual approval required for `master` branch
3. **Feature branches**: Manual deployment for testing

### Monitoring and Observability

#### Local Development

- CloudWatch logs via AWS CLI
- Local metrics collection
- Debug logging enabled

#### Production

- CloudWatch dashboards
- X-Ray tracing
- Custom metrics
- Automated alerting

### Troubleshooting

#### Common Issues

1. **CDK Bootstrap Issues**

   ```bash
   # Re-bootstrap CDK
   npm run bootstrap
   ```

2. **TypeScript Compilation Errors**

   ```bash
   # Clean and rebuild
   npm run clean
   npm run build
   ```

3. **Test Failures**

   ```bash
   # Run tests with verbose output
   npm run test -- --verbose
   ```

4. **AWS Credential Issues**
   ```bash
   # Check AWS configuration
   aws sts get-caller-identity
   aws configure list
   ```

#### Getting Help

- Check the [README.md](./README.md) for project overview
- Review [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment instructions
- Check GitHub Issues for known problems
- Contact the platform engineering team

### Performance Optimization

#### Development

- Use `npm ci` instead of `npm install` in CI/CD
- Enable TypeScript incremental compilation
- Use Jest cache for faster test runs

#### Production

- Optimize Lambda bundle sizes
- Use CDK asset bundling
- Implement proper caching strategies
- Monitor and optimize cold starts

### Security Considerations

#### Development

- Never commit secrets or API keys
- Use environment variables for configuration
- Regularly update dependencies
- Run security audits

#### Production

- Implement proper IAM roles
- Use AWS Secrets Manager
- Enable encryption at rest and in transit
- Regular security scanning

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run the validation suite: `npm run validate`
5. Submit a pull request

For more detailed contribution guidelines, see [CONTRIBUTING.md](./CONTRIBUTING.md).
