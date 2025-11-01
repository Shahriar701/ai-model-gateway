/**
 * Application constants
 */

// Model names
export const MODELS = {
  OPENAI: {
    GPT4: 'gpt-4',
    GPT4_TURBO: 'gpt-4-turbo-preview',
    GPT35_TURBO: 'gpt-3.5-turbo',
    GPT35_TURBO_16K: 'gpt-3.5-turbo-16k',
  },
  BEDROCK: {
    CLAUDE_V2: 'anthropic.claude-v2',
    CLAUDE_INSTANT: 'anthropic.claude-instant-v1',
    LLAMA2_13B: 'meta.llama2-13b-chat-v1',
    LLAMA2_70B: 'meta.llama2-70b-chat-v1',
  },
} as const;

// Default configuration values
export const DEFAULTS = {
  TEMPERATURE: 0.7,
  MAX_TOKENS: 1000,
  TOP_P: 1.0,
  FREQUENCY_PENALTY: 0,
  PRESENCE_PENALTY: 0,
  TIMEOUT: 30000, // 30 seconds
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // 1 second
  CACHE_TTL: 300, // 5 minutes
  HEALTH_CHECK_INTERVAL: 60000, // 1 minute
} as const;

// Rate limits by tier
export const RATE_LIMITS = {
  FREE: {
    requestsPerMinute: 10,
    requestsPerHour: 100,
    requestsPerDay: 1000,
    burstLimit: 20,
    tokensPerMinute: 10000,
    tokensPerDay: 100000,
  },
  BASIC: {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    requestsPerDay: 10000,
    burstLimit: 100,
    tokensPerMinute: 60000,
    tokensPerDay: 1000000,
  },
  PREMIUM: {
    requestsPerMinute: 300,
    requestsPerHour: 10000,
    requestsPerDay: 100000,
    burstLimit: 500,
    tokensPerMinute: 300000,
    tokensPerDay: 10000000,
  },
  ENTERPRISE: {
    requestsPerMinute: 1000,
    requestsPerHour: 50000,
    requestsPerDay: 500000,
    burstLimit: 2000,
    tokensPerMinute: 1000000,
    tokensPerDay: 50000000,
  },
} as const;

// Cost per 1K tokens (in USD)
export const PRICING = {
  OPENAI: {
    GPT4: {
      input: 0.03,
      output: 0.06,
    },
    GPT4_TURBO: {
      input: 0.01,
      output: 0.03,
    },
    GPT35_TURBO: {
      input: 0.0015,
      output: 0.002,
    },
  },
  BEDROCK: {
    CLAUDE_V2: {
      input: 0.008,
      output: 0.024,
    },
    CLAUDE_INSTANT: {
      input: 0.0008,
      output: 0.0024,
    },
    LLAMA2_13B: {
      input: 0.00075,
      output: 0.001,
    },
    LLAMA2_70B: {
      input: 0.00195,
      output: 0.00256,
    },
  },
} as const;

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

// Error codes
export const ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  INSUFFICIENT_QUOTA: 'INSUFFICIENT_QUOTA',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TIMEOUT: 'TIMEOUT',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
} as const;

// Cache keys
export const CACHE_KEYS = {
  LLM_RESPONSE: 'llm:response',
  PROVIDER_HEALTH: 'provider:health',
  API_KEY: 'apikey',
  RATE_LIMIT: 'ratelimit',
  CONFIG: 'config',
} as const;

// DynamoDB table names (will be set via environment variables)
export const TABLE_NAMES = {
  API_KEYS: process.env.API_KEYS_TABLE || 'api-keys',
  REQUEST_LOGS: process.env.REQUEST_LOGS_TABLE || 'request-logs',
  PRODUCTS: process.env.PRODUCTS_TABLE || 'products',
} as const;

// CloudWatch metric namespaces
export const METRICS = {
  NAMESPACE: 'AIModelGateway',
  DIMENSIONS: {
    PROVIDER: 'Provider',
    MODEL: 'Model',
    TIER: 'Tier',
    REGION: 'Region',
  },
  NAMES: {
    REQUEST_COUNT: 'RequestCount',
    ERROR_COUNT: 'ErrorCount',
    LATENCY: 'Latency',
    TOKEN_USAGE: 'TokenUsage',
    COST: 'Cost',
    CACHE_HIT_RATE: 'CacheHitRate',
  },
} as const;

// Logging levels
export const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
} as const;
