import { ConfigSchema } from './configuration-manager';

/**
 * Configuration schema for AI Model Gateway
 * Defines all configuration parameters with validation rules
 */
export const AI_GATEWAY_CONFIG_SCHEMA: ConfigSchema = {
  // API Gateway Configuration
  'api/cors/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable CORS for API Gateway',
  },
  'api/cors/origins': {
    type: 'object',
    required: true,
    default: ['*'],
    description: 'Allowed CORS origins',
  },
  'api/rate-limit/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable API rate limiting',
  },
  'api/request-timeout': {
    type: 'number',
    required: true,
    default: 30000,
    min: 1000,
    max: 300000,
    description: 'API request timeout in milliseconds',
  },

  // Authentication Configuration
  'auth/api-key/required': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Require API key for authentication',
  },
  'auth/jwt/enabled': {
    type: 'boolean',
    required: false,
    default: false,
    description: 'Enable JWT authentication',
  },
  'auth/jwt/secret': {
    type: 'string',
    required: false,
    description: 'JWT secret key',
  },
  'auth/session-timeout': {
    type: 'number',
    required: true,
    default: 3600000,
    min: 300000,
    max: 86400000,
    description: 'Session timeout in milliseconds',
  },

  // Rate Limiting Configuration
  'rate-limit/free/requests-per-minute': {
    type: 'number',
    required: true,
    default: 10,
    min: 1,
    max: 1000,
    description: 'Requests per minute for free tier',
  },
  'rate-limit/free/requests-per-hour': {
    type: 'number',
    required: true,
    default: 100,
    min: 10,
    max: 10000,
    description: 'Requests per hour for free tier',
  },
  'rate-limit/basic/requests-per-minute': {
    type: 'number',
    required: true,
    default: 50,
    min: 10,
    max: 5000,
    description: 'Requests per minute for basic tier',
  },
  'rate-limit/basic/requests-per-hour': {
    type: 'number',
    required: true,
    default: 1000,
    min: 100,
    max: 50000,
    description: 'Requests per hour for basic tier',
  },
  'rate-limit/premium/requests-per-minute': {
    type: 'number',
    required: true,
    default: 200,
    min: 50,
    max: 10000,
    description: 'Requests per minute for premium tier',
  },
  'rate-limit/premium/requests-per-hour': {
    type: 'number',
    required: true,
    default: 5000,
    min: 500,
    max: 100000,
    description: 'Requests per hour for premium tier',
  },

  // Provider Configuration
  'providers/openai/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable OpenAI provider',
  },
  'providers/openai/api-key': {
    type: 'string',
    required: false,
    description: 'OpenAI API key',
  },
  'providers/openai/base-url': {
    type: 'string',
    required: false,
    default: 'https://api.openai.com/v1',
    description: 'OpenAI API base URL',
  },
  'providers/openai/timeout': {
    type: 'number',
    required: true,
    default: 30000,
    min: 5000,
    max: 120000,
    description: 'OpenAI request timeout in milliseconds',
  },
  'providers/openai/max-retries': {
    type: 'number',
    required: true,
    default: 3,
    min: 0,
    max: 10,
    description: 'Maximum retry attempts for OpenAI',
  },
  'providers/openai/priority': {
    type: 'number',
    required: true,
    default: 1,
    min: 1,
    max: 10,
    description: 'OpenAI provider priority (1 = highest)',
  },

  'providers/bedrock/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable AWS Bedrock provider',
  },
  'providers/bedrock/region': {
    type: 'string',
    required: false,
    default: 'us-east-1',
    description: 'AWS Bedrock region',
  },
  'providers/bedrock/timeout': {
    type: 'number',
    required: true,
    default: 30000,
    min: 5000,
    max: 120000,
    description: 'Bedrock request timeout in milliseconds',
  },
  'providers/bedrock/max-retries': {
    type: 'number',
    required: true,
    default: 2,
    min: 0,
    max: 10,
    description: 'Maximum retry attempts for Bedrock',
  },
  'providers/bedrock/priority': {
    type: 'number',
    required: true,
    default: 2,
    min: 1,
    max: 10,
    description: 'Bedrock provider priority (1 = highest)',
  },

  // Routing Configuration
  'routing/strategy': {
    type: 'string',
    required: true,
    default: 'cost_optimized',
    enum: ['cost_optimized', 'latency_optimized', 'round_robin', 'priority_based'],
    description: 'Default routing strategy',
  },
  'routing/failover-enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable automatic failover between providers',
  },
  'routing/circuit-breaker-enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable circuit breaker for provider health',
  },
  'routing/health-check-interval': {
    type: 'number',
    required: true,
    default: 60000,
    min: 10000,
    max: 300000,
    description: 'Provider health check interval in milliseconds',
  },

  // Caching Configuration
  'cache/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable response caching',
  },
  'cache/redis/host': {
    type: 'string',
    required: false,
    description: 'Redis host for caching',
  },
  'cache/redis/port': {
    type: 'number',
    required: false,
    default: 6379,
    min: 1,
    max: 65535,
    description: 'Redis port',
  },
  'cache/redis/password': {
    type: 'string',
    required: false,
    description: 'Redis password',
  },
  'cache/ttl/default': {
    type: 'number',
    required: true,
    default: 3600,
    min: 60,
    max: 86400,
    description: 'Default cache TTL in seconds',
  },
  'cache/ttl/llm-responses': {
    type: 'number',
    required: true,
    default: 1800,
    min: 300,
    max: 7200,
    description: 'LLM response cache TTL in seconds',
  },
  'cache/max-size': {
    type: 'number',
    required: true,
    default: 1000,
    min: 100,
    max: 10000,
    description: 'Maximum number of cached items',
  },

  // MCP Configuration
  'mcp/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable MCP server',
  },
  'mcp/port': {
    type: 'number',
    required: false,
    default: 3001,
    min: 1000,
    max: 65535,
    description: 'MCP server port',
  },
  'mcp/max-connections': {
    type: 'number',
    required: true,
    default: 100,
    min: 10,
    max: 1000,
    description: 'Maximum MCP connections',
  },
  'mcp/context-injection-enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable MCP context injection in LLM requests',
  },

  // Observability Configuration
  'observability/metrics/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable CloudWatch metrics',
  },
  'observability/metrics/namespace': {
    type: 'string',
    required: true,
    default: 'AIModelGateway',
    description: 'CloudWatch metrics namespace',
  },
  'observability/tracing/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable X-Ray tracing',
  },
  'observability/tracing/sample-rate': {
    type: 'number',
    required: true,
    default: 0.1,
    min: 0,
    max: 1,
    description: 'X-Ray sampling rate (0.0 to 1.0)',
  },
  'observability/logging/level': {
    type: 'string',
    required: true,
    default: 'INFO',
    enum: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
    description: 'Logging level',
  },
  'observability/correlation-tracking': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable correlation ID tracking',
  },

  // Security Configuration
  'security/encryption/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable data encryption',
  },
  'security/request-signing/enabled': {
    type: 'boolean',
    required: false,
    default: false,
    description: 'Enable request signing verification',
  },
  'security/ip-whitelist/enabled': {
    type: 'boolean',
    required: false,
    default: false,
    description: 'Enable IP whitelist filtering',
  },
  'security/ip-whitelist/addresses': {
    type: 'object',
    required: false,
    default: [],
    description: 'Whitelisted IP addresses',
  },
  'security/monitoring/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable security monitoring',
  },
  'security/incident-response/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable automated incident response',
  },

  // Cost Management Configuration
  'cost/tracking/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable cost tracking',
  },
  'cost/optimization/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable cost optimization',
  },
  'cost/alerts/daily-threshold': {
    type: 'number',
    required: true,
    default: 100,
    min: 1,
    max: 10000,
    description: 'Daily cost alert threshold in USD',
  },
  'cost/alerts/monthly-threshold': {
    type: 'number',
    required: true,
    default: 1000,
    min: 10,
    max: 100000,
    description: 'Monthly cost alert threshold in USD',
  },

  // Batching Configuration
  'batching/enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable request batching',
  },
  'batching/max-batch-size': {
    type: 'number',
    required: true,
    default: 5,
    min: 1,
    max: 20,
    description: 'Maximum batch size for requests',
  },
  'batching/timeout': {
    type: 'number',
    required: true,
    default: 100,
    min: 10,
    max: 1000,
    description: 'Batch timeout in milliseconds',
  },
  'batching/deduplication-enabled': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable request deduplication',
  },

  // Feature Flags (will be used by feature flag service)
  'features/intelligent-routing': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable intelligent routing features',
  },
  'features/advanced-caching': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable advanced caching features',
  },
  'features/cost-optimization': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable cost optimization features',
  },
  'features/security-monitoring': {
    type: 'boolean',
    required: true,
    default: true,
    description: 'Enable advanced security monitoring',
  },
};

