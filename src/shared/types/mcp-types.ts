/**
 * Model Context Protocol (MCP) types and interfaces
 * Defines the protocol for connecting LLMs to structured data sources
 */

/**
 * Core MCP message types
 */
export interface MCPMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: MCPError;
}

export interface MCPRequest extends MCPMessage {
  method: string;
  params?: Record<string, any>;
}

export interface MCPResponse extends MCPMessage {
  result?: any;
  error?: MCPError;
}

export interface MCPNotification extends MCPMessage {
  method: string;
  params?: Record<string, any>;
}

export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

/**
 * MCP Server capabilities and initialization
 */
export interface MCPServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: {};
}

export interface MCPClientCapabilities {
  experimental?: Record<string, any>;
  sampling?: {};
}

export interface MCPInitializeRequest extends MCPRequest {
  method: 'initialize';
  params: {
    protocolVersion: string;
    capabilities: MCPClientCapabilities;
    clientInfo: {
      name: string;
      version: string;
    };
  };
}

export interface MCPInitializeResponse extends MCPResponse {
  result: {
    protocolVersion: string;
    capabilities: MCPServerCapabilities;
    serverInfo: {
      name: string;
      version: string;
    };
  };
}

/**
 * MCP Tools - Functions that can be called by LLMs
 */
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: JSONSchema;
}

export interface MCPToolsListRequest extends MCPRequest {
  method: 'tools/list';
  params?: {
    cursor?: string;
  };
}

export interface MCPToolsListResponse extends MCPResponse {
  result: {
    tools: MCPTool[];
    nextCursor?: string;
  };
}

export interface MCPToolsCallRequest extends MCPRequest {
  method: 'tools/call';
  params: {
    name: string;
    arguments?: Record<string, any>;
  };
}

export interface MCPToolsCallResponse extends MCPResponse {
  result: {
    content: MCPContent[];
    isError?: boolean;
  };
}

/**
 * MCP Resources - Data that can be read by LLMs
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourcesListRequest extends MCPRequest {
  method: 'resources/list';
  params?: {
    cursor?: string;
  };
}

export interface MCPResourcesListResponse extends MCPResponse {
  result: {
    resources: MCPResource[];
    nextCursor?: string;
  };
}

export interface MCPResourcesReadRequest extends MCPRequest {
  method: 'resources/read';
  params: {
    uri: string;
  };
}

export interface MCPResourcesReadResponse extends MCPResponse {
  result: {
    contents: MCPResourceContent[];
  };
}

export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64 encoded
}

/**
 * MCP Prompts - Reusable prompt templates
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface MCPPromptsListRequest extends MCPRequest {
  method: 'prompts/list';
  params?: {
    cursor?: string;
  };
}

export interface MCPPromptsListResponse extends MCPResponse {
  result: {
    prompts: MCPPrompt[];
    nextCursor?: string;
  };
}

export interface MCPPromptsGetRequest extends MCPRequest {
  method: 'prompts/get';
  params: {
    name: string;
    arguments?: Record<string, any>;
  };
}

export interface MCPPromptsGetResponse extends MCPResponse {
  result: {
    description?: string;
    messages: MCPPromptMessage[];
  };
}

export interface MCPPromptMessage {
  role: 'user' | 'assistant';
  content: MCPContent;
}

/**
 * MCP Content types
 */
export type MCPContent = MCPTextContent | MCPImageContent | MCPResourceContent;

export interface MCPTextContent {
  type: 'text';
  text: string;
}

export interface MCPImageContent {
  type: 'image';
  data: string; // base64 encoded
  mimeType: string;
}

/**
 * MCP Logging
 */
export interface MCPLoggingSetLevelRequest extends MCPRequest {
  method: 'logging/setLevel';
  params: {
    level: MCPLogLevel;
  };
}

export enum MCPLogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  NOTICE = 'notice',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
  ALERT = 'alert',
  EMERGENCY = 'emergency',
}

export interface MCPLogMessage extends MCPNotification {
  method: 'notifications/message';
  params: {
    level: MCPLogLevel;
    logger?: string;
    data: any;
  };
}

/**
 * MCP Sampling - For LLM sampling requests
 */
export interface MCPSamplingCreateMessageRequest extends MCPRequest {
  method: 'sampling/createMessage';
  params: {
    messages: MCPSamplingMessage[];
    modelPreferences?: MCPModelPreferences;
    systemPrompt?: string;
    includeContext?: string;
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
    metadata?: Record<string, any>;
  };
}

export interface MCPSamplingMessage {
  role: 'user' | 'assistant';
  content: MCPContent;
}

export interface MCPModelPreferences {
  hints?: MCPModelHint[];
  costPriority?: number; // 0-1, higher = more cost sensitive
  speedPriority?: number; // 0-1, higher = more speed sensitive
  intelligencePriority?: number; // 0-1, higher = more intelligence sensitive
}

