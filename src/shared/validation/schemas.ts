import { z } from 'zod';

/**
 * Validation schemas for LLM requests and responses
 * Uses Zod for runtime type checking and validation
 */

// Chat message schema
export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'function']),
  content: z.string().min(1, 'Message content cannot be empty'),
  name: z.string().optional(),
  functionCall: z
    .object({
      name: z.string(),
      arguments: z.string(),
    })
    .optional(),
});

// MCP context schema
export const MCPContextSchema = z.object({
  productIds: z.array(z.string()).optional(),
  searchQuery: z.string().optional(),
  filters: z
    .object({
      category: z.string().optional(),
      priceRange: z
        .object({
          min: z.number().min(0),
          max: z.number().min(0),
        })
        .optional(),
      availability: z.boolean().optional(),
    })
    .optional(),
});

// Request metadata schema
export const RequestMetadataSchema = z.object({
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  applicationId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.any()).optional(),
});

// LLM request schema
export const LLMRequestSchema = z.object({
  model: z.string().min(1, 'Model name is required'),
  messages: z.array(ChatMessageSchema).min(1, 'At least one message is required'),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(32000).optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  stop: z.array(z.string()).max(4).optional(),
  stream: z.boolean().optional(),
  user: z.string().optional(),
  mcpContext: MCPContextSchema.optional(),
  metadata: RequestMetadataSchema.optional(),
});

// Token usage schema
export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
});

// Cost breakdown schema
export const CostBreakdownSchema = z.object({
  total: z.number().min(0),
  promptCost: z.number().min(0),
  completionCost: z.number().min(0),
  currency: z.string().length(3), // ISO 4217 currency code
});

// Provider config schema
export const ProviderConfigSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['openai', 'bedrock', 'azure', 'local']),
  enabled: z.boolean(),
  priority: z.number().int().min(0).max(100),
  maxConcurrency: z.number().int().min(1),
  timeout: z.number().int().min(1000).max(300000), // 1s to 5min
  retryAttempts: z.number().int().min(0).max(5),
  retryDelay: z.number().int().min(100).max(10000),
  costPerInputToken: z.number().min(0),
  costPerOutputToken: z.number().min(0),
  models: z.array(z.string()).min(1),
  healthCheckInterval: z.number().int().min(5000).optional(),
});

// Rate limit config schema
export const RateLimitConfigSchema = z.object({
  requestsPerMinute: z.number().int().min(1),
  requestsPerHour: z.number().int().min(1),
  requestsPerDay: z.number().int().min(1),
  burstLimit: z.number().int().min(1),
  tokensPerMinute: z.number().int().min(1).optional(),
  tokensPerDay: z.number().int().min(1).optional(),
});

// API key schema
export const ApiKeySchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(32),
  name: z.string().min(1).max(100),
  userId: z.string().min(1),
  tier: z.enum(['free', 'basic', 'premium', 'enterprise']),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  lastUsedAt: z.string().datetime().optional(),
  permissions: z.array(
    z.object({
      resource: z.string(),
      actions: z.array(z.string()),
    })
  ),
  metadata: z.record(z.any()).optional(),
});

// Product search request schema
export const ProductSearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  category: z.string().optional(),
  priceRange: z
    .object({
      min: z.number().min(0),
      max: z.number().min(0),
    })
    .optional(),
  availability: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(10),
  offset: z.number().int().min(0).default(0),
});

/**
 * Validation helper functions
 */
export class ValidationHelper {
  /**
   * Validate LLM request with detailed error messages
   */
  static validateLLMRequest(data: unknown) {
    const result = LLMRequestSchema.safeParse(data);

    if (!result.success) {
      const errors = result.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      throw new ValidationError('Invalid LLM request', errors);
    }

    return result.data;
  }

  /**
   * Validate provider configuration
   */
  static validateProviderConfig(data: unknown) {
    const result = ProviderConfigSchema.safeParse(data);

    if (!result.success) {
      const errors = result.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      throw new ValidationError('Invalid provider configuration', errors);
    }

    return result.data;
  }

  /**
   * Validate API key
   */
  static validateApiKey(data: unknown) {
    const result = ApiKeySchema.safeParse(data);

    if (!result.success) {
      const errors = result.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      throw new ValidationError('Invalid API key', errors);
    }

    return result.data;
  }

  /**
   * Validate product search request
   */
  static validateProductSearchRequest(data: unknown) {
    const result = ProductSearchRequestSchema.safeParse(data);

    if (!result.success) {
      const errors = result.error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      throw new ValidationError('Invalid product search request', errors);
    }

    return result.data;
  }
}

/**
 * Custom validation error
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public errors: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Export types inferred from schemas
export type LLMRequestInput = z.infer<typeof LLMRequestSchema>;
export type ProviderConfigInput = z.infer<typeof ProviderConfigSchema>;
export type ApiKeyInput = z.infer<typeof ApiKeySchema>;
export type ProductSearchRequestInput = z.infer<typeof ProductSearchRequestSchema>;
