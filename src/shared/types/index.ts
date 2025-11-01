// Core type definitions for the AI Model Gateway

export interface LLMRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  mcpContext?: MCPContext;
}

export interface LLMResponse {
  id: string;
  model: string;
  choices: ChatChoice[];
  usage: TokenUsage;
  cost: number;
  latency: number;
  provider: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finishReason: string;
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

export interface ProviderConfig {
  name: string;
  enabled: boolean;
  priority: number;
  maxConcurrency: number;
  timeout: number;
  retryAttempts: number;
  costPerToken: number;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  burstLimit: number;
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