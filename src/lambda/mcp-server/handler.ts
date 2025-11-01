import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger, ErrorHandler } from '../../shared/utils';
import { MCPServer, ProductService } from '../../services/mcp';
import { ValidationHelper } from '../../shared/validation';

const logger = new Logger('MCPServerHandler');
const mcpServer = new MCPServer();
const productService = new ProductService();

/**
 * MCP Server Lambda handler for product data integration
 * Implements Model Context Protocol for e-commerce data access
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const correlationId = event.requestContext.requestId;
  logger.setCorrelationId(correlationId);

  try {
    logger.info('Processing MCP server request', {
      method: event.httpMethod,
      path: event.path,
    });

    // Route based on path
    const response = await routeRequest(event, correlationId);
    return response;
  } catch (error) {
    return ErrorHandler.handleLambdaError(error, correlationId);
  }
};

async function routeRequest(
  event: APIGatewayProxyEvent,
  correlationId: string
): Promise<APIGatewayProxyResult> {
  const { path, httpMethod } = event;

  // MCP protocol endpoints
  if (path === '/api/v1/mcp/tools' && httpMethod === 'POST') {
    return handleMCPRequest(event, correlationId);
  }

  // Product endpoints
  if (path === '/api/v1/products' && httpMethod === 'GET') {
    return handleProductList(event, correlationId);
  }

  if (path === '/api/v1/products/search' && httpMethod === 'POST') {
    return handleProductSearch(event, correlationId);
  }

  // Default response
  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-ID': correlationId,
    },
    body: JSON.stringify({
      error: 'Route not found',
      path,
      method: httpMethod,
    }),
  };
}

async function handleMCPRequest(
  event: APIGatewayProxyEvent,
  correlationId: string
): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      throw new Error('Request body is required');
    }

    const mcpRequest = JSON.parse(event.body);
    const response = await mcpServer.handleRequest(mcpRequest);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error('MCP request failed', error as Error);
    throw error;
  }
}

async function handleProductList(
  event: APIGatewayProxyEvent,
  correlationId: string
): Promise<APIGatewayProxyResult> {
  try {
    const category = event.queryStringParameters?.category;
    const limit = parseInt(event.queryStringParameters?.limit || '10');
    const offset = parseInt(event.queryStringParameters?.offset || '0');

    let products;
    if (category) {
      products = await productService.getProductsByCategory(category);
    } else {
      products = await productService.searchProducts('', undefined);
    }

    // Apply pagination
    const paginatedProducts = products.slice(offset, offset + limit);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        products: paginatedProducts,
        total: products.length,
        limit,
        offset,
        hasMore: offset + limit < products.length,
      }),
    };
  } catch (error) {
    logger.error('Product list failed', error as Error);
    throw error;
  }
}

async function handleProductSearch(
  event: APIGatewayProxyEvent,
  correlationId: string
): Promise<APIGatewayProxyResult> {
  try {
    if (!event.body) {
      throw new Error('Request body is required');
    }

    const searchRequest = JSON.parse(event.body);
    const validatedRequest = ValidationHelper.validateProductSearchRequest(searchRequest);

    const products = await productService.searchProducts(validatedRequest.query, {
      category: validatedRequest.category,
      priceRange: validatedRequest.priceRange,
      availability: validatedRequest.availability,
    });

    // Apply pagination
    const paginatedProducts = products.slice(
      validatedRequest.offset,
      validatedRequest.offset + validatedRequest.limit
    );

    // Format for LLM if requested
    const formatted =
      event.queryStringParameters?.format === 'llm'
        ? productService.formatProductsForLLM(paginatedProducts)
        : undefined;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify({
        products: paginatedProducts,
        total: products.length,
        limit: validatedRequest.limit,
        offset: validatedRequest.offset,
        hasMore: validatedRequest.offset + validatedRequest.limit < products.length,
        formatted,
      }),
    };
  } catch (error) {
    logger.error('Product search failed', error as Error);
    throw error;
  }
}
