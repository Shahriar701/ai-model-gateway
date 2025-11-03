import { MCPContextService } from '../../../src/services/mcp/mcp-context-service';
import { ProductService } from '../../../src/services/mcp/product-service';
import { LLMRequest } from '../../../src/shared/types';

// Mock dependencies
jest.mock('../../../src/services/mcp/product-service');

describe('MCP End-to-End Integration Tests', () => {
  let mcpContextService: MCPContextService;
  let mockProductService: jest.Mocked<ProductService>;

  beforeEach(() => {
    mcpContextService = new MCPContextService();
    
    // Mock ProductService
    mockProductService = {
      searchProducts: jest.fn(),
      getProductById: jest.fn(),
      getProductsByCategory: jest.fn(),
      getProductRecommendations: jest.fn(),
    } as any;

    (mcpContextService as any).productService = mockProductService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Product Search Integration', () => {
    it('should inject product context into LLM request', async () => {
      // Mock product search results
      const mockProducts = [
        {
          id: 'prod-1',
          name: 'Wireless Headphones',
          description: 'High-quality wireless headphones with noise cancellation',
          price: 199.99,
          category: 'Electronics',
          availability: true,
          rating: 4.5,
          reviews: 1250,
        },
        {
          id: 'prod-2',
          name: 'Bluetooth Speaker',
          description: 'Portable Bluetooth speaker with excellent sound quality',
          price: 89.99,
          category: 'Electronics',
          availability: true,
          rating: 4.3,
          reviews: 890,
        },
      ];

      mockProductService.searchProducts.mockResolvedValue({
        products: mockProducts,
        total: 2,
        page: 1,
        limit: 10,
      });

      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: 'I need recommendations for wireless audio devices under $200',
          },
        ],
        mcpContext: {
          searchQuery: 'wireless audio',
          filters: {
            category: 'Electronics',
            priceRange: { min: 0, max: 200 },
          },
        },
      };

      const enhancedRequest = await mcpContextService.injectMCPContext(request);

      // Verify product service was called
      expect(mockProductService.searchProducts).toHaveBeenCalledWith(
        'wireless audio',
        expect.objectContaining({
          category: 'Electronics',
          priceRange: { min: 0, max: 200 },
        }),
        10
      );

      // Verify context was injected
      expect(enhancedRequest.messages).toHaveLength(2);
      expect(enhancedRequest.messages[0].role).toBe('system');
      expect(enhancedRequest.messages[0].content).toContain('product information');
      expect(enhancedRequest.messages[0].content).toContain('Wireless Headphones');
      expect(enhancedRequest.messages[0].content).toContain('Bluetooth Speaker');

      // Verify metadata was added
      expect(enhancedRequest.metadata).toHaveProperty('mcpContextInjected', true);
      expect(enhancedRequest.metadata).toHaveProperty('mcpToolCalls');
    });

    it('should handle empty search results gracefully', async () => {
      mockProductService.searchProducts.mockResolvedValue({
        products: [],
        total: 0,
        page: 1,
        limit: 10,
      });

      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: 'Find me some rare vintage items',
          },
        ],
        mcpContext: {
          searchQuery: 'rare vintage',
        },
      };

      const enhancedRequest = await mcpContextService.injectMCPContext(request);

      // Should still inject context but indicate no products found
      expect(enhancedRequest.messages).toHaveLength(2);
      expect(enhancedRequest.messages[0].content).toContain('no products found');
    });
  });
});  de
scribe('Product Recommendation Flow', () => {
    it('should provide contextual product recommendations', async () => {
      const mockRecommendations = [
        {
          id: 'rec-1',
          name: 'Premium Wireless Earbuds',
          description: 'Top-rated wireless earbuds with active noise cancellation',
          price: 249.99,
          category: 'Electronics',
          availability: true,
          rating: 4.8,
          reviews: 2100,
          reason: 'Highly rated in the same category',
        },
        {
          id: 'rec-2',
          name: 'Wireless Charging Pad',
          description: 'Fast wireless charging pad compatible with all devices',
          price: 39.99,
          category: 'Electronics',
          availability: true,
          rating: 4.4,
          reviews: 650,
          reason: 'Frequently bought together',
        },
      ];

      mockProductService.getProductRecommendations.mockResolvedValue(mockRecommendations);

      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: 'I just bought wireless headphones, what else might I need?',
          },
        ],
        mcpContext: {
          productIds: ['prod-1'], // Previously viewed/purchased product
        },
      };

      const enhancedRequest = await mcpContextService.injectMCPContext(request);

      expect(mockProductService.getProductRecommendations).toHaveBeenCalledWith(['prod-1']);
      expect(enhancedRequest.messages[0].content).toContain('Premium Wireless Earbuds');
      expect(enhancedRequest.messages[0].content).toContain('Wireless Charging Pad');
      expect(enhancedRequest.messages[0].content).toContain('Highly rated in the same category');
    });
  });

  describe('Category Browsing Integration', () => {
    it('should inject category-specific product information', async () => {
      const mockCategoryProducts = [
        {
          id: 'cat-1',
          name: 'Gaming Laptop',
          description: 'High-performance gaming laptop with RTX graphics',
          price: 1299.99,
          category: 'Computers',
          availability: true,
          rating: 4.6,
          reviews: 450,
        },
        {
          id: 'cat-2',
          name: 'Mechanical Keyboard',
          description: 'RGB mechanical keyboard with blue switches',
          price: 129.99,
          category: 'Computers',
          availability: false,
          rating: 4.7,
          reviews: 890,
        },
      ];

      mockProductService.getProductsByCategory.mockResolvedValue({
        products: mockCategoryProducts,
        total: 2,
        page: 1,
        limit: 10,
      });

      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: 'What computer equipment do you have available?',
          },
        ],
        mcpContext: {
          filters: {
            category: 'Computers',
          },
        },
      };

      const enhancedRequest = await mcpContextService.injectMCPContext(request);

      expect(mockProductService.getProductsByCategory).toHaveBeenCalledWith('Computers', {}, 10);
      expect(enhancedRequest.messages[0].content).toContain('Gaming Laptop');
      expect(enhancedRequest.messages[0].content).toContain('Mechanical Keyboard');
      expect(enhancedRequest.messages[0].content).toContain('availability: false');
    });
  });

  describe('Error Handling', () => {
    it('should handle product service errors gracefully', async () => {
      mockProductService.searchProducts.mockRejectedValue(new Error('Database connection failed'));

      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: 'Find me some products',
          },
        ],
        mcpContext: {
          searchQuery: 'products',
        },
      };

      const enhancedRequest = await mcpContextService.injectMCPContext(request);

      // Should not throw error, but should not inject context either
      expect(enhancedRequest.messages).toHaveLength(1);
      expect(enhancedRequest.metadata?.mcpContextInjected).toBeFalsy();
    });

    it('should handle malformed MCP context', async () => {
      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: 'Find me some products',
          },
        ],
        mcpContext: {
          // Invalid context structure
          invalidField: 'invalid',
        } as any,
      };

      const enhancedRequest = await mcpContextService.injectMCPContext(request);

      // Should handle gracefully without throwing
      expect(enhancedRequest.messages).toHaveLength(1);
    });
  });

  describe('Context Formatting', () => {
    it('should format product information for optimal LLM understanding', async () => {
      const mockProducts = [
        {
          id: 'format-test-1',
          name: 'Test Product',
          description: 'A test product with special characters & symbols',
          price: 99.99,
          category: 'Test Category',
          availability: true,
          rating: 4.2,
          reviews: 100,
          specifications: {
            color: 'Blue',
            size: 'Medium',
            weight: '1.5 lbs',
          },
        },
      ];

      mockProductService.searchProducts.mockResolvedValue({
        products: mockProducts,
        total: 1,
        page: 1,
        limit: 10,
      });

      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: 'Tell me about test products',
          },
        ],
        mcpContext: {
          searchQuery: 'test',
        },
      };

      const enhancedRequest = await mcpContextService.injectMCPContext(request);

      const systemMessage = enhancedRequest.messages[0].content;

      // Verify structured formatting
      expect(systemMessage).toContain('Product ID: format-test-1');
      expect(systemMessage).toContain('Name: Test Product');
      expect(systemMessage).toContain('Price: $99.99');
      expect(systemMessage).toContain('Rating: 4.2/5 (100 reviews)');
      expect(systemMessage).toContain('Available: Yes');
      
      // Verify specifications are included
      expect(systemMessage).toContain('Color: Blue');
      expect(systemMessage).toContain('Size: Medium');
      expect(systemMessage).toContain('Weight: 1.5 lbs');
    });

    it('should limit context size to prevent token overflow', async () => {
      // Create a large number of products
      const mockProducts = Array.from({ length: 100 }, (_, i) => ({
        id: `prod-${i}`,
        name: `Product ${i}`,
        description: `This is a very long description for product ${i} that contains many words and details about the product features and specifications`,
        price: 99.99 + i,
        category: 'Test',
        availability: true,
        rating: 4.0 + (i % 10) / 10,
        reviews: 100 + i,
      }));

      mockProductService.searchProducts.mockResolvedValue({
        products: mockProducts,
        total: 100,
        page: 1,
        limit: 100,
      });

      const request: LLMRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: 'Show me all products',
          },
        ],
        mcpContext: {
          searchQuery: 'all',
        },
      };

      const enhancedRequest = await mcpContextService.injectMCPContext(request);

      const systemMessage = enhancedRequest.messages[0].content;
      
      // Should limit the number of products to prevent excessive token usage
      // Exact limit depends on implementation, but should be reasonable
      expect(systemMessage.length).toBeLessThan(10000); // Reasonable limit
      expect(systemMessage).toContain('Product 0');
      // May not contain all 100 products due to truncation
    });