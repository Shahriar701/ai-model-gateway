import { Logger } from '../../shared/utils/logger';
import { MCPServer } from './mcp-server';
import { LLMRequest, ChatMessage } from '../../shared/types/llm-types';
import { MCPContent } from '../../shared/types/mcp-types';
import { MetricsService } from '../monitoring/metrics-service';
import { TracingService } from '../monitoring/tracing-service';
import { CorrelationService } from '../monitoring/correlation-service';

const logger = new Logger('MCPContextService');

/**
 * Enhanced service for integrating MCP context with LLM requests
 * Handles MCP tool execution, context injection, error handling, and monitoring
 */
export class MCPContextService {
  private mcpServer: MCPServer;
  private metricsService: MetricsService;
  private tracingService: TracingService;
  private correlationService: CorrelationService;
  private initialized = false;

  constructor() {
    this.mcpServer = new MCPServer();
    this.metricsService = MetricsService.getInstance();
    this.tracingService = TracingService.getInstance();
    this.correlationService = CorrelationService.getInstance();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.mcpServer.initialize();
      this.initialized = true;
      logger.info('MCP Context Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize MCP Context Service', error as Error);
      throw error;
    }
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
   * Execute MCP tools with enhanced error handling and monitoring
   */
  async executeMCPTools(
    toolCalls: Array<{
      toolName: string;
      arguments: Record<string, any>;
    }>,
    correlationId?: string
  ): Promise<{
    context: string;
    executedTools: string[];
    failedTools: string[];
    executionTime: number;
  }> {
    const startTime = Date.now();
    const results: string[] = [];
    const executedTools: string[] = [];
    const failedTools: string[] = [];
    const contextLogger = correlationId 
      ? this.correlationService.createContextualLogger(correlationId, 'MCPToolExecution')
      : logger;

    if (correlationId) {
      this.correlationService.addBreadcrumb(correlationId, 'mcp', 'tools_execution_start', {
        toolCount: toolCalls.length,
        tools: toolCalls.map(tc => tc.toolName),
      });
    }

    for (const toolCall of toolCalls) {
      const toolStartTime = Date.now();
      const subsegment = this.tracingService.createSubsegment(`mcp_tool_${toolCall.toolName}`, {
        toolName: toolCall.toolName,
        arguments: toolCall.arguments,
        correlationId,
      });

      try {
        contextLogger.info('Executing MCP tool', {
          toolName: toolCall.toolName,
          arguments: toolCall.arguments,
        });

        // Add timeout and retry logic for tool execution
        const response = await this.executeToolWithTimeout(toolCall, 10000); // 10 second timeout

        if (response.result?.content) {
          const content = response.result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
          
          if (content) {
            const formattedContent = this.formatToolResult(toolCall.toolName, content);
            results.push(formattedContent);
            executedTools.push(toolCall.toolName);

            // Record successful tool execution metrics
            await this.metricsService.recordMCPToolMetrics(
              toolCall.toolName,
              true,
              Date.now() - toolStartTime,
              correlationId
            );
          }
        } else if (response.error) {
          throw new Error(response.error.message || 'Tool execution failed');
        }

        this.tracingService.closeSubsegment(subsegment, undefined, {
          success: true,
          executionTime: Date.now() - toolStartTime,
        });

      } catch (error) {
        const errorMessage = (error as Error).message;
        contextLogger.error('MCP tool execution failed', error as Error, {
          toolName: toolCall.toolName,
          arguments: toolCall.arguments,
        });
        
        failedTools.push(toolCall.toolName);
        
        // Add graceful error handling - don't fail the entire request
        const errorResult = this.formatToolError(toolCall.toolName, errorMessage);
        results.push(errorResult);

        // Record failed tool execution metrics
        await this.metricsService.recordMCPToolMetrics(
          toolCall.toolName,
          false,
          Date.now() - toolStartTime,
          correlationId
        );

        this.tracingService.closeSubsegment(subsegment, error as Error, {
          success: false,
          executionTime: Date.now() - toolStartTime,
        });

        if (correlationId) {
          this.correlationService.addBreadcrumb(correlationId, 'mcp', 'tool_execution_failed', {
            toolName: toolCall.toolName,
            error: errorMessage,
          });
        }
      }
    }

    const totalExecutionTime = Date.now() - startTime;

    if (correlationId) {
      this.correlationService.addBreadcrumb(correlationId, 'mcp', 'tools_execution_complete', {
        executedTools,
        failedTools,
        totalExecutionTime,
        successRate: executedTools.length / toolCalls.length,
      });
    }

    contextLogger.info('MCP tools execution completed', {
      totalTools: toolCalls.length,
      executedTools: executedTools.length,
      failedTools: failedTools.length,
      executionTime: totalExecutionTime,
    });

    return {
      context: results.join('\n\n'),
      executedTools,
      failedTools,
      executionTime: totalExecutionTime,
    };
  }

