// Core type definitions for the AI Model Gateway

/**
 * Standard LLM request interface
 * Supports multiple providers with unified format
 */
export interface LLMRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  stream?: boolean;
  user?: string;
  mcpContext?: MCPContext;
  metadata?: RequestMetadata;
}

/**
 * Request metadata for tracking and analytics
 */
export interface RequestMetadata {
  userId?: string;
  sessionId?: string;
  applicationId?: string;
  tags?: string[];
  customFields?: Record<string, any>;
}

/**
 * Standard LLM response interface
 * Includes cost and performance metrics
 */
export interface LLMResponse {
  id: string;
  model: string;
  choices: ChatChoice[];
  usage: TokenUsage;
  cost: CostBreakdown;
  latency: number;
  provider: string;
  cached?: boolean;
  metadata?: ResponseMetadata;
}

/**
 * Cost breakdown for transparency
 */
export interface CostBreakdown {
  total: number;
  promptCost: number;
  completionCost: number;
  currency: string;
}

/**
 * Response metadata for observability
 */
export interface ResponseMetadata {
  requestId: string;
  timestamp: string;
  region?: string;
  modelVersion?: string;
}

/**
 * Chat message with role-based content
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
  functionCall?: FunctionCall;
}

/**
 * Function calling support for advanced use cases
 */
export interface FunctionCall {
  name: string;
  arguments: string;
}

/**
 * Chat completion choice
 */
export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finishReason: 'stop' | 'length' | 'function_call' | 'content_filter' | 'null';
  logprobs?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface MCPContext {
  productIds?: string[];
  searchQuery?: string;
  filters?: ProductFilters;
}

export interface ProductFilters {
  category?: string;
  priceRange?: {
    min: number;
    max: number;
  };
  availability?: boolean;
}

/**
 * Provider types supported by the gateway
 */
export enum ProviderType {
  OPENAI = 'openai',
  BEDROCK = 'bedrock',
  AZURE = 'azure',
  LOCAL = 'local'
}

/**
 * Provider configuration for routing and failover
 */
export interface ProviderConfig {
  name: string;
  type: ProviderType;
  enabled: boolean;
  priority: number;
  maxConcurrency: number;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  costPerInputToken: number;
  costPerOutputToken: number;
  models: string[];
  healthCheckInterval?: number;
}

/**
 * Provider routing strategy
 */
export enum RoutingStrategy {
  COST_OPTIMIZED = 'cost_optimized',
  LATENCY_OPTIMIZED = 'latency_optimized',
  ROUND_ROBIN = 'round_robin',
  PRIORITY_BASED = 'priority_based'
}

/**
 * Provider selection criteria
 */
export interface ProviderSelectionCriteria {
  strategy: RoutingStrategy;
  maxCost?: number;
  maxLatency?: number;
  preferredProviders?: string[];
  excludedProviders?: string[];
}

/**
 * Rate limiting configuration per tier
 */
export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  burstLimit: number;
  tokensPerMinute?: number;
  tokensPerDay?: number;
}

/**
 * Rate limit tiers for different user levels
 */
export enum RateLimitTier {
  FREE = 'free',
  BASIC = 'basic',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise'
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  enabled: boolean;
  ttl: number;
  maxSize?: number;
  keyPrefix?: string;
  excludePatterns?: string[];
}

/**
 * Cache entry metadata
 */
export interface CacheEntry {
  key: string;
  value: LLMResponse;
  timestamp: number;
  ttl: number;
  hits: number;
}

export enum ErrorType {
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  INVALID_REQUEST = 'INVALID_REQUEST',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

export interface ErrorResponse {
  error: {
    type: ErrorType;
    message: string;
    code: string;
    details?: Record<string, any>;
    retryAfter?: number;
  };
  requestId: string;
  timestamp: string;
}

/**
 * Authentication types
 */
export enum AuthType {
  API_KEY = 'api_key',
  JWT = 'jwt',
  OAUTH = 'oauth',
  IAM = 'iam'
}

/**
 * API key configuration
 */
export interface ApiKey {
  id: string;
  key: string;
  name: string;
  userId: string;
  tier: RateLimitTier;
  enabled: boolean;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  permissions: ApiKeyPermission[];
  metadata?: Record<string, any>;
}

/**
 * API key permissions
 */
export interface ApiKeyPermission {
  resource: string;
  actions: string[];
}

/**
 * Authentication context
 */
export interface AuthContext {
  type: AuthType;
  userId: string;
  apiKeyId?: string;
  tier: RateLimitTier;
  permissions: ApiKeyPermission[];
  metadata?: Record<string, any>;
}


/**
 * Metrics for observability
 */
export interface RequestMetrics {
  requestId: string;
  timestamp: string;
  provider: string;
  model: string;
  latency: number;
  tokenUsage: TokenUsage;
  cost: number;
  cached: boolean;
  success: boolean;
  errorType?: ErrorType;
  userId?: string;
  region?: string;
}

/**
 * Provider health metrics
 */
export interface ProviderHealthMetrics {
  provider: string;
  healthy: boolean;
  latency: number;
  errorRate: number;
  requestCount: number;
  successRate: number;
  lastChecked: Date;
  consecutiveFailures: number;
}

/**
 * System health status
 */
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  providers: ProviderHealthMetrics[];
  cache: {
    connected: boolean;
    hitRate: number;
  };
  database: {
    connected: boolean;
    latency: number;
  };
  timestamp: string;
}

/**
 * Alert configuration
 */
export interface AlertConfig {
  enabled: boolean;
  errorRateThreshold: number;
  latencyThreshold: number;
  costThreshold: number;
  channels: AlertChannel[];
}

/**
 * Alert channels
 */
export enum AlertChannel {
  EMAIL = 'email',
  SLACK = 'slack',
  PAGERDUTY = 'pagerduty',
  SNS = 'sns'
}
