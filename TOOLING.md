# Development Tooling Guide

This document describes the development tooling setup for the AI Model Gateway project.

## Overview

The project uses a comprehensive set of development tools to ensure code quality, consistency, and maintainability:

- **TypeScript**: Type-safe JavaScript development
- **ESLint**: Code linting and style enforcement
- **Prettier**: Code formatting
- **Jest**: Testing framework
- **Husky**: Git hooks for pre-commit validation
- **GitHub Actions**: CI/CD pipeline automation

## Tool Configuration

### TypeScript Configuration

The project uses TypeScript with strict type checking enabled:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

### ESLint Configuration

ESLint is configured with TypeScript support and Prettier integration:

- **Parser**: `@typescript-eslint/parser`
- **Plugins**: `@typescript-eslint/eslint-plugin`, `eslint-plugin-prettier`
- **Rules**: Strict TypeScript rules with warnings for development flexibility

### Prettier Configuration

Code formatting is handled by Prettier with these settings:

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
```

### Jest Configuration

Testing is configured with:

- **Preset**: `ts-jest` for TypeScript support
- **Environment**: Node.js
- **Coverage**: 70% threshold for branches, functions, lines, and statements
- **Setup**: Custom setup file for test environment

## Git Hooks

### Pre-commit Hook

The pre-commit hook runs the validation suite:

```bash
#!/usr/bin/env sh
npm run validate
```

This ensures that all code committed passes:
- Type checking
- Linting
- Tests
- Build compilation

## CI/CD Pipeline

### GitHub Actions Workflows

#### 1. Main CI/CD Pipeline (`ci-cd.yml`)

**Triggers**: Push to `master`/`develop`, PRs to `master`

**Jobs**:
- **Test and Lint**: Runs full validation suite
- **Security Scan**: npm audit, Snyk, CodeQL
- **Deploy Dev**: Auto-deploy to development (develop branch)
- **Deploy Prod**: Manual approval for production (master branch)

#### 2. Code Quality (`code-quality.yml`)

**Triggers**: Push/PR to `master`/`develop`

**Features**:
- Type checking
- Linting
- Code formatting validation
- Test coverage reporting
- SonarCloud integration
- Codecov integration

#### 3. Dependency Updates (`dependency-update.yml`)

**Schedule**: Weekly on Mondays

**Features**:
- Automated dependency updates
- Security vulnerability fixes
- Automated PR creation
- Test validation before PR

## Development Workflow

### 1. Setup Development Environment

```bash
# Clone repository
git clone <repository-url>
cd ai-model-gateway

# Setup development environment
npm run setup:dev
```

### 2. Development Commands

```bash
# Start development mode (watch + test)
npm run dev

# Run individual tools
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint linting
npm run lint:fix     # Auto-fix linting issues
npm run format       # Format code with Prettier
npm run format:check # Check code formatting
npm run test         # Run tests
npm run build        # Build project

# Run full validation
npm run validate     # All quality checks
```

### 3. Code Quality Standards

#### TypeScript
- Use strict type checking
- Avoid `any` types (warnings allowed)
- Prefer interfaces over types for object shapes
- Use proper error handling with typed exceptions

#### Code Style
- Follow Prettier formatting rules
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused

#### Testing
- Write unit tests for all business logic
- Use integration tests for API endpoints
- Maintain >70% code coverage
- Use descriptive test names

### 4. Git Workflow

#### Branch Naming
- `feature/description` - New features
- `bugfix/description` - Bug fixes
- `hotfix/description` - Critical fixes
- `chore/description` - Maintenance tasks

#### Commit Messages
Follow conventional commit format:
```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### 5. Pull Request Process

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make Changes**
   - Write code following style guidelines
   - Add/update tests
   - Update documentation

3. **Validate Changes**
   ```bash
   npm run validate
   ```

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

5. **Push and Create PR**
   ```bash
   git push origin feature/my-feature
   ```

6. **PR Review**
   - Automated checks must pass
   - Code review required
   - All conversations resolved

## IDE Configuration

### VS Code

The project includes VS Code configuration:

- **Settings**: Auto-format on save, ESLint integration
- **Extensions**: Recommended extensions for TypeScript, ESLint, Prettier
- **Debug**: Configurations for Jest tests and CDK

### Recommended Extensions

- ESLint
- Prettier
- TypeScript and JavaScript Language Features
- AWS Toolkit
- Jest Test Explorer

## Troubleshooting

### Common Issues

#### 1. ESLint Errors
```bash
# Fix auto-fixable issues
npm run lint:fix

# Check specific files
npx eslint src/path/to/file.ts
```

#### 2. TypeScript Errors
```bash
# Check types without emitting files
npm run typecheck

# Build to see compilation errors
npm run build
```

#### 3. Test Failures
```bash
# Run tests with verbose output
npm run test -- --verbose

# Run specific test file
npm run test -- path/to/test.ts

# Run tests in watch mode
npm run test:watch
```

#### 4. Formatting Issues
```bash
# Check formatting
npm run format:check

# Fix formatting
npm run format
```

### Performance Tips

1. **Use TypeScript Incremental Compilation**
   - Enabled by default in `tsconfig.json`
   - Speeds up subsequent builds

2. **Jest Cache**
   - Jest caches test results
   - Clear cache if needed: `npx jest --clearCache`

3. **ESLint Cache**
   - ESLint caches results for faster runs
   - Cache is stored in `node_modules/.cache/eslint`

## Continuous Improvement

### Metrics and Monitoring

- **Code Coverage**: Tracked via Codecov
- **Code Quality**: Monitored via SonarCloud
- **Security**: Scanned via Snyk and GitHub Security
- **Dependencies**: Updated weekly via Dependabot

### Regular Maintenance

- **Weekly**: Dependency updates
- **Monthly**: Tool version updates
- **Quarterly**: Configuration review and optimization

## Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [ESLint Rules](https://eslint.org/docs/rules/)
- [Prettier Configuration](https://prettier.io/docs/en/configuration.html)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [AWS CDK Developer Guide](https://docs.aws.amazon.com/cdk/latest/guide/)