  /**
   * Execute MCP tool with timeout protection
   */
  private async executeToolWithTimeout(
    toolCall: { toolName: string; arguments: Record<string, any> },
    timeoutMs: number
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Tool execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.mcpServer.handleRequest({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: toolCall.toolName,
          arguments: toolCall.arguments
        }
      }).then(response => {
        clearTimeout(timeout);
        resolve(response);
      }).catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Format tool result for better LLM understanding
   */
  private formatToolResult(toolName: string, content: string): string {
    const timestamp = new Date().toISOString();
    
    return `## 🔍 ${this.getToolDisplayName(toolName)} Results
*Retrieved at: ${timestamp}*

${this.enhanceContentFormatting(content)}`;
  }

  /**
   * Format tool error for graceful degradation
   */
  private formatToolError(toolName: string, errorMessage: string): string {
    return `## ⚠️ ${this.getToolDisplayName(toolName)} - Data Unavailable
*Unable to retrieve current data: ${errorMessage}*

Please note that this information may not be up to date. You may want to try again or check alternative sources.`;
  }

  /**
   * Get user-friendly tool display name
   */
  private getToolDisplayName(toolName: string): string {
    const displayNames: Record<string, string> = {
      'product_search': 'Product Search',
      'get_product': 'Product Details',
      'get_category_products': 'Category Products',
      'get_product_recommendations': 'Product Recommendations',
      'update_product_availability': 'Inventory Update',
    };
    
    return displayNames[toolName] || toolName;
  }

