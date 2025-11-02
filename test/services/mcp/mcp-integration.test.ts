import { MCPContextService } from '../../../src/services/mcp/mcp-context-service';
import { ProductService } from '../../../src/services/mcp/product-service';
import { LLMRequest } from '../../../src/shared/types/llm-types';

describe('MCP Integration', () => {
  let mcpContextService: MCPContextService;
  let productService: ProductService;

  beforeEach(() => {
    mcpContextService = new MCPContextService();
    productService = new ProductService();
  });

  describe('MCPContextService', () => {
    it('should detect product-related queries', async () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: 'I am looking for wireless headphones under 200 euros'
          }
        ]
      };

      const shouldExecute = await mcpContextService.shouldExecuteMCPTools(request);
      expect(shouldExecute).toBe(true);
    });

    it('should not detect non-product queries', async () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: 'What is the weather like today?'
          }
        ]
      };

      const shouldExecute = await mcpContextService.shouldExecuteMCPTools(request);
      expect(shouldExecute).toBe(false);
    });

    it('should extract tool calls from user messages', () => {
      const message = 'I want to search for wireless headphones in Electronics category under 300 euros';
      const toolCalls = mcpContextService.extractMCPToolCalls(message);



      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolName).toBe('product_search');
      expect(toolCalls[0].arguments.query).toBe('wireless headphones');
      expect(toolCalls[0].arguments.category).toBe('Electronics');
      expect(toolCalls[0].arguments.priceRange.max).toBe(300);
    });

    it('should extract product ID requests', () => {
      const message = 'Tell me about product prod_001';
      const toolCalls = mcpContextService.extractMCPToolCalls(message);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolName).toBe('get_product');
      expect(toolCalls[0].arguments.productId).toBe('prod_001');
    });
  });

  describe('ProductService', () => {
    it('should format products for LLM consumption', () => {
      const mockProducts = [
        {
          id: 'test_001',
          name: 'Test Headphones',
          description: 'Great headphones for testing',
          price: {
            amount: 199.99,
            currency: 'EUR'
          },
          availability: {
            inStock: true,
            quantity: 10
          },
          category: {
            id: 'electronics',
            name: 'Electronics',
            path: ['Electronics']
          },
          specifications: {
            brand: 'TestBrand',
            features: ['Wireless', 'Noise Cancelling']
          },
          images: [],
          rating: {
            average: 4.5,
            count: 100
          },
          metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            views: 1000,
            sales: 50,
            tags: ['test']
          }
        }
      ];

      const formatted = productService.formatProductsForLLM(mockProducts);
      
      expect(formatted).toContain('Test Headphones');
      expect(formatted).toContain('199.99 EUR');
      expect(formatted).toContain('Electronics');
      expect(formatted).toContain('In Stock');
      expect(formatted).toContain('TestBrand');
      expect(formatted).toContain('Wireless, Noise Cancelling');
    });

    it('should handle empty product lists', () => {
      const formatted = productService.formatProductsForLLM([]);
      expect(formatted).toBe('No products found matching the criteria.');
    });
  });
});