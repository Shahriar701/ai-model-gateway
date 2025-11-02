import { BaseProvider } from './base-provider';
import { LLMRequest, LLMResponse, ChatMessage, LLMStreamChunk } from '../../shared/types';
import { Logger } from '../../shared/utils/logger';
import { ProviderError } from '../../shared/utils/error-handler';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';

const logger = new Logger('BedrockProvider');

/**
 * AWS Bedrock provider adapter
 * Handles Bedrock API integration with IAM authentication
 */
export class BedrockProvider extends BaseProvider {
  name = 'bedrock';
  protected baseUrl = ''; // Bedrock uses AWS SDK, not REST API
  protected apiKey = ''; // Bedrock uses IAM roles

  private region: string;
  private client: BedrockRuntimeClient;
  private modelPricing: Record<string, { input: number; output: number }>;

  constructor() {
    super();
    this.region = process.env.AWS_REGION || 'us-east-1';
    this.client = new BedrockRuntimeClient({ region: this.region });
    
    // AWS Bedrock pricing per 1K tokens (as of 2024)
    this.modelPricing = {
      'anthropic.claude-3-sonnet-20240229-v1:0': { input: 0.003, output: 0.015 },
      'anthropic.claude-3-haiku-20240307-v1:0': { input: 0.00025, output: 0.00125 },
      'anthropic.claude-3-opus-20240229-v1:0': { input: 0.015, output: 0.075 },
      'anthropic.claude-v2:1': { input: 0.008, output: 0.024 },
      'anthropic.claude-v2': { input: 0.008, output: 0.024 },
      'anthropic.claude-instant-v1': { input: 0.0008, output: 0.0024 },
      'meta.llama2-70b-chat-v1': { input: 0.00195, output: 0.00256 },
      'meta.llama2-13b-chat-v1': { input: 0.00075, output: 0.001 },
      'amazon.titan-text-express-v1': { input: 0.0008, output: 0.0016 },
      'amazon.titan-text-lite-v1': { input: 0.0003, output: 0.0004 },
      'cohere.command-text-v14': { input: 0.0015, output: 0.002 },
      'ai21.j2-ultra-v1': { input: 0.0188, output: 0.0188 },
      'ai21.j2-mid-v1': { input: 0.0125, output: 0.0125 },
    };
  }

  async generateCompletion(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    logger.info('Generating Bedrock completion', {
      requestId,
      model: request.model,
      messageCount: request.messages.length,
      region: this.region,
    });

    try {
      const payload = this.buildModelPayload(request);
      
      const command = new InvokeModelCommand({
        modelId: request.model,
        body: JSON.stringify(payload),
        contentType: 'application/json',
        accept: 'application/json',
      });

      const response = await this.client.send(command);
      
      if (!response.body) {
        throw new Error('Empty response body from Bedrock');
      }

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const llmResponse = this.parseModelResponse(responseBody, request, requestId, startTime);

      logger.info('Bedrock completion generated successfully', {
        requestId,
        latency: llmResponse.latency,
        totalTokens: llmResponse.usage.totalTokens,
        cost: llmResponse.cost.total,
      });

      return llmResponse;
    } catch (error) {
      logger.error('Bedrock completion failed', error as Error, { requestId });
      throw new ProviderError(`Bedrock API error: ${(error as Error).message}`, this.name);
    }
  }

  /**
   * Generate streaming completion
   */
  async *generateStream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const requestId = this.generateRequestId();

    logger.info('Generating Bedrock streaming completion', {
      requestId,
      model: request.model,
      messageCount: request.messages.length,
    });