  /**
   * Enhance content formatting for better LLM parsing
   */
  private enhanceContentFormatting(content: string): string {
    return content
      // Format product entries
      .replace(/^Product: (.+)$/gm, '### 📦 $1')
      // Format key-value pairs
      .replace(/^(Price|Category|Description|Availability|Rating|Brand|Key Features): (.+)$/gm, '**$1**: $2')
      // Format availability status
      .replace(/\*\*Availability\*\*: true/g, '**Availability**: ✅ In Stock')
      .replace(/\*\*Availability\*\*: false/g, '**Availability**: ❌ Out of Stock')
      // Format ratings
      .replace(/\*\*Rating\*\*: (\d+(?:\.\d+)?)/g, '**Rating**: ⭐ $1/5')
      // Add spacing for better readability
      .replace(/^### /gm, '\n### ')
      .trim();
  }

  /**
   * Inject MCP context into LLM request with comprehensive error handling
   */
  async injectMCPContext(request: LLMRequest): Promise<LLMRequest> {
    const correlationId = request.metadata?.customFields?.correlationId;
    const contextLogger = correlationId 
      ? this.correlationService.createContextualLogger(correlationId, 'MCPContextInjection')
      : logger;

    try {
      // Ensure MCP service is initialized
      if (!this.initialized) {
        await this.initialize();
      }

      // Check if MCP tools should be executed
      const shouldExecute = await this.shouldExecuteMCPTools(request);
      if (!shouldExecute) {
        contextLogger.debug('MCP context injection skipped - no relevant keywords found');
        return request;
      }

      const lastMessage = request.messages[request.messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user') {
        contextLogger.debug('MCP context injection skipped - no user message found');
        return request;
      }

      // Extract and execute MCP tool calls
      const toolCalls = this.extractMCPToolCalls(lastMessage.content);
      if (toolCalls.length === 0) {
        contextLogger.debug('MCP context injection skipped - no tool calls extracted');
        return request;
      }

      contextLogger.info('Starting MCP context injection', {
        toolCalls: toolCalls.map(tc => tc.toolName),
        userMessage: lastMessage.content.substring(0, 100) + '...',
      });

      // Execute MCP tools with monitoring
      const mcpResult = await this.executeMCPTools(toolCalls, correlationId);
      
      if (!mcpResult.context) {
        contextLogger.warn('MCP context injection completed but no context generated');
        return request;
      }

      // Create enhanced request with MCP context
      const enhancedMessages: ChatMessage[] = [...request.messages];
      
      // Add system message with MCP context if no system message exists
      if (enhancedMessages[0]?.role !== 'system') {
        enhancedMessages.unshift({
          role: 'system',
          content: this.createSystemPromptWithContext(mcpResult.context, mcpResult)
        });
      } else {
        // Enhance existing system message
        enhancedMessages[0] = {
          ...enhancedMessages[0],
          content: `${enhancedMessages[0].content}\n\n${this.createContextSection(mcpResult.context, mcpResult)}`
        };
      }

      // Add MCP context as a separate message for better LLM understanding
      if (process.env.MCP_CONTEXT_AS_MESSAGE === 'true') {
        enhancedMessages.splice(-1, 0, {
          role: 'system',
          content: `## Current Product Information\n${mcpResult.context}\n\n*Use this information to provide accurate, up-to-date responses about products.*`
        });
      }

      contextLogger.info('MCP context injected successfully', {
        toolCallsCount: toolCalls.length,
        executedTools: mcpResult.executedTools.length,
        failedTools: mcpResult.failedTools.length,
        contextLength: mcpResult.context.length,
        executionTime: mcpResult.executionTime,
        originalMessageCount: request.messages.length,
        enhancedMessageCount: enhancedMessages.length
      });

      // Record MCP context injection metrics
      await this.metricsService.recordMCPContextMetrics(
        toolCalls.length,
        mcpResult.executedTools.length,
        mcpResult.failedTools.length,
        mcpResult.executionTime,
        correlationId
      );

      return {
        ...request,
        messages: enhancedMessages,
        metadata: {
          ...request.metadata,
          mcpContextInjected: true,
          mcpToolCalls: toolCalls.map(tc => tc.toolName),
          mcpExecutedTools: mcpResult.executedTools,
          mcpFailedTools: mcpResult.failedTools,
          mcpExecutionTime: mcpResult.executionTime,
          mcpContextLength: mcpResult.context.length,
        }
      };
    } catch (error) {
      contextLogger.error('Failed to inject MCP context', error as Error, {
        userId: request.metadata?.userId,
        messageCount: request.messages.length,
      });

      // Record MCP error metrics
      await this.metricsService.recordMCPErrorMetrics(
        'context_injection_failed',
        (error as Error).message,
        correlationId
      );

      // Return original request on failure - don't break the LLM request
      return {
        ...request,
        metadata: {
          ...request.metadata,
          mcpContextInjected: false,
          mcpError: (error as Error).message,
        }
      };
    }
  }

  /**
   * Create enhanced system prompt with MCP context and execution metadata
   */
  private createSystemPromptWithContext(
    mcpContext: string, 
    mcpResult: { executedTools: string[]; failedTools: string[]; executionTime: number }
  ): string {
    const timestamp = new Date().toISOString();
    const successRate = mcpResult.executedTools.length / (mcpResult.executedTools.length + mcpResult.failedTools.length);
    
    let contextQuality = '';
    if (successRate === 1) {
      contextQuality = '✅ Complete product data available';
    } else if (successRate > 0.5) {
      contextQuality = '⚠️ Partial product data available';
    } else {
      contextQuality = '❌ Limited product data available';
    }

    return `You are an AI assistant with access to real-time e-commerce product information. Use the following product data to provide accurate, helpful responses about products, pricing, and availability.

## 📊 Data Status: ${contextQuality}
*Retrieved at: ${timestamp}*
*Execution time: ${mcpResult.executionTime}ms*
*Successful tools: ${mcpResult.executedTools.join(', ') || 'none'}*
${mcpResult.failedTools.length > 0 ? `*Failed tools: ${mcpResult.failedTools.join(', ')}*` : ''}

## 🛍️ Available Product Information:
${mcpContext}

## 📋 Response Guidelines:
- **Accuracy First**: Use only the product information provided above
- **Be Specific**: Always mention exact prices, availability status, and key features when available
- **Acknowledge Limitations**: If asked about products not in the provided data, clearly state that you don't have current information about those specific products
- **User-Friendly Format**: Present product information in a clear, scannable format with emojis and bullet points
- **Comparative Analysis**: When comparing products, highlight key differences, similarities, and value propositions
- **Actionable Advice**: Provide purchasing recommendations based on user needs and product data
- **Handle Errors Gracefully**: If some data is unavailable due to system issues, mention this and work with available information

## 💡 Response Style:
- Use emojis to make responses more engaging (📦 for products, 💰 for prices, ⭐ for ratings)
- Structure responses with clear headings and bullet points
- Include availability status prominently
- Suggest alternatives when primary options aren't available`;
  }

  /**
   * Create enhanced context section for existing system prompt
   */
  private createContextSection(
    mcpContext: string,
    mcpResult: { executedTools: string[]; failedTools: string[]; executionTime: number }
  ): string {
    const timestamp = new Date().toISOString();
    
    return `## 🔄 Updated Product Information (${timestamp})
*Data retrieved in ${mcpResult.executionTime}ms using: ${mcpResult.executedTools.join(', ') || 'no tools'}*

${mcpContext}

**Important**: Use this updated product information to provide accurate responses about products, pricing, and availability. This data takes precedence over any previous product information.`;
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

  /**
   * Get MCP service health status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    initialized: boolean;
    serverStatus: string;
    lastError?: string;
  }> {
    try {
      if (!this.initialized) {
        return {
          status: 'unhealthy',
          initialized: false,
          serverStatus: 'not_initialized',
        };
      }

      // Test MCP server with a simple tool list request
      const response = await this.mcpServer.handleRequest({
        jsonrpc: '2.0',
        id: 'health_check',
        method: 'tools/list',
        params: {}
      });

      if (response.result) {
        return {
          status: 'healthy',
          initialized: true,
          serverStatus: 'operational',
        };
      } else {
        return {
          status: 'degraded',
          initialized: true,
          serverStatus: 'partial_failure',
          lastError: response.error?.message,
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        initialized: this.initialized,
        serverStatus: 'error',
        lastError: (error as Error).message,
      };
    }
  }

  /**
   * Get MCP service statistics
   */
  getStatistics(): {
    initialized: boolean;
    totalToolsAvailable: number;
    supportedMethods: string[];
  } {
    return {
      initialized: this.initialized,
      totalToolsAvailable: 5, // Based on the tools defined in MCP server
      supportedMethods: [
        'tools/list',
        'tools/call', 
        'resources/list',
        'resources/read',
        'initialize'
      ],
    };
  }

  /**
   * Validate MCP tool call arguments
   */
  private validateToolArguments(toolName: string, args: Record<string, any>): boolean {
    const validationRules: Record<string, (args: any) => boolean> = {
      'product_search': (args) => typeof args.query === 'string' && args.query.length > 0,
      'get_product': (args) => typeof args.productId === 'string' && args.productId.length > 0,
      'get_category_products': (args) => typeof args.category === 'string' && args.category.length > 0,
      'get_product_recommendations': (args) => args.basedOnProductId || args.category,
      'update_product_availability': (args) => args.productId && typeof args.inStock === 'boolean',
    };

    const validator = validationRules[toolName];
    return validator ? validator(args) : false;
  }

  /**
   * Enhanced tool call extraction with validation
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

      const args = {
        query,
        category,
        priceRange: { max: maxPrice }
      };

      if (this.validateToolArguments('product_search', args)) {
        toolCalls.push({
          toolName: 'product_search',
          arguments: args
        });
        return toolCalls; // Return early if we found a full match
      }
    }

    // Enhanced patterns for various search types
    const searchPatterns = [
      { pattern: /(?:search for|looking for|find|show me)\s+(.+?)(?:\s+in\s+(\w+)\s+category)?/i, tool: 'product_search' },
      { pattern: /I (?:want to search for|am looking for)\s+(.+?)(?:\s+under\s+\$?(\d+))?/i, tool: 'product_search' },
      { pattern: /(?:recommend|suggest)\s+(.+?)(?:\s+for\s+(.+?))?/i, tool: 'product_search' },
    ];

    for (const { pattern, tool } of searchPatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        const query = match[1].trim();
        const args: Record<string, any> = { query };
        
        // Add category if captured
        if (match[2]) {
          args.category = match[2].trim();
        }
        
        // Add price limit if captured
        if (match[3]) {
          args.priceRange = { max: parseInt(match[3]) };
        }

        if (this.validateToolArguments(tool, args)) {
          toolCalls.push({
            toolName: tool,
            arguments: args
          });
          break;
        }
      }
    }

    // Pattern for specific product requests
    const productIdPattern = /product\s+(?:id\s+)?([a-zA-Z0-9_-]+)/i;
    const productMatch = userMessage.match(productIdPattern);
    if (productMatch) {
      const args = { productId: productMatch[1] };
      if (this.validateToolArguments('get_product', args)) {
        toolCalls.push({
          toolName: 'get_product',
          arguments: args
        });
      }
    }

    // Pattern for category browsing
    const categoryPattern = /(?:show|list|browse)\s+(.+?)\s+(?:category|products)/i;
    const categoryMatch = userMessage.match(categoryPattern);
    if (categoryMatch) {
      const args = { category: categoryMatch[1].trim() };
      if (this.validateToolArguments('get_category_products', args)) {
        toolCalls.push({
          toolName: 'get_category_products',
          arguments: args
        });
      }
    }

    return toolCalls;
  }
}