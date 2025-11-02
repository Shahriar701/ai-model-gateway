import { Logger } from '../../shared/utils/logger';
import { MCPServer } from './mcp-server';
import { LLMRequest, ChatMessage } from '../../shared/types/llm-types';
import { MCPContent } from '../../shared/types/mcp-types';

const logger = new Logger('MCPContextService');

/**
 * Service for integrating MCP context with LLM requests
 * Handles MCP tool execution and context injection into prompts
 */
export class MCPContextService {
  private mcpServer: MCPServer;

  constructor() {
    this.mcpServer = new MCPServer();
  }

  async initialize(): Promise<void> {
    await this.mcpServer.initialize();
    logger.info('MCP Context Service initialized');
  }

  /**
   * Analyze LLM request and determine if MCP tools should be executed
   */
  async shouldExecuteMCPTools(request: LLMRequest): Promise<boolean> {
    const lastMessage = request.messages[request.messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      return false;
    }

    const content = lastMessage.content.toLowerCase();
    
    // Check for product-related keywords and phrases
    const productKeywords = [
      'product', 'products', 'buy', 'purchase', 'price', 'cost',
      'search', 'find', 'recommend', 'compare', 'available',
      'category', 'brand', 'specification', 'review', 'rating',
      'headphones', 'watch', 'electronics', 'wearables',
      'looking for', 'want to buy', 'show me'
    ];

    return productKeywords.some(keyword => content.includes(keyword));
  }

  /**
   * Extract MCP tool calls from user message
   */
  extractMCPToolCalls(userMessage: string): Array<{
    toolName: string;
    arguments: Record<string, any>;
  }> {
    const toolCalls: Array<{ toolName: string; arguments: Record<string, any> }> = [];

    // Pattern for "I want to search for X in Y category under Z"
    const fullSearchPattern = /I want to search for\s+(.+?)\s+in\s+(\w+)\s+category\s+under\s+(\d+)/i;
    const fullMatch = userMessage.match(fullSearchPattern);
    if (fullMatch) {
      const query = fullMatch[1].trim();
      const category = fullMatch[2].trim();
      const maxPrice = parseInt(fullMatch[3]);

      toolCalls.push({
        toolName: 'product_search',
        arguments: {
          query,
          category,
          priceRange: { max: maxPrice }
        }
      });
      return toolCalls; // Return early if we found a full match
    }

    // Simpler patterns for basic searches
    const simplePatterns = [
      /(?:search for|looking for|find|show me)\s+(.+)/i,
      /I (?:want to search for|am looking for)\s+(.+)/i
    ];

    for (const pattern of simplePatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        const query = match[1].trim();
        
        toolCalls.push({
          toolName: 'product_search',
          arguments: { query }
        });
        break;
      }
    }

    // Pattern for specific product requests
    const productIdPattern = /product\s+(?:id\s+)?([a-zA-Z0-9_-]+)/i;
    const productMatch = userMessage.match(productIdPattern);
    if (productMatch) {
      toolCalls.push({
        toolName: 'get_product',
        arguments: { productId: productMatch[1] }
      });
    }

    // Pattern for category browsing
    const categoryPattern = /(?:show|list|browse)\s+(.+?)\s+(?:category|products)/i;
    const categoryMatch = userMessage.match(categoryPattern);
    if (categoryMatch) {
      toolCalls.push({
        toolName: 'get_category_products',
        arguments: { category: categoryMatch[1].trim() }
      });
    }

    return toolCalls;
  }

  /**
   * Execute MCP tools and return formatted context
   */
  async executeMCPTools(toolCalls: Array<{
    toolName: string;
    arguments: Record<string, any>;
  }>): Promise<string> {
    const results: string[] = [];

    for (const toolCall of toolCalls) {
      try {
        logger.info('Executing MCP tool', {
          toolName: toolCall.toolName,
          arguments: toolCall.arguments
        });

        const response = await this.mcpServer.handleRequest({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: toolCall.toolName,
            arguments: toolCall.arguments
          }
        });

        if (response.result?.content) {
          const content = response.result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
          
          if (content) {
            results.push(`## ${toolCall.toolName} Results:\n${content}`);
          }
        }
      } catch (error) {
        logger.error('MCP tool execution failed', error as Error, {
          toolName: toolCall.toolName,
          arguments: toolCall.arguments
        });
        
        results.push(`## ${toolCall.toolName} Error:\nFailed to retrieve data: ${(error as Error).message}`);
      }
    }

    return results.join('\n\n');
  }

  /**
   * Inject MCP context into LLM request
   */
  async injectMCPContext(request: LLMRequest): Promise<LLMRequest> {
    try {
      // Check if MCP tools should be executed
      const shouldExecute = await this.shouldExecuteMCPTools(request);
      if (!shouldExecute) {
        return request;
      }

      const lastMessage = request.messages[request.messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user') {
        return request;
      }

      // Extract and execute MCP tool calls
      const toolCalls = this.extractMCPToolCalls(lastMessage.content);
      if (toolCalls.length === 0) {
        return request;
      }

      const mcpContext = await this.executeMCPTools(toolCalls);
      if (!mcpContext) {
        return request;
      }

      // Create enhanced request with MCP context
      const enhancedMessages: ChatMessage[] = [...request.messages];
      
      // Add system message with MCP context if no system message exists
      if (enhancedMessages[0]?.role !== 'system') {
        enhancedMessages.unshift({
          role: 'system',
          content: this.createSystemPromptWithContext(mcpContext)
        });
      } else {
        // Enhance existing system message
        enhancedMessages[0] = {
          ...enhancedMessages[0],
          content: `${enhancedMessages[0].content}\n\n${this.createContextSection(mcpContext)}`
        };
      }

      logger.info('MCP context injected into LLM request', {
        toolCallsCount: toolCalls.length,
        contextLength: mcpContext.length,
        originalMessageCount: request.messages.length,
        enhancedMessageCount: enhancedMessages.length
      });

      return {
        ...request,
        messages: enhancedMessages,
        metadata: {
          ...request.metadata,
          mcpContextInjected: true,
          mcpToolCalls: toolCalls.map(tc => tc.toolName)
        }
      };
    } catch (error) {
      logger.error('Failed to inject MCP context', error as Error);
      return request;
    }
  }

  /**
   * Create system prompt with MCP context
   */
  private createSystemPromptWithContext(mcpContext: string): string {
    return `You are an AI assistant with access to real-time product information. Use the following product data to provide accurate, helpful responses about products, pricing, and availability.

## Available Product Information:
${mcpContext}

## Instructions:
- Use the product information provided above to answer user questions
- Always mention specific prices, availability, and key features when relevant
- If asked about products not in the provided data, clearly state that you don't have current information about those specific products
- Format product information in a clear, user-friendly way
- Include relevant details like pricing, availability, ratings, and key features
- When comparing products, highlight the key differences and similarities`;
  }

  /**
   * Create context section for existing system prompt
   */
  private createContextSection(mcpContext: string): string {
    return `## Current Product Information:
${mcpContext}

Please use this product information to provide accurate responses about products, pricing, and availability.`;
  }

  /**
   * Format MCP context for better LLM understanding
   */
  formatContextForLLM(mcpContext: string): string {
    // Add structured formatting to help LLM parse the context better
    return mcpContext
      .replace(/^## (.+)$/gm, '\n**$1**\n')
      .replace(/^Product: (.+)$/gm, '\n### $1')
      .replace(/^(Price|Category|Description|Availability|Rating|Brand|Key Features): (.+)$/gm, '- **$1**: $2');
  }
}