import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../../src/lambda/gateway/handler';
import { MCPContextService } from '../../src/services/mcp/mcp-context-service';
import { ProductService } from '../../src/services/mcp/product-service';
import { TestConfig, TestDataGenerator } from './test-config';

describe('MCP E-commerce Scenarios Integration Tests', () => {
  let testConfig: TestConfig;
  let mcpContextService: MCPContextService;
  let productService: ProductService;
  let testApiKey: string;
  let testUserId: string;

  beforeAll(async () => {
    testConfig = TestConfig.getInstance();
    await testConfig.setupTestEnvironment();

    // Initialize MCP services
    mcpContextService = new MCPContextService();
    productService = new ProductService();
    await mcpContextService.initialize();

    // Create test user and API key
    testUserId = TestDataGenerator.generateUserId('mcp-test');
    testApiKey = await testConfig.createTestApiKey(testUserId, 'premium');

    // Wait for configuration propagation
    await testConfig.waitForConfigPropagation();

    // Verify system health
    const isHealthy = await testConfig.verifySystemHealth();
    if (!isHealthy) {
      throw new Error('System health check failed - cannot run MCP tests');
    }
  });

  afterAll(async () => {
    await testConfig.cleanupTestEnvironment();
  });

  describe('11.2 MCP E-commerce Scenario Validation', () => {
    test('should complete product search workflows through LLM requests', async () => {
      const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'I need wireless headphones under $100. Can you help me find some good options?',
            },
          ],
          maxTokens: 300,
          temperature: 0.7,
        }),
      });

      const response: APIGatewayProxyResult = await handler(event);

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.choices).toHaveLength(1);
      
      const assistantMessage = responseBody.choices[0].message.content;
      
      // Verify that the response contains product-related information
      expect(assistantMessage.toLowerCase()).toMatch(/headphones?/);
      expect(assistantMessage.toLowerCase()).toMatch(/\$\d+|\d+\s*dollars?/); // Price mentions
      
      // Verify MCP context was injected
      expect(responseBody.metadata?.mcpContextInjected).toBe(true);
      
      // Check for product recommendations structure
      expect(assistantMessage).toMatch(/recommend|suggest|option|choice/i);
    });

    test('should validate LLM responses with product context integration and formatting', async () => {
      const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'Show me laptops for gaming under $1500 with good graphics cards',
            },
          ],
          maxTokens: 400,
          temperature: 0.5,
        }),
      });

      const response: APIGatewayProxyResult = await handler(event);

      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      const assistantMessage = responseBody.choices[0].message.content;
      
      // Verify product context integration
      expect(assistantMessage.toLowerCase()).toMatch(/laptop|gaming|graphics/);
      expect(assistantMessage.toLowerCase()).toMatch(/\$1,?500|\$1500|1500\s*dollars?/);
      
      // Check for structured product information
      expect(assistantMessage).toMatch(/specification|feature|performance|price/i);
      
      // Verify proper formatting for e-commerce context
      expect(assistantMessage).toMatch(/model|brand|available|stock/i);
      
      // Check that MCP tools were executed
      expect(responseBody.metadata?.mcpToolCalls).toBeDefined();
      if (responseBody.metadata?.mcpToolCalls) {
        expect(responseBody.metadata.mcpToolCalls.length).toBeGreaterThan(0);
      }
    });

    test('should handle real-time inventory and pricing updates through MCP tools', async () => {
      // First, test a product search request
      const searchEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'Check the current price and availability of iPhone 15 Pro',
            },
          ],
          maxTokens: 200,
          temperature: 0.3,
        }),
      });

      const searchResponse: APIGatewayProxyResult = await handler(searchEvent);
      expect(searchResponse.statusCode).toBe(200);
      
      const searchBody = JSON.parse(searchResponse.body);
      const searchMessage = searchBody.choices[0].message.content;
      
      // Verify real-time data integration
      expect(searchMessage.toLowerCase()).toMatch(/iphone|price|available|stock/);
      expect(searchMessage).toMatch(/\$\d+|currently|now|today/i);
      
      // Follow up with a more specific inventory check
      const inventoryEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'Is the iPhone 15 Pro 256GB in Natural Titanium currently in stock?',
            },
          ],
          maxTokens: 150,
          temperature: 0.2,
        }),
      });

      const inventoryResponse: APIGatewayProxyResult = await handler(inventoryEvent);
      expect(inventoryResponse.statusCode).toBe(200);
      
      const inventoryBody = JSON.parse(inventoryResponse.body);
      const inventoryMessage = inventoryBody.choices[0].message.content;
      
      // Verify specific inventory information
      expect(inventoryMessage.toLowerCase()).toMatch(/stock|available|inventory|in stock|out of stock/);
      expect(inventoryMessage.toLowerCase()).toMatch(/256gb|natural titanium/);
    });

    test('should create sample e-commerce conversation flows with product recommendations', async () => {
      // Simulate a complete e-commerce conversation flow
      const conversationSteps = [
        {
          userMessage: 'I\'m looking for a new smartphone with a good camera',
          expectedKeywords: ['smartphone', 'camera', 'photo', 'recommend'],
        },
        {
          userMessage: 'What\'s the difference between iPhone 15 and Samsung Galaxy S24?',
          expectedKeywords: ['iphone', 'samsung', 'galaxy', 'difference', 'compare'],
        },
        {
          userMessage: 'Which one has better battery life and is under $800?',
          expectedKeywords: ['battery', 'life', '$800', 'better', 'price'],
        },
        {
          userMessage: 'Can you check if the recommended phone is available for delivery this week?',
          expectedKeywords: ['available', 'delivery', 'week', 'shipping', 'stock'],
        },
      ];

      const conversationHistory: any[] = [];

      for (let i = 0; i < conversationSteps.length; i++) {
        const step = conversationSteps[i];
        
        // Build conversation history
        conversationHistory.push({
          role: 'user',
          content: step.userMessage,
        });

        const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: conversationHistory,
            maxTokens: 300,
            temperature: 0.6,
          }),
        });

        const response: APIGatewayProxyResult = await handler(event);
        expect(response.statusCode).toBe(200);
        
        const responseBody = JSON.parse(response.body);
        const assistantMessage = responseBody.choices[0].message.content;
        
        // Add assistant response to conversation history
        conversationHistory.push({
          role: 'assistant',
          content: assistantMessage,
        });

        // Verify that the response contains expected keywords
        const messageText = assistantMessage.toLowerCase();
        const hasExpectedKeywords = step.expectedKeywords.some(keyword => 
          messageText.includes(keyword.toLowerCase())
        );
        
        expect(hasExpectedKeywords).toBe(true);
        
        // Verify MCP integration for product-related queries
        if (i > 0) { // Skip first message as it's just initial query
          expect(responseBody.metadata?.mcpContextInjected).toBe(true);
        }

        // Add small delay between conversation steps
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Verify the conversation maintained context
      const finalMessage = conversationHistory[conversationHistory.length - 1].content.toLowerCase();
      expect(finalMessage).toMatch(/delivery|shipping|available|stock/);
    });

    test('should handle complex product comparison scenarios', async () => {
      const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'Compare the top 3 wireless earbuds under $200. I care about sound quality, battery life, and noise cancellation.',
            },
          ],
          maxTokens: 500,
          temperature: 0.4,
        }),
      });

      const response: APIGatewayProxyResult = await handler(event);
      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      const assistantMessage = responseBody.choices[0].message.content;
      
      // Verify comparison structure
      expect(assistantMessage.toLowerCase()).toMatch(/compare|comparison|vs|versus/);
      expect(assistantMessage.toLowerCase()).toMatch(/earbuds|wireless/);
      expect(assistantMessage.toLowerCase()).toMatch(/sound quality|battery|noise cancellation/);
      expect(assistantMessage).toMatch(/\$200|200\s*dollars?/);
      
      // Check for structured comparison (should mention multiple products)
      const productMentions = (assistantMessage.match(/\b(airpods|sony|bose|jabra|sennheiser)\b/gi) || []).length;
      expect(productMentions).toBeGreaterThan(1);
      
      // Verify detailed product information
      expect(assistantMessage.toLowerCase()).toMatch(/hour|battery life|db|frequency/);
    });

    test('should handle product availability and stock notifications', async () => {
      const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'Is the MacBook Pro 14-inch with M3 chip currently available? If not, when will it be back in stock?',
            },
          ],
          maxTokens: 200,
          temperature: 0.2,
        }),
      });

      const response: APIGatewayProxyResult = await handler(event);
      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      const assistantMessage = responseBody.choices[0].message.content;
      
      // Verify stock information handling
      expect(assistantMessage.toLowerCase()).toMatch(/macbook pro|m3 chip/);
      expect(assistantMessage.toLowerCase()).toMatch(/available|stock|inventory/);
      
      // Should provide actionable information
      expect(assistantMessage.toLowerCase()).toMatch(/currently|now|today|available|out of stock|in stock/);
      
      // Verify MCP tool execution for real-time data
      expect(responseBody.metadata?.mcpToolCalls).toBeDefined();
    });

    test('should integrate product recommendations with user preferences', async () => {
      const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'I\'m a photographer who travels a lot. I need a laptop that\'s lightweight, has excellent display quality, and good battery life. Budget is around $2000.',
            },
          ],
          maxTokens: 400,
          temperature: 0.5,
        }),
      });

      const response: APIGatewayProxyResult = await handler(event);
      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      const assistantMessage = responseBody.choices[0].message.content;
      
      // Verify personalized recommendations
      expect(assistantMessage.toLowerCase()).toMatch(/photographer|photography/);
      expect(assistantMessage.toLowerCase()).toMatch(/travel|portable|lightweight/);
      expect(assistantMessage.toLowerCase()).toMatch(/display|screen|color/);
      expect(assistantMessage.toLowerCase()).toMatch(/battery/);
      expect(assistantMessage).toMatch(/\$2,?000|2000\s*dollars?/);
      
      // Should provide specific product recommendations
      expect(assistantMessage.toLowerCase()).toMatch(/laptop|macbook|thinkpad|dell|hp/);
      expect(assistantMessage.toLowerCase()).toMatch(/recommend|suggest|consider/);
      
      // Verify technical specifications are included
      expect(assistantMessage.toLowerCase()).toMatch(/inch|resolution|hours|weight|pounds|kg/);
    });

    test('should handle seasonal and promotional product queries', async () => {
      const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'What are the best Black Friday deals on gaming monitors this year?',
            },
          ],
          maxTokens: 350,
          temperature: 0.4,
        }),
      });

      const response: APIGatewayProxyResult = await handler(event);
      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      const assistantMessage = responseBody.choices[0].message.content;
      
      // Verify seasonal/promotional context
      expect(assistantMessage.toLowerCase()).toMatch(/black friday|deal|sale|discount/);
      expect(assistantMessage.toLowerCase()).toMatch(/gaming monitor|monitor/);
      
      // Should provide current pricing information
      expect(assistantMessage).toMatch(/\$\d+|price|cost|save|off/);
      
      // Verify promotional information handling
      expect(assistantMessage.toLowerCase()).toMatch(/deal|offer|promotion|discount|sale/);
    });
  });

  describe('MCP Tool Integration Tests', () => {
    test('should execute product search tools correctly', async () => {
      // Test direct MCP context injection
      const testRequest = TestDataGenerator.generateLLMRequest({
        messages: [
          {
            role: 'user',
            content: 'Find me the best tablets for digital art under $600',
          },
        ],
      });

      const enrichedRequest = await mcpContextService.injectMCPContext(testRequest);
      
      // Verify MCP context was injected
      expect(enrichedRequest.metadata?.mcpContextInjected).toBe(true);
      expect(enrichedRequest.metadata?.mcpToolCalls).toBeDefined();
      
      // Verify product search was executed
      const toolCalls = enrichedRequest.metadata?.mcpToolCalls || [];
      const hasProductSearch = toolCalls.some((call: any) => 
        call.tool === 'product_search' || call.name === 'product_search'
      );
      expect(hasProductSearch).toBe(true);
    });

    test('should handle MCP tool failures gracefully', async () => {
      // Test with a query that might cause MCP tool issues
      const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'Find products with invalid category xyz123 and negative price range',
            },
          ],
          maxTokens: 200,
          temperature: 0.3,
        }),
      });

      const response: APIGatewayProxyResult = await handler(event);
      
      // Should still return a valid response even if MCP tools fail
      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      expect(responseBody.choices).toHaveLength(1);
      
      // Response should handle the error gracefully
      const assistantMessage = responseBody.choices[0].message.content;
      expect(assistantMessage).toBeTruthy();
      expect(assistantMessage.length).toBeGreaterThan(0);
    });

    test('should provide structured product data in responses', async () => {
      const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
        headers: {
          'X-API-Key': testApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'user',
              content: 'Show me detailed specifications for the latest iPad Pro models',
            },
          ],
          maxTokens: 400,
          temperature: 0.3,
        }),
      });

      const response: APIGatewayProxyResult = await handler(event);
      expect(response.statusCode).toBe(200);
      
      const responseBody = JSON.parse(response.body);
      const assistantMessage = responseBody.choices[0].message.content;
      
      // Verify structured product information
      expect(assistantMessage.toLowerCase()).toMatch(/ipad pro|specification/);
      expect(assistantMessage.toLowerCase()).toMatch(/display|processor|storage|memory/);
      expect(assistantMessage).toMatch(/inch|gb|tb|hz|resolution/i);
      
      // Should include pricing information
      expect(assistantMessage).toMatch(/\$\d+|price|cost/);
      
      // Verify technical details are structured
      expect(assistantMessage.toLowerCase()).toMatch(/model|version|generation/);
    });
  });
});