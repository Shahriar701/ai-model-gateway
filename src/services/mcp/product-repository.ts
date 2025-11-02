import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '../../shared/utils/logger';
import { CacheManager } from '../../services/cache';
import {
  Product,
  ProductFilters,
  ProductSearchResult,
  Pagination,
} from '../../shared/types/product-types';

const logger = new Logger('ProductRepository');

/**
 * DynamoDB repository for product data management
 * Handles product storage, retrieval, and search operations
 */
export class ProductRepository {
  private dynamoClient: DynamoDBDocumentClient;
  private cacheManager: CacheManager;
  private tableName: string;

  constructor() {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.dynamoClient = DynamoDBDocumentClient.from(client);
    this.cacheManager = new CacheManager();
    this.tableName = process.env.PRODUCTS_TABLE_NAME || 'ai-model-gateway-products';
  }

  /**
   * Get product by ID with caching
   */
  async getProductById(productId: string): Promise<Product | null> {
    const cacheKey = `product:${productId}`;
    
    try {
      // Check cache first
      const cached = await this.cacheManager.getCachedProductData(productId);
      if (cached) {
        logger.debug('Product found in cache', { productId });
        return cached;
      }

      // Query DynamoDB
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `PRODUCT#${productId}`,
          SK: 'METADATA',
        },
      });

      const result = await this.dynamoClient.send(command);
      
      if (!result.Item) {
        logger.debug('Product not found', { productId });
        return null;
      }

      const product = this.mapDynamoItemToProduct(result.Item);
      
      // Cache the result
      await this.cacheManager.cacheProductData(productId, product, 300); // 5 minutes TTL
      
      logger.debug('Product retrieved from DynamoDB', { productId });
      return product;
    } catch (error) {
      logger.error('Failed to get product by ID', error as Error, { productId });
      throw error;
    }
  }

  /**
   * Search products with filters and pagination
   */
  async searchProducts(
    query: string,
    filters?: ProductFilters,
    pagination?: Pagination
  ): Promise<ProductSearchResult> {
    const cacheKey = `search:${JSON.stringify({ query, filters, pagination })}`;
    
    try {
      // Check cache first
      const cached = await this.cacheManager.getCache<ProductSearchResult>('search', cacheKey);
      if (cached) {
        logger.debug('Search results found in cache', { query, filters });
        return cached;
      }

      let products: Product[] = [];
      
      if (filters?.category) {
        // Use GSI for category-based search
        products = await this.searchByCategory(filters.category, query, filters, pagination);
      } else {
        // Full-text search using scan (in production, use ElasticSearch)
        products = await this.fullTextSearch(query, filters, pagination);
      }

      // Apply additional filters
      products = this.applyFilters(products, filters);

      // Apply pagination
      const total = products.length;
      const offset = pagination?.offset || 0;
      const limit = pagination?.limit || 20;
      const paginatedProducts = products.slice(offset, offset + limit);

      const result: ProductSearchResult = {
        products: paginatedProducts,
        total,
        pagination: {
          limit,
          offset,
          total,
        },
      };

      // Cache the result
      await this.cacheManager.setCache('search', cacheKey, result, 180); // 3 minutes TTL
      
      logger.info('Product search completed', {
        query,
        filters,
        totalResults: total,
        returnedResults: paginatedProducts.length,
      });

      return result;
    } catch (error) {
      logger.error('Product search failed', error as Error, { query, filters });
      throw error;
    }
  }

  /**
   * Get products by category using GSI
   */
  async getProductsByCategory(category: string): Promise<Product[]> {
    const cacheKey = `category:${category}`;
    
    try {
      // Check cache first
      const cached = await this.cacheManager.getCache<Product[]>('category', category);
      if (cached) {
        logger.debug('Category products found in cache', { category });
        return cached;
      }

      const command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :category',
        ExpressionAttributeValues: {
          ':category': `CATEGORY#${category}`,
        },
        Limit: 50, // Reasonable limit for category browsing
      });

      const result = await this.dynamoClient.send(command);
      const products = (result.Items || []).map(item => this.mapDynamoItemToProduct(item));

      // Cache the result
      await this.cacheManager.setCache('category', category, products, 600); // 10 minutes TTL
      
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
   * Get product recommendations based on patterns
   */
  async getProductRecommendations(
    basedOnProductId?: string,
    category?: string,
    limit: number = 5
  ): Promise<Product[]> {
    try {
      let products: Product[] = [];

      if (basedOnProductId) {
        // Get similar products (simplified algorithm)
        const baseProduct = await this.getProductById(basedOnProductId);
        if (baseProduct) {
          products = await this.getProductsByCategory(baseProduct.category.name);
          // Filter out the base product and limit results
          products = products
            .filter(p => p.id !== basedOnProductId)
            .slice(0, limit);
        }
      } else if (category) {
        // Get popular products in category
        products = await this.getProductsByCategory(category);
        // Sort by rating and sales (simplified)
        products = products
          .sort((a, b) => {
            const scoreA = (a.rating?.average || 0) * (a.metadata.sales || 0);
            const scoreB = (b.rating?.average || 0) * (b.metadata.sales || 0);
            return scoreB - scoreA;
          })
          .slice(0, limit);
      }

      logger.info('Product recommendations generated', {
        basedOnProductId,
        category,
        count: products.length,
      });

      return products;
    } catch (error) {
      logger.error('Failed to get product recommendations', error as Error, {
        basedOnProductId,
        category,
      });
      throw error;
    }
  }

  /**
   * Update product inventory and availability
   */
  async updateProductAvailability(
    productId: string,
    availability: { inStock: boolean; quantity?: number }
  ): Promise<void> {
    try {
      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: `PRODUCT#${productId}`,
          SK: 'METADATA',
        },
        UpdateExpression: 'SET availability.inStock = :inStock, availability.quantity = :quantity, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':inStock': availability.inStock,
          ':quantity': availability.quantity || 0,
          ':updatedAt': new Date().toISOString(),
        },
      });

      await this.dynamoClient.send(command);

      // Invalidate cache
      await this.cacheManager.deleteCache('product', productId);

      logger.info('Product availability updated', {
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
   * Search by category using GSI
   */
  private async searchByCategory(
    category: string,
    query: string,
    filters?: ProductFilters,
    pagination?: Pagination
  ): Promise<Product[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :category',
      FilterExpression: query ? 'contains(#name, :query) OR contains(description, :query)' : undefined,
      ExpressionAttributeNames: query ? { '#name': 'name' } : undefined,
      ExpressionAttributeValues: {
        ':category': `CATEGORY#${category}`,
        ...(query && { ':query': query }),
      },
      Limit: 100, // Get more items for filtering
    });

    const result = await this.dynamoClient.send(command);
    return (result.Items || []).map(item => this.mapDynamoItemToProduct(item));
  }

  /**
   * Full-text search using scan (fallback method)
   */
  private async fullTextSearch(
    query: string,
    filters?: ProductFilters,
    pagination?: Pagination
  ): Promise<Product[]> {
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'SK = :sk AND (contains(#name, :query) OR contains(description, :query))',
      ExpressionAttributeNames: {
        '#name': 'name',
      },
      ExpressionAttributeValues: {
        ':sk': 'METADATA',
        ':query': query,
      },
      Limit: 100,
    });

    const result = await this.dynamoClient.send(command);
    return (result.Items || []).map(item => this.mapDynamoItemToProduct(item));
  }

  /**
   * Apply filters to product list
   */
  private applyFilters(products: Product[], filters?: ProductFilters): Product[] {
    if (!filters) return products;

    return products.filter(product => {
      // Price range filter
      if (filters.priceRange) {
        const price = product.price.amount;
        if (filters.priceRange.min && price < filters.priceRange.min) return false;
        if (filters.priceRange.max && price > filters.priceRange.max) return false;
      }

      // Availability filter
      if (filters.availability !== undefined && product.availability.inStock !== filters.availability) {
        return false;
      }

      // Brand filter
      if (filters.brand && filters.brand.length > 0) {
        const productBrand = product.specifications.brand?.toLowerCase();
        if (!productBrand || !filters.brand.some(b => b.toLowerCase() === productBrand)) {
          return false;
        }
      }

      // Rating filter
      if (filters.rating && (!product.rating || product.rating.average < filters.rating)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Map DynamoDB item to Product interface
   */
  private mapDynamoItemToProduct(item: any): Product {
    return {
      id: item.productId || item.id,
      name: item.name,
      description: item.description,
      price: {
        amount: item.price?.amount || item.price || 0,
        currency: item.price?.currency || 'EUR',
        originalPrice: item.price?.originalPrice,
        discount: item.price?.discount,
      },
      availability: {
        inStock: item.availability?.inStock ?? true,
        quantity: item.availability?.quantity,
        shippingTime: item.availability?.shippingTime,
      },
      category: {
        id: item.category?.id || 'unknown',
        name: item.category?.name || 'Unknown',
        path: item.category?.path || [],
      },
      specifications: {
        brand: item.specifications?.brand || item.brand,
        color: item.specifications?.color || item.color,
        features: item.specifications?.features || [],
        ...item.specifications,
      },
      images: item.images || [],
      rating: item.rating ? {
        average: item.rating.average,
        count: item.rating.count,
      } : undefined,
      metadata: {
        createdAt: item.createdAt || item.metadata?.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.metadata?.updatedAt || new Date().toISOString(),
        views: item.metadata?.views || 0,
        sales: item.metadata?.sales || 0,
        tags: item.metadata?.tags || [],
      },
    };
  }

  /**
   * Seed database with sample products (for development/testing)
   */
  async seedSampleProducts(): Promise<void> {
    const sampleProducts = [
      {
        PK: 'PRODUCT#prod_001',
        SK: 'METADATA',
        GSI1PK: 'CATEGORY#Electronics',
        GSI1SK: 'PRICE#199.99',
        productId: 'prod_001',
        name: 'Wireless Bluetooth Headphones',
        description: 'High-quality wireless headphones with noise cancellation',
        price: {
          amount: 199.99,
          currency: 'EUR',
          originalPrice: 249.99,
          discount: { percentage: 20, amount: 50 },
        },
        availability: {
          inStock: true,
          quantity: 150,
          shippingTime: '1-2 days',
        },
        category: {
          id: 'cat_electronics',
          name: 'Electronics',
          path: ['Electronics', 'Audio', 'Headphones'],
        },
        specifications: {
          brand: 'TechBrand',
          color: 'Black',
          features: ['Noise Cancellation', 'Wireless', 'Bluetooth 5.0'],
        },
        images: [
          {
            url: 'https://example.com/images/headphones-1.jpg',
            alt: 'Headphones front view',
            type: 'main',
            order: 1,
          },
        ],
        rating: {
          average: 4.5,
          count: 1250,
        },
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          views: 5000,
          sales: 850,
          tags: ['wireless', 'noise-cancelling', 'premium'],
        },
      },
      {
        PK: 'PRODUCT#prod_002',
        SK: 'METADATA',
        GSI1PK: 'CATEGORY#Wearables',
        GSI1SK: 'PRICE#299.99',
        productId: 'prod_002',
        name: 'Smart Fitness Watch',
        description: 'Advanced fitness tracking with heart rate monitoring',
        price: {
          amount: 299.99,
          currency: 'EUR',
        },
        availability: {
          inStock: true,
          quantity: 75,
          shippingTime: '2-3 days',
        },
        category: {
          id: 'cat_wearables',
          name: 'Wearables',
          path: ['Electronics', 'Wearables', 'Smartwatches'],
        },
        specifications: {
          brand: 'FitTech',
          color: 'Silver',
          features: ['Heart Rate Monitor', 'GPS', 'Water Resistant'],
        },
        images: [
          {
            url: 'https://example.com/images/watch-1.jpg',
            alt: 'Smartwatch',
            type: 'main',
            order: 1,
          },
        ],
        rating: {
          average: 4.3,
          count: 890,
        },
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          views: 3200,
          sales: 420,
          tags: ['fitness', 'smartwatch', 'health'],
        },
      },
    ];

    try {
      for (const product of sampleProducts) {
        const command = new PutCommand({
          TableName: this.tableName,
          Item: product,
          ConditionExpression: 'attribute_not_exists(PK)', // Only insert if not exists
        });

        try {
          await this.dynamoClient.send(command);
          logger.info('Sample product seeded', { productId: product.productId });
        } catch (error: any) {
          if (error.name === 'ConditionalCheckFailedException') {
            logger.debug('Product already exists, skipping', { productId: product.productId });
          } else {
            throw error;
          }
        }
      }

      logger.info('Sample products seeding completed');
    } catch (error) {
      logger.error('Failed to seed sample products', error as Error);
      throw error;
    }
  }
}