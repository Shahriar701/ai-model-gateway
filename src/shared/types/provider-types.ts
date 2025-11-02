/**
 * Provider adapter types and interfaces
 * Common interfaces for different LLM providers
 */

import { LLMRequest, LLMResponse, LLMStreamChunk, ProviderHealth, ModelInfo, CapacityInfo } from './llm-types';

/**
 * Base provider adapter interface
 */
export interface BaseProviderAdapter {
  readonly name: string;
  readonly type: ProviderType;
  readonly version: string;
  
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // Health and status
  healthCheck(): Promise<ProviderHealth>;
  getCapacity(): Promise<CapacityInfo>;
  
  // Model information
  listModels(): Promise<ModelInfo[]>;
  getModelInfo(modelId: string): Promise<ModelInfo>;
  
  // Core functionality
  generateCompletion(request: LLMRequest): Promise<LLMResponse>;
  generateStream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
  
  // Cost estimation
  estimateCost(request: LLMRequest): Promise<CostEstimate>;
  
  // Configuration
  updateConfig(config: Partial<ProviderConfiguration>): Promise<void>;
  getConfig(): ProviderConfiguration;
}

export type ProviderType = 'openai' | 'bedrock' | 'azure' | 'anthropic' | 'local' | 'custom';

/**
 * Provider configuration
 */
export interface ProviderConfiguration {
  // Basic settings
  name: string;
  type: ProviderType;
  enabled: boolean;
  priority: number;
  
  // Connection settings
  endpoint?: string;
  apiKey?: string;
  region?: string;
  timeout: number;
  
  // Retry and reliability
  maxRetries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  
  // Concurrency and rate limiting
  maxConcurrentRequests: number;
  requestsPerSecond?: number;
  requestsPerMinute?: number;
  
  // Cost settings
  costPerInputToken: number;
  costPerOutputToken: number;
  currency: string;
  
  // Model settings
  defaultModel?: string;
  supportedModels: string[];
  
  // Provider-specific settings
  customHeaders?: Record<string, string>;
  customParameters?: Record<string, any>;
}

/**
 * Cost estimation
 */
export interface CostEstimate {
  estimatedCost: number;
  currency: string;
  breakdown: {
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
  };
  confidence: number; // 0-1, how accurate the estimate is
}

/**
 * OpenAI-specific types
 */
export interface OpenAIProviderConfig extends ProviderConfiguration {
  type: 'openai';
  organization?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}

export interface OpenAIAdapter extends BaseProviderAdapter {
  type: 'openai';
  
  // OpenAI-specific methods
  createFineTune?(request: OpenAIFineTuneRequest): Promise<OpenAIFineTuneResponse>;
  listFineTunes?(): Promise<OpenAIFineTune[]>;
}

export interface OpenAIFineTuneRequest {
  trainingFile: string;
  model: string;
  nEpochs?: number;
  batchSize?: number;
  learningRateMultiplier?: number;
}

export interface OpenAIFineTuneResponse {
  id: string;
  object: string;
  model: string;
  status: string;
  createdAt: number;
}

export interface OpenAIFineTune {
  id: string;
  object: string;
  model: string;
  fineTunedModel?: string;
  status: string;
  trainingFiles: string[];
  validationFiles: string[];
  resultFiles: string[];
}

/**
 * AWS Bedrock-specific types
 */
export interface BedrockProviderConfig extends ProviderConfiguration {
  type: 'bedrock';
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  profile?: string;
}

export interface BedrockAdapter extends BaseProviderAdapter {
  type: 'bedrock';
  
  // Bedrock-specific methods
  invokeModel(request: BedrockInvokeRequest): Promise<BedrockInvokeResponse>;
  invokeModelWithResponseStream(request: BedrockInvokeRequest): AsyncIterable<BedrockStreamChunk>;
}

export interface BedrockInvokeRequest {
  modelId: string;
  body: string;
  contentType: string;
  accept: string;
}

export interface BedrockInvokeResponse {
  body: Uint8Array;
  contentType: string;
}

export interface BedrockStreamChunk {
  chunk?: {
    bytes: Uint8Array;
  };
}

/**
 * Azure OpenAI-specific types
 */
export interface AzureProviderConfig extends ProviderConfiguration {
  type: 'azure';
  resourceName: string;
  deploymentName: string;
  apiVersion: string;
}

export interface AzureAdapter extends BaseProviderAdapter {
  type: 'azure';
  
  // Azure-specific methods
  getDeployment(deploymentId: string): Promise<AzureDeployment>;
  listDeployments(): Promise<AzureDeployment[]>;
}

export interface AzureDeployment {
  id: string;
  model: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  scaleSettings: {
    scaleType: string;
    capacity?: number;
  };
}

/**
 * Local/Custom provider types
 */
export interface LocalProviderConfig extends ProviderConfiguration {
  type: 'local';
  modelPath: string;
  deviceType: 'cpu' | 'gpu' | 'mps';
  maxMemory?: number;
  contextLength?: number;
}

export interface LocalAdapter extends BaseProviderAdapter {
  type: 'local';
  
  // Local-specific methods
  loadModel(modelPath: string): Promise<void>;
  unloadModel(): Promise<void>;
  getModelStatus(): Promise<LocalModelStatus>;
}

export interface LocalModelStatus {
  loaded: boolean;
  modelPath?: string;
  memoryUsage?: number;
  deviceType?: string;
}

/**
 * Provider factory and registry
 */
export interface ProviderFactory {
  createProvider(config: ProviderConfiguration): Promise<BaseProviderAdapter>;
  getSupportedTypes(): ProviderType[];
}

export interface ProviderRegistry {
  register(provider: BaseProviderAdapter): void;
  unregister(name: string): void;
  get(name: string): BaseProviderAdapter | undefined;
  list(): BaseProviderAdapter[];
  getByType(type: ProviderType): BaseProviderAdapter[];
}

/**
 * Provider metrics and monitoring
 */
export interface ProviderMetrics {
  name: string;
  type: ProviderType;
  
  // Request metrics
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  
  // Performance metrics
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  
  // Cost metrics
  totalCost: number;
  averageCostPerRequest: number;
  
  // Token metrics
  totalTokensProcessed: number;
  averageTokensPerRequest: number;
  
  // Time window
  windowStart: string;
  windowEnd: string;
}

export interface ProviderEvent {
  timestamp: string;
  provider: string;
  type: ProviderEventType;
  message: string;
  details?: Record<string, any>;
}

export enum ProviderEventType {
  INITIALIZED = 'INITIALIZED',
  SHUTDOWN = 'SHUTDOWN',
  HEALTH_CHECK_PASSED = 'HEALTH_CHECK_PASSED',
  HEALTH_CHECK_FAILED = 'HEALTH_CHECK_FAILED',
  REQUEST_STARTED = 'REQUEST_STARTED',
  REQUEST_COMPLETED = 'REQUEST_COMPLETED',
  REQUEST_FAILED = 'REQUEST_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  CIRCUIT_BREAKER_OPENED = 'CIRCUIT_BREAKER_OPENED',
  CIRCUIT_BREAKER_CLOSED = 'CIRCUIT_BREAKER_CLOSED',
  CONFIG_UPDATED = 'CONFIG_UPDATED',
}