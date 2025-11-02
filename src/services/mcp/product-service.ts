import { Logger } from '../../shared/utils/logger';
import { ProductRepository } from './product-repository';
import {
  Product,
  ProductSearchQuery,
  ProductSearchResult,
  ProductFilters,
} from '../../shared/types/product-types';

const logger = new Logger('ProductService');

/**
 * Product service for e-commerce data integration
 * Handles product search, filtering, and data retrieval
 */
export class ProductService {
  private repository: ProductRepository;
  private initialized = false;

  constructor() {
    this.repository = new ProductRepository();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Seed sample data for development/testing
      if (process.env.NODE_ENV === 'development' || process.env.SEED_SAMPLE_DATA === 'true') {
        await this.repository.seedSampleProducts();
      }
      
      this.initialized = true;
      logger.info('ProductService initialized');
    } catch (error) {
      logger.error('Failed to initialize ProductService', error as Error);
      throw error;
    }
  }
  async searchProducts(query: string, filters?: ProductFilters): Promise<Product[]> {
    await this.initialize();
    
    logger.info('Searching products', { query, filters });

    try {
      const searchResult = await this.repository.searchProducts(query, filters);
      
      logger.info('Product search completed', {
        query,
        totalResults: searchResult.total,
        returnedResults: searchResult.products.length,
        filters,
      });

      return searchResult.products;
    } catch (error) {
      logger.error('Product search failed', error as Error, { query, filters });
      throw error;
    }
  }

  async getProductById(productId: string): Promise<Product | null> {
    await this.initialize();
    
    logger.info('Getting product by ID', { productId });

    try {
      const product = await this.repository.getProductById(productId);

      if (product) {
        logger.info('Product found', { productId, productName: product.name });
      } else {
        logger.warn('Product not found', { productId });
      }

      return product;
    } catch (error) {
      logger.error('Failed to get product by ID', error as Error, { productId });
      throw error;
    }
  }

  async getProductsByCategory(category: string): Promise<Product[]> {
    await this.initialize();
    
    logger.info('Getting products by category', { category });

    try {
      const products = await this.repository.getProductsByCategory(category);
      
      logger.info('Category products retrieved', {
        category,
        count: products.length,
      });

      return products;
    } catch (error) {
      logger.error('Failed to get products by category', error as Error, { category });
      throw error;
    }
  }

  /**
   * Get product recommendations
   */
  async getProductRecommendations(
    basedOnProductId?: string,
    category?: string,
    limit: number = 5
  ): Promise<Product[]> {
    await this.initialize();
    
    logger.info('Getting product recommendations', {
      basedOnProductId,
      category,
      limit,
    });

    try {
      const recommendations = await this.repository.getProductRecommendations(
        basedOnProductId,
        category,
        limit
      );

      logger.info('Product recommendations retrieved', {
        basedOnProductId,
        category,
        count: recommendations.length,
      });

      return recommendations;
    } catch (error) {
      logger.error('Failed to get product recommendations', error as Error, {
        basedOnProductId,
        category,
      });
      throw error;
    }
  }

  /**
   * Update product availability in real-time
   */
  async updateProductAvailability(
    productId: string,
    availability: { inStock: boolean; quantity?: number }
  ): Promise<void> {
    await this.initialize();
    
    logger.info('Updating product availability', { productId, availability });

    try {
      await this.repository.updateProductAvailability(productId, availability);
      
      logger.info('Product availability updated successfully', {
        productId,
        availability,
      });
    } catch (error) {
      logger.error('Failed to update product availability', error as Error, {
        productId,
        availability,
      });
      throw error;
    }
  }

  /**
   * Advanced search with full-text capabilities
   */
  async advancedSearch(searchQuery: ProductSearchQuery): Promise<ProductSearchResult> {
    await this.initialize();
    
    logger.info('Performing advanced product search', { searchQuery });

    try {
      const result = await this.repository.searchProducts(
        searchQuery.query,
        searchQuery.filters,
        searchQuery.pagination
      );

      logger.info('Advanced search completed', {
        query: searchQuery.query,
        totalResults: result.total,
        returnedResults: result.products.length,
      });

      return result;
    } catch (error) {
      logger.error('Advanced search failed', error as Error, { searchQuery });
      throw error;
    }
  }

  formatProductsForLLM(products: Product[]): string {
    if (products.length === 0) {
      return 'No products found matching the criteria.';
    }

    const formattedProducts = products
      .map(product => {
        const discount = product.price.discount
          ? `(${product.price.discount.percentage}% off)`
          : '';
        return `Product: ${product.name}
Price: ${product.price.amount} ${product.price.currency} ${discount}
Category: ${product.category.name}
Description: ${product.description}
Availability: ${product.availability.inStock ? 'In Stock' : 'Out of Stock'}${product.availability.quantity ? ` (${product.availability.quantity} units)` : ''}
Rating: ${product.rating?.average || 'N/A'}/5 (${product.rating?.count || 0} reviews)
Brand: ${product.specifications.brand || 'N/A'}
Key Features: ${product.specifications.features?.join(', ') || 'N/A'}`;
      })
      .join('\n\n---\n\n');

    return `Found ${products.length} product(s):\n\n${formattedProducts}`;
  }
}

// Re-export Product type for backward compatibility
export type { Product as ProductResult } from '../../shared/types/product-types';