export interface MCPModelHint {
  name?: string;
}

export interface MCPSamplingCreateMessageResponse extends MCPResponse {
  result: {
    role: 'assistant';
    content: MCPContent;
    model: string;
    stopReason?: 'endTurn' | 'stopSequence' | 'maxTokens';
  };
}

/**
 * Product-specific MCP tools and resources
 */
export interface ProductSearchTool extends MCPTool {
  name: 'product_search';
  description: 'Search for products in the catalog';
  inputSchema: {
    type: 'object';
    properties: {
      query: { type: 'string'; description: 'Search query' };
      category?: { type: 'string'; description: 'Product category filter' };
      priceRange?: {
        type: 'object';
        properties: {
          min: { type: 'number' };
          max: { type: 'number' };
        };
      };
      limit?: { type: 'number'; description: 'Maximum number of results'; default: 10 };
    };
    required: ['query'];
  };
}

export interface ProductDetailsTool extends MCPTool {
  name: 'product_details';
  description: 'Get detailed information about a specific product';
  inputSchema: {
    type: 'object';
    properties: {
      productId: { type: 'string'; description: 'Product ID' };
    };
    required: ['productId'];
  };
}

export interface ProductCompareTool extends MCPTool {
  name: 'product_compare';
  description: 'Compare multiple products';
  inputSchema: {
    type: 'object';
    properties: {
      productIds: {
        type: 'array';
        items: { type: 'string' };
        description: 'List of product IDs to compare';
        minItems: 2;
        maxItems: 5;
      };
    };
    required: ['productIds'];
  };
}

export interface ProductRecommendationsTool extends MCPTool {
  name: 'product_recommendations';
  description: 'Get product recommendations based on user preferences or product';
  inputSchema: {
    type: 'object';
    properties: {
      basedOn?: { type: 'string'; description: 'Product ID to base recommendations on' };
      category?: { type: 'string'; description: 'Category for recommendations' };
      userPreferences?: {
        type: 'object';
        properties: {
          priceRange?: {
            type: 'object';
            properties: {
              min: { type: 'number' };
              max: { type: 'number' };
            };
          };
          brands?: { type: 'array'; items: { type: 'string' } };
          features?: { type: 'array'; items: { type: 'string' } };
        };
      };
      limit?: { type: 'number'; default: 5 };
    };
  };
}

/**
 * JSON Schema type for tool input schemas
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: any[];
  const?: any;
  default?: any;
  description?: string;
  title?: string;
  examples?: any[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: string;
  additionalProperties?: boolean | JSONSchema;
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  allOf?: JSONSchema[];
  not?: JSONSchema;
}

/**
 * MCP Server implementation interface
 */
export interface MCPServer {
  // Lifecycle
  initialize(capabilities: MCPClientCapabilities): Promise<MCPServerCapabilities>;
  shutdown(): Promise<void>;
  
  // Tools
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, args: Record<string, any>): Promise<MCPContent[]>;
  
  // Resources
  listResources(): Promise<MCPResource[]>;
  readResource(uri: string): Promise<MCPResourceContent[]>;
  
  // Prompts
  listPrompts(): Promise<MCPPrompt[]>;
  getPrompt(name: string, args: Record<string, any>): Promise<MCPPromptMessage[]>;
  
  // Logging
  setLogLevel(level: MCPLogLevel): Promise<void>;
  
  // Event handling
  onRequest(handler: (request: MCPRequest) => Promise<MCPResponse>): void;
  onNotification(handler: (notification: MCPNotification) => Promise<void>): void;
}

/**
 * MCP Client interface
 */
export interface MCPClient {
  // Connection
  connect(transport: MCPTransport): Promise<void>;
  disconnect(): Promise<void>;
  
  // Server interaction
  initialize(clientInfo: { name: string; version: string }): Promise<MCPServerCapabilities>;
  
  // Tools
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, args: Record<string, any>): Promise<MCPContent[]>;
  
  // Resources
  listResources(): Promise<MCPResource[]>;
  readResource(uri: string): Promise<MCPResourceContent[]>;
  
  // Prompts
  listPrompts(): Promise<MCPPrompt[]>;
  getPrompt(name: string, args: Record<string, any>): Promise<MCPPromptMessage[]>;
  
  // Sampling
  createMessage(
    messages: MCPSamplingMessage[],
    options?: {
      modelPreferences?: MCPModelPreferences;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<MCPContent>;
}

/**
 * MCP Transport interface
 */
export interface MCPTransport {
  send(message: MCPMessage): Promise<void>;
  receive(): Promise<MCPMessage>;
  close(): Promise<void>;
  onMessage(handler: (message: MCPMessage) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (error: Error) => void): void;
}