    try {
      const payload = this.buildModelPayload(request);
      
      const command = new InvokeModelWithResponseStreamCommand({
        modelId: request.model,
        body: JSON.stringify(payload),
        contentType: 'application/json',
        accept: 'application/json',
      });

      const response = await this.client.send(command);
      
      if (!response.body) {
        throw new Error('Empty response stream from Bedrock');
      }

      for await (const chunk of response.body) {
        if (chunk.chunk?.bytes) {
          const chunkData = JSON.parse(new TextDecoder().decode(chunk.chunk.bytes));
          const streamChunk = this.parseStreamChunk(chunkData, requestId);
          if (streamChunk) {
            yield streamChunk;
          }
        }
      }
    } catch (error) {
      logger.error('Bedrock streaming failed', error as Error, { requestId });
      throw new ProviderError(`Bedrock streaming error: ${(error as Error).message}`, this.name);
    }
  }

  estimateCost(request: LLMRequest): number {
    const promptTokens = this.calculatePromptTokens(request.messages);
    const estimatedCompletionTokens = request.maxTokens || 100;
    const modelPricing = this.modelPricing[request.model] || this.modelPricing['anthropic.claude-v2'];

    const inputCost = (promptTokens / 1000) * modelPricing.input;
    const outputCost = (estimatedCompletionTokens / 1000) * modelPricing.output;

    return inputCost + outputCost;
  }

  protected async performHealthCheck(): Promise<void> {
    try {
      // Test with a minimal request to verify connectivity
      const testPayload = {
        prompt: '\n\nHuman: Hello\n\nAssistant:',
        max_tokens_to_sample: 1,
        temperature: 0,
      };

      const command = new InvokeModelCommand({
        modelId: 'anthropic.claude-instant-v1',
        body: JSON.stringify(testPayload),
        contentType: 'application/json',
        accept: 'application/json',
      });

      await this.client.send(command);
    } catch (error) {
      throw new Error(`Bedrock health check failed: ${(error as Error).message}`);
    }
  }

  /**
   * Build model-specific payload
   */
  private buildModelPayload(request: LLMRequest): any {
    const modelId = request.model;

    // Convert messages to prompt format
    const prompt = this.messagesToPrompt(request.messages);

    if (modelId.startsWith('anthropic.claude')) {
      return {
        prompt: prompt,
        max_tokens_to_sample: request.maxTokens || 1000,
        temperature: request.temperature || 0.7,
        top_p: request.topP || 0.9,
        stop_sequences: request.stop || ['\n\nHuman:'],
      };
    } else if (modelId.startsWith('meta.llama')) {
      return {
        prompt: prompt,
        max_gen_len: request.maxTokens || 1000,
        temperature: request.temperature || 0.7,
        top_p: request.topP || 0.9,
      };
    } else if (modelId.startsWith('amazon.titan')) {
      return {
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: request.maxTokens || 1000,
          temperature: request.temperature || 0.7,
          topP: request.topP || 0.9,
          stopSequences: request.stop || [],
        },
      };
    } else if (modelId.startsWith('cohere.command')) {
      return {
        prompt: prompt,
        max_tokens: request.maxTokens || 1000,
        temperature: request.temperature || 0.7,
        p: request.topP || 0.9,
        stop_sequences: request.stop || [],
      };
    } else if (modelId.startsWith('ai21.j2')) {
      return {
        prompt: prompt,
        maxTokens: request.maxTokens || 1000,
        temperature: request.temperature || 0.7,
        topP: request.topP || 0.9,
        stopSequences: request.stop || [],
      };
    }

    // Default to Claude format
    return {
      prompt: prompt,
      max_tokens_to_sample: request.maxTokens || 1000,
      temperature: request.temperature || 0.7,
      top_p: request.topP || 0.9,
      stop_sequences: request.stop || ['\n\nHuman:'],
    };
  }

  /**
   * Parse model response based on model type
   */
  private parseModelResponse(
    responseBody: any,
    request: LLMRequest,
    requestId: string,
    startTime: number
  ): LLMResponse {
    const modelId = request.model;
    let content = '';
    let inputTokens = 0;
    let outputTokens = 0;

    if (modelId.startsWith('anthropic.claude')) {
      content = responseBody.completion || '';
      inputTokens = responseBody.usage?.input_tokens || this.calculatePromptTokens(request.messages);
      outputTokens = responseBody.usage?.output_tokens || this.calculateTokens(content);
    } else if (modelId.startsWith('meta.llama')) {
      content = responseBody.generation || '';
      inputTokens = responseBody.prompt_token_count || this.calculatePromptTokens(request.messages);
      outputTokens = responseBody.generation_token_count || this.calculateTokens(content);
    } else if (modelId.startsWith('amazon.titan')) {
      content = responseBody.results?.[0]?.outputText || '';
      inputTokens = responseBody.inputTextTokenCount || this.calculatePromptTokens(request.messages);
      outputTokens = responseBody.results?.[0]?.tokenCount || this.calculateTokens(content);
    } else if (modelId.startsWith('cohere.command')) {
      content = responseBody.generations?.[0]?.text || '';
      inputTokens = responseBody.meta?.billed_units?.input_tokens || this.calculatePromptTokens(request.messages);
      outputTokens = responseBody.meta?.billed_units?.output_tokens || this.calculateTokens(content);
    } else if (modelId.startsWith('ai21.j2')) {
      content = responseBody.completions?.[0]?.data?.text || '';
      inputTokens = responseBody.prompt?.tokens?.length || this.calculatePromptTokens(request.messages);
      outputTokens = responseBody.completions?.[0]?.data?.tokens?.length || this.calculateTokens(content);
    }

    const cost = this.calculateActualCost(inputTokens, outputTokens, request.model);
    const latency = Date.now() - startTime;

    return {
      id: requestId,
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: content,
          },
          finishReason: 'stop',
        },
      ],
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      cost,
      latency,
      provider: this.name,
      metadata: {
        requestId,
        timestamp: new Date().toISOString(),
        modelVersion: request.model,
      },
    };
  }

  /**
   * Parse streaming chunk based on model type
   */
  private parseStreamChunk(chunkData: any, requestId: string): LLMStreamChunk | null {
    // Implementation varies by model, this is a simplified version
    let content = '';

    if (chunkData.completion) {
      content = chunkData.completion;
    } else if (chunkData.generation) {
      content = chunkData.generation;
    } else if (chunkData.outputText) {
      content = chunkData.outputText;
    } else if (chunkData.text) {
      content = chunkData.text;
    }

    if (!content) {
      return null;
    }

    return {
      id: requestId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'bedrock-model',
      choices: [
        {
          index: 0,
          delta: {
            content: content,
          },
        },
      ],
    };
  }

  /**
   * Convert chat messages to prompt format
   */
  private messagesToPrompt(messages: ChatMessage[]): string {
    let prompt = '';

    for (const message of messages) {
      if (message.role === 'system') {
        prompt += `${message.content}\n\n`;
      } else if (message.role === 'user') {
        prompt += `Human: ${message.content}\n\n`;
      } else if (message.role === 'assistant') {
        prompt += `Assistant: ${message.content}\n\n`;
      }
    }

    // Ensure prompt ends with Assistant: for completion
    if (!prompt.endsWith('Assistant:')) {
      prompt += 'Assistant:';
    }

    return prompt;
  }

  /**
   * Calculate actual cost based on token usage
   */
  private calculateActualCost(
    promptTokens: number,
    completionTokens: number,
    model: string
  ): { total: number; promptCost: number; completionCost: number; currency: string } {
    const modelPricing = this.modelPricing[model] || this.modelPricing['anthropic.claude-v2'];

    const promptCost = (promptTokens / 1000) * modelPricing.input;
    const completionCost = (completionTokens / 1000) * modelPricing.output;

    return {
      total: promptCost + completionCost,
      promptCost,
      completionCost,
      currency: 'USD',
    };
  }

  private calculatePromptTokens(messages: ChatMessage[]): number {
    const fullPrompt = this.messagesToPrompt(messages);
    return this.calculateTokens(fullPrompt);
  }
}
