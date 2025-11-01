import { z } from 'zod';

/**
 * Validation schemas for request/response validation
 * Using Zod for runtime type checking and validation
 */

// Chat message schema
export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'function']),
  content: z.string().min(1, 'Message content cannot be empty'),
  name: z.string().optional(),
  functionCall: z.object({
    name: z.string(),
    arguments: z.string()
  }).optional()
});

// LLM request schema
export const llmRequestSchema = z.object({
  model: z.string().min(1, 'Model name is required'),
  messages: z.array(chatMessageSchema).min(1, 'At least one message is required'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(32000).optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  stop: z.array(z.string()).max(4).optional(),
  stream: z.boolean().optional(),
  user: z.string().optional(),
  mcpContext: z.object({
    productIds: z.array(z.string()).optional(),
    searchQuery: z.string().optional(),
    filters: z.object({
      category: z.string().optional(),
      priceRange: z.object({
        min: z.number().nonnegative(),
        max: z.number().positive()
      }).optional(),
      availability: z.boolean().optional()
    }).optional()
  }).optional(),
  metadata: z.object({
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    applicationId: z.string().optional(),
    tags: z.array(z.string()).optional(),
    customFields: z.record(z.any()).optional()
  }).optional()
});

// Token usage schema
export const tokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative()
});

// Cost breakdown schema
export const costBreakdownSchema = z.object({
  total: z.number().nonnegative(),
  promptCost: z.number().nonnegative(),
  completionCost: z.number().nonnegative(),
  currency: z.string().length(3)
});

// LLM response schema
export const llmResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(z.object({
    index: z.number().int().nonnegative(),
    message: chatMessageSchema,
    finishReason: z.enum(['stop', 'length', 'function_call', 'content_filter', 'null']),
    logprobs: z.number().optional()
  })),
  usage: tokenUsageSchema,
  cost: costBreakdownSchema,
  latency: z.number().nonnegative(),
  provider: z.string(),
  cached: z.boolean().optional(),
  metadata: z.object({
    requestId: z.string(),
    timestamp: z.string(),
    region: z.string().optional(),
    modelVersion: z.string().optional()
  }).optional()
});

// API key schema
export const apiKeySchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(32),
  name: z.string().min(1).max(100),
  userId: z.string(),
  tier: z.enum(['free', 'basic', 'premium', 'enterprise']),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  lastUsedAt: z.string().datetime().optional(),
  permissions: z.array(z.object({
    resource: z.string(),
    actions: z.array(z.string())
  })),
  metadata: z.record(z.any()).optional()
});

// Provider config schema
export const providerConfigSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['openai', 'bedrock', 'azure', 'local']),
  enabled: z.boolean(),
  priority: z.number().int().positive(),
  maxConcurrency: z.number().int().positive(),
  timeout: z.number().int().positive(),
  retryAttempts: z.number().int().nonnegative().max(5),
  retryDelay: z.number().int().positive(),
  costPerInputToken: z.number().nonnegative(),
  costPerOutputToken: z.number().nonnegative(),
  models: z.array(z.string()).min(1),
  healthCheckInterval: z.number().int().positive().optional()
});

// Rate limit config schema
export const rateLimitConfigSchema = z.object({
  requestsPerMinute: z.number().int().positive(),
  requestsPerHour: z.number().int().positive(),
  requestsPerDay: z.number().int().positive(),
  burstLimit: z.number().int().positive(),
  tokensPerMinute: z.number().int().positive().optional(),
  tokensPerDay: z.number().int().positive().optional()
});

// Product search schema
export const productSearchSchema = z.object({
  query: z.string().min(1).max(500),
  category: z.string().optional(),
  priceRange: z.object({
    min: z.number().nonnegative(),
    max: z.number().positive()
  }).optional(),
  availability: z.boolean().optional(),
  limit: z.number().int().positive().max(100).default(10),
  offset: z.number().int().nonnegative().default(0)
});

/**
 * Validation helper functions
 */
export const validateLLMRequest = (data: unknown) => {
  return llmRequestSchema.parse(data);
};

export const validateApiKey = (data: unknown) => {
  return apiKeySchema.parse(data);
};

export const validateProviderConfig = (data: unknown) => {
  return providerConfigSchema.parse(data);
};

export const validateProductSearch = (data: unknown) => {
  return productSearchSchema.parse(data);
};
