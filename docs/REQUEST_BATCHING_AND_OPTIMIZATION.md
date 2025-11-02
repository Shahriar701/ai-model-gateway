# Request Batching and Optimization

This document describes the request batching and optimization features implemented in the AI Model Gateway.

## Overview

The AI Model Gateway implements intelligent request batching and optimization to reduce costs and improve performance when processing LLM requests. This system includes:

1. **Request Batching**: Groups similar requests together to optimize processing
2. **Request Deduplication**: Caches identical requests to avoid redundant processing
3. **Intelligent Caching**: Uses usage analytics to optimize cache TTL
4. **Cost Optimization**: Routes requests based on cost analysis and usage patterns

## Architecture

### Components

#### RequestBatcher
- **Location**: `src/services/cache/request-batcher.ts`
- **Purpose**: Groups similar requests and implements deduplication
- **Key Features**:
  - Batches identical requests for single execution
  - Implements request deduplication using cache
  - Provides usage analytics for intelligent caching
  - Configurable batch size and timeout

#### BatchedGatewayService
- **Location**: `src/services/cache/batched-gateway-service.ts`
- **Purpose**: Enhanced gateway service with batching and optimization
- **Key Features**:
  - Integrates request batcher with provider router
  - Implements intelligent routing criteria
  - Provides cost analysis and optimization
  - Tracks request metrics for optimization

#### Enhanced Gateway Handler
- **Location**: `src/lambda/gateway/handler.ts`
- **Purpose**: Main Lambda handler with batching integration
- **Key Features**:
  - Uses BatchedGatewayService for request processing
  - Determines routing criteria based on request characteristics
  - Provides optimization statistics endpoint

## Configuration

### Environment Variables

```bash
# Batching Configuration
BATCH_SIZE=5                           # Maximum requests per batch
BATCH_TIMEOUT_MS=100                   # Batch timeout in milliseconds
ENABLE_DEDUPLICATION=true              # Enable request deduplication

# Optimization Configuration
ENABLE_INTELLIGENT_ROUTING=true        # Enable intelligent routing
COST_OPTIMIZATION_THRESHOLD=0.001      # Cost threshold for optimization
MAX_REQUEST_COST=1.0                   # Maximum cost per request
MAX_REQUEST_LATENCY_MS=30000          # Maximum latency per request
```

### Batch Configuration

```typescript
interface BatchConfig {
  maxBatchSize: number;        // Maximum requests per batch (default: 5)
  batchTimeoutMs: number;      // Batch timeout in ms (default: 100)
  similarityThreshold: number; // Similarity threshold (default: 0.8)
  enableDeduplication: boolean; // Enable deduplication (default: true)
}
```

## How It Works

### Request Batching Flow

1. **Request Arrival**: LLM request arrives at the gateway
2. **Cache Check**: Check for cached response (deduplication)
3. **Batch Grouping**: Group request with similar requests
4. **Batch Execution**: Execute batch when full or timeout reached
5. **Response Caching**: Cache response for future deduplication

### Intelligent Routing

The system analyzes request patterns and applies intelligent routing:

```typescript
// Short, interactive requests -> Latency optimization
if (messageLength < 500 && maxTokens < 500) {
  strategy = RoutingStrategy.LATENCY_OPTIMIZED;
}

// Enterprise users -> Priority-based routing
if (userId.includes('enterprise')) {
  strategy = RoutingStrategy.PRIORITY_BASED;
}

// Default -> Cost optimization
strategy = RoutingStrategy.COST_OPTIMIZED;
```

### Cost Optimization

The system tracks provider costs and preferences:

1. **Provider Analysis**: Analyze historical cost data
2. **Cost Ranking**: Rank providers by cost efficiency
3. **Preference Setting**: Prefer top 2 most cost-effective providers
4. **Dynamic Adjustment**: Adjust based on usage patterns

## Usage Examples

### Basic Usage

