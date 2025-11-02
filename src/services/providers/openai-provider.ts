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

  /**
   * Generate streaming completion
   */
  async *generateStream(request: LLMRequest): AsyncIterable<import('../../shared/types').LLMStreamChunk> {
    const requestId = this.generateRequestId();

    logger.info('Generating OpenAI streaming completion', {
      requestId,
      model: request.model,
      messageCount: request.messages.length,
    });

    try {
      // If no API key, generate mock stream
      if (!this.apiKey) {
        yield* this.generateMockStream(request, requestId);
        return;
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
        stream: true,
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

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                return;
              }

              try {
                const parsed = JSON.parse(data);
                const streamChunk: import('../../shared/types').LLMStreamChunk = {
                  id: parsed.id || requestId,
                  object: parsed.object,
                  created: parsed.created,
                  model: parsed.model,
                  choices: parsed.choices.map((choice: any) => ({
                    index: choice.index,
                    delta: {
                      role: choice.delta?.role,
                      content: choice.delta?.content,
                      functionCall: choice.delta?.function_call,
                    },
                    finishReason: choice.finish_reason,
                  })),
                  usage: parsed.usage,
                };

                yield streamChunk;
              } catch (parseError) {
                logger.warn('Failed to parse streaming chunk', { data, error: parseError });
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      logger.error('OpenAI streaming failed', error as Error, { requestId });
      throw new ProviderError(`OpenAI streaming error: ${(error as Error).message}`, this.name);
    }
  }

  /**
   * Generate mock streaming response
   */
  private async *generateMockStream(
    request: LLMRequest,
    requestId: string
  ): AsyncIterable<import('../../shared/types').LLMStreamChunk> {
    const mockContent = `Mock streaming response from OpenAI ${request.model}. This is a demonstration response since no API key is configured.`;
    const words = mockContent.split(' ');

    for (let i = 0; i < words.length; i++) {
      const content = i === 0 ? words[i] : ` ${words[i]}`;
      
      yield {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: request.model,
        choices: [
          {
            index: 0,
            delta: {
              content: content,
            },
            finishReason: i === words.length - 1 ? 'stop' : undefined,
          },
        ],
      };

      // Simulate streaming delay
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  protected async performHealthCheck(): Promise<void> {
    try {
      if (!this.apiKey) {
        throw new Error('OpenAI API key not configured');
      }

      // Test with a minimal request to verify connectivity
      const testRequest = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
        temperature: 0,
      };

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'AI-Model-Gateway/1.0',
        },
        body: JSON.stringify(testRequest),
      });

      if (!response.ok) {
        throw new Error(`OpenAI health check failed: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`OpenAI health check failed: ${(error as Error).message}`);
    }
  }

  private calculatePromptTokens(messages: ChatMessage[]): number {
    const fullPrompt = messages.map(msg => `${msg.role}: ${msg.content}`).join('\n');
    return this.calculateTokens(fullPrompt);
  }
}
