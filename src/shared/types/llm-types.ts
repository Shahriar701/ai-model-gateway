/**
 * LLM service interfaces and types
 * Standardized interfaces for LLM requests, responses, and provider adapters
 */

/**
 * Core LLM message types
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
  functionCall?: FunctionCall;
}

export interface FunctionCall {
  name: string;
  arguments: string;
}

/**
 * LLM request interface
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
  functions?: LLMFunction[];
  functionCall?: 'auto' | 'none' | { name: string };
  metadata?: RequestMetadata;
}

export interface LLMFunction {
  name: string;
  description?: string;
  parameters: Record<string, any>;
}

export interface RequestMetadata {
  userId?: string;
  sessionId?: string;
  applicationId?: string;
  tags?: string[];
  customFields?: Record<string, any>;
  mcpContextInjected?: boolean;
  mcpToolCalls?: string[];
}

/**
 * LLM response interface
 */
export interface LLMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: LLMChoice[];
  usage: TokenUsage;
  cost: CostBreakdown;
  latency: number;
  provider: string;
  metadata?: ResponseMetadata;
}

export interface LLMChoice {
  index: number;
  message: ChatMessage;
  finishReason: FinishReason;
  logprobs?: LogProbabilities;
}

export type FinishReason = 'stop' | 'length' | 'function_call' | 'content_filter' | 'null';

export interface LogProbabilities {
  tokens: string[];
  tokenLogprobs: number[];
  topLogprobs: Record<string, number>[];
  textOffset: number[];
}

export interface ResponseMetadata {
  requestId: string;
  processingTime: number;
  cacheHit?: boolean;
  retryCount?: number;
}

/**
 * Token usage and cost calculation types
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCharacters?: number;
  completionCharacters?: number;
}

export interface CostBreakdown {
  total: number;
  promptCost: number;
  completionCost: number;
  currency: string;
  rateCard: RateCard;
}

export interface RateCard {
  inputTokenPrice: number;
  outputTokenPrice: number;
  currency: string;
  effectiveDate: string;
}

/**
 * Provider adapter interface
 */
export interface ProviderAdapter {
  readonly name: string;
  readonly type: ProviderType;
  readonly supportedModels: string[];
  
  // Core methods
  initialize(config: ProviderConfig): Promise<void>;
  isHealthy(): Promise<boolean>;
  generateCompletion(request: LLMRequest): Promise<LLMResponse>;
  generateStream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
  
  // Cost and capacity methods
  estimateCost(request: LLMRequest): Promise<number>;
  getAvailableModels(): Promise<ModelInfo[]>;
  getCurrentCapacity(): Promise<CapacityInfo>;
  
  // Lifecycle methods
  shutdown(): Promise<void>;
}

export type ProviderType = 'openai' | 'bedrock' | 'azure' | 'anthropic' | 'local';

export interface ProviderConfig {
  name: string;
  type: ProviderType;
  enabled: boolean;
  priority: number;
  maxConcurrency: number;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  healthCheckInterval: number;
  
  // Authentication
  apiKey?: string;
  endpoint?: string;
  region?: string;
  
  // Cost configuration
  costPerInputToken: number;
  costPerOutputToken: number;
  
  // Model configuration
  models: ModelConfig[];
  
  // Provider-specific settings
  customSettings?: Record<string, any>;
}

export interface ModelConfig {
  name: string;
  displayName: string;
  maxTokens: number;
  supportsStreaming: boolean;
  supportsFunctions: boolean;
  costMultiplier?: number;
  deprecated?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  maxTokens: number;
  trainingData?: string;
  capabilities: ModelCapabilities;
}

export interface ModelCapabilities {
  chat: boolean;
  completion: boolean;
  functions: boolean;
  streaming: boolean;
  vision?: boolean;
  codeGeneration?: boolean;
}

export interface CapacityInfo {
  available: boolean;
  currentLoad: number;
  maxConcurrency: number;
  queueLength: number;
  estimatedWaitTime?: number;
}

/**
 * Streaming response types
 */
export interface LLMStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: StreamChoice[];
  usage?: Partial<TokenUsage>;
}

export interface StreamChoice {
  index: number;
  delta: MessageDelta;
  finishReason?: FinishReason;
}

export interface MessageDelta {
  role?: string;
  content?: string;
  functionCall?: Partial<FunctionCall>;
}

/**
 * Error types
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public code: LLMErrorCode,
    public provider?: string,
    public retryable: boolean = false,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export enum LLMErrorCode {
  INVALID_REQUEST = 'INVALID_REQUEST',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  INSUFFICIENT_QUOTA = 'INSUFFICIENT_QUOTA',
  CONTENT_FILTER = 'CONTENT_FILTER',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  name: string;
  status: HealthStatus;
  lastCheck: string;
  responseTime?: number;
  errorRate?: number;
  details?: Record<string, any>;
}

export enum HealthStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNHEALTHY = 'UNHEALTHY',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Request routing types
 */
export interface RoutingDecision {
  provider: string;
  model: string;
  reason: RoutingReason;
  confidence: number;
  alternatives?: RoutingAlternative[];
}

export interface RoutingAlternative {
  provider: string;
  model: string;
  estimatedCost: number;
  estimatedLatency: number;
}

export enum RoutingReason {
  COST_OPTIMIZED = 'COST_OPTIMIZED',
  LATENCY_OPTIMIZED = 'LATENCY_OPTIMIZED',
  QUALITY_OPTIMIZED = 'QUALITY_OPTIMIZED',
  AVAILABILITY = 'AVAILABILITY',
  FALLBACK = 'FALLBACK',
}