/**
 * Default configuration values for different environments
 */
export const DEFAULT_CONFIGURATIONS = {
  development: {
    'api/rate-limit/enabled': false,
    'observability/tracing/sample-rate': 1.0,
    'observability/logging/level': 'DEBUG',
    'cache/ttl/default': 300,
    'providers/openai/timeout': 60000,
    'providers/bedrock/timeout': 60000,
    'security/monitoring/enabled': false,
    'cost/alerts/daily-threshold': 10,
  },
  staging: {
    'api/rate-limit/enabled': true,
    'observability/tracing/sample-rate': 0.5,
    'observability/logging/level': 'INFO',
    'cache/ttl/default': 1800,
    'security/monitoring/enabled': true,
    'cost/alerts/daily-threshold': 50,
  },
  production: {
    'api/rate-limit/enabled': true,
    'observability/tracing/sample-rate': 0.1,
    'observability/logging/level': 'WARN',
    'cache/ttl/default': 3600,
    'security/monitoring/enabled': true,
    'security/incident-response/enabled': true,
    'cost/alerts/daily-threshold': 100,
  },
};

/**
 * Configuration keys that require service restart when changed
 */
export const RESTART_REQUIRED_CONFIGS = [
  'api/cors/enabled',
  'api/cors/origins',
  'cache/redis/host',
  'cache/redis/port',
  'mcp/port',
  'mcp/max-connections',
  'providers/openai/base-url',
  'providers/bedrock/region',
];

/**
 * Configuration keys that contain sensitive information
 */
export const SENSITIVE_CONFIGS = [
  'auth/jwt/secret',
  'providers/openai/api-key',
  'cache/redis/password',
];