```typescript
import { BatchedGatewayService } from './services/cache';
import { ProviderRouter } from './services/router';

// Initialize with configuration
const gatewayService = new BatchedGatewayService(providerRouter, {
  batchConfig: {
    maxBatchSize: 5,
    batchTimeoutMs: 100,
    enableDeduplication: true,
  },
  enableIntelligentRouting: true,
  costOptimizationThreshold: 0.001,
});

// Process request with batching
const response = await gatewayService.processRequest(llmRequest);
```

### Getting Optimization Statistics

```bash
# Get optimization statistics
curl -H "X-API-Key: your-api-key" \
     https://your-gateway.com/api/v1/optimization/stats
```

Response:
```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "optimization": {
    "batching": {
      "pendingBatches": 2,
      "totalPatterns": 150,
      "config": {
        "maxBatchSize": 5,
        "batchTimeoutMs": 100
      }
    },
    "caching": {
      "overallHitRate": 45.2,
      "totalRequests": 1000,
      "totalCacheHits": 452,
      "uniquePatterns": 150
    },
    "optimization": {
      "intelligentRoutingEnabled": true,
      "costThreshold": 0.001,
      "metricsTracked": 150
    }
  }
}
```

## Performance Benefits

### Request Deduplication
- **Cache Hit Rate**: Typically 30-50% for similar workloads
- **Cost Savings**: Direct cost reduction for cached requests
- **Latency Improvement**: Cached responses return in <10ms

### Request Batching
- **Identical Requests**: Single execution for multiple identical requests
- **Resource Efficiency**: Reduced provider API calls
- **Cost Optimization**: Bulk processing reduces per-request overhead

### Intelligent Routing
- **Cost Optimization**: 10-20% cost reduction through provider selection
- **Latency Optimization**: Route to fastest providers for interactive requests
- **Load Balancing**: Distribute load across providers efficiently

## Monitoring and Observability

### Metrics Tracked

1. **Batching Metrics**:
   - Pending batches count
   - Batch execution time
   - Batch size distribution

2. **Caching Metrics**:
   - Cache hit rate
   - Cache miss rate
   - TTL effectiveness

3. **Optimization Metrics**:
   - Cost savings
   - Latency improvements
   - Provider selection efficiency

### Logging

The system provides structured logging for:
- Batch execution events
- Cache hit/miss events
- Optimization decisions
- Cost analysis results

### Headers

Response headers provide optimization information:
```
X-Request-Cached: true/false
X-Provider-Used: openai/bedrock/etc
X-Cost-Optimized: true
```

## Best Practices

### Configuration Tuning

1. **Batch Size**: Start with 5, adjust based on traffic patterns
2. **Batch Timeout**: 100ms for interactive, 500ms for batch workloads
3. **Cache TTL**: 5-30 minutes based on data freshness requirements

### Cost Optimization

1. **Monitor Metrics**: Track cost savings and optimization effectiveness
2. **Provider Analysis**: Regularly review provider cost efficiency
3. **Usage Patterns**: Analyze request patterns for optimization opportunities

### Performance Tuning

1. **Cache Strategy**: Optimize cache TTL based on request patterns
2. **Batch Configuration**: Tune batch size and timeout for workload
3. **Provider Selection**: Monitor and adjust provider preferences

## Troubleshooting

### Common Issues

1. **Low Cache Hit Rate**:
   - Check request similarity
   - Adjust cache TTL
   - Review deduplication logic

2. **High Latency**:
   - Reduce batch timeout
   - Check provider performance
   - Review routing strategy

3. **Cost Not Optimized**:
   - Verify provider cost configuration
   - Check routing criteria
   - Review usage analytics

### Debug Information

Enable debug logging to see:
- Batch formation decisions
- Cache hit/miss reasons
- Routing criteria application
- Cost analysis results

## Future Enhancements

1. **Machine Learning**: ML-based request similarity detection
2. **Predictive Caching**: Pre-cache likely requests
3. **Advanced Batching**: Semantic similarity-based batching
4. **Real-time Optimization**: Dynamic parameter adjustment