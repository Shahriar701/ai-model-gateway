import { BaseProvider } from './base-provider';
import { LLMRequest, LLMResponse, ChatMessage, CostBreakdown } from '../../shared/types';
import { Logger } from '../../shared/utils/logger';
import { ProviderError } from '../../shared/utils/error-handler';

const logger = new Logger('OpenAIProvider');

/**
 * OpenAI provider adapter
 * Handles OpenAI API integration with retry logic and cost calculation
 */
export class OpenAIProvider extends BaseProvider {
  name = 'openai';
  protected baseUrl = 'https://api.openai.com/v1';
  protected apiKey: string;

  // OpenAI pricing per 1K tokens (as of 2024)
  private readonly pricing: Record<string, { input: number; output: number }> = {
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
    'gpt-3.5-turbo-16k': { input: 0.003, output: 0.004 },
  };

  constructor() {
    super();
    this.apiKey = process.env.OPENAI_API_KEY || '';

    if (!this.apiKey) {
      logger.warn('OpenAI API key not configured - using mock responses');
    }
  }

  async generateCompletion(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    logger.info('Generating OpenAI completion', {
      requestId,
      model: request.model,
      messageCount: request.messages.length,
    });

    try {
      // If no API key, return mock response
      if (!this.apiKey) {
        return this.generateMockResponse(request, requestId, startTime);
      }

      const openaiRequest = {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        frequency_penalty: request.frequencyPenalty,
        presence_penalty: request.presencePenalty,
        stop: request.stop,
        stream: false,
        user: request.user,
      };

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'AI-Model-Gateway/1.0',
        },
        body: JSON.stringify(openaiRequest),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as any;
        throw new Error(
          `OpenAI API error: ${response.status} - ${errorData.error?.message || response.statusText}`
        );
      }

      const data = (await response.json()) as any;
      const latency = Date.now() - startTime;

      const cost = this.calculateActualCost(
        data.usage.prompt_tokens,
        data.usage.completion_tokens,
        request.model
      );

      const llmResponse: LLMResponse = {
        id: data.id || requestId,
        model: data.model,
        choices: data.choices.map((choice: any) => ({
          index: choice.index,
          message: {
            role: choice.message.role,
            content: choice.message.content,
            functionCall: choice.message.function_call,
          },
          finishReason: choice.finish_reason,
          logprobs: choice.logprobs,
        })),
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        },
        cost,
        latency,
        provider: this.name,
        metadata: {
          requestId,
          timestamp: new Date().toISOString(),
          modelVersion: data.model,
        },
      };

      logger.info('OpenAI completion generated successfully', {
        requestId,
        latency,
        totalTokens: data.usage.total_tokens,
        cost: cost.total,
        model: data.model,
      });

      return llmResponse;
    } catch (error) {
      logger.error('OpenAI completion failed', error as Error, { requestId });
      throw new ProviderError(`OpenAI API error: ${(error as Error).message}`, this.name);
    }
  }

  private generateMockResponse(
    request: LLMRequest,
    requestId: string,
    startTime: number
  ): LLMResponse {
    const promptTokens = this.calculatePromptTokens(request.messages);
    const completionTokens = 50;
    const cost = this.calculateActualCost(promptTokens, completionTokens, request.model);

    return {
      id: requestId,
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `Mock response from OpenAI ${request.model}. This is a demonstration response since no API key is configured. The request contained ${request.messages.length} messages.`,
          },
          finishReason: 'stop',
        },
      ],
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      cost,
      latency: Date.now() - startTime,
      provider: this.name,
      metadata: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private calculateActualCost(
    promptTokens: number,
    completionTokens: number,
    model: string
  ): CostBreakdown {
    const modelPricing = this.pricing[model] || this.pricing['gpt-3.5-turbo'];

    const promptCost = (promptTokens / 1000) * modelPricing.input;
    const completionCost = (completionTokens / 1000) * modelPricing.output;

    return {
      total: promptCost + completionCost,
      promptCost,
      completionCost,
      currency: 'USD',
    };
  }

  estimateCost(request: LLMRequest): number {
    const promptTokens = this.calculatePromptTokens(request.messages);
    const estimatedCompletionTokens = request.maxTokens || 100;
    const modelPricing = this.pricing[request.model] || this.pricing['gpt-3.5-turbo'];

    const promptCost = (promptTokens / 1000) * modelPricing.input;
    const completionCost = (estimatedCompletionTokens / 1000) * modelPricing.output;

    return promptCost + completionCost;
  }

  protected async performHealthCheck(): Promise<void> {
    // TODO: Implement actual health check
    // For now, just check if API key is configured
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }
  }

  private calculatePromptTokens(messages: ChatMessage[]): number {
    const fullPrompt = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n');
    return this.calculateTokens(fullPrompt);
  }
}
