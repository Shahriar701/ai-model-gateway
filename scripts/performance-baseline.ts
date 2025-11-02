#!/usr/bin/env ts-node

import * as AWS from 'aws-sdk';
import { performance } from 'perf_hooks';

interface PerformanceMetrics {
  timestamp: string;
  environment: string;
  testSuite: string;
  metrics: {
    responseTime: {
      min: number;
      max: number;
      avg: number;
      p50: number;
      p95: number;
      p99: number;
    };
    throughput: {
      requestsPerSecond: number;
      totalRequests: number;
      duration: number;
    };
    errorRate: {
      percentage: number;
      totalErrors: number;
      errorTypes: Record<string, number>;
    };
    resourceUtilization: {
      cpuUsage?: number;
      memoryUsage?: number;
      lambdaConcurrency?: number;
    };
  };
}

interface TestScenario {
  name: string;
  description: string;
  requests: TestRequest[];
  concurrency: number;
  duration: number; // seconds
}

interface TestRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: any;
  expectedStatus?: number;
}

class PerformanceBaseline {
  private ssm: AWS.SSM;
  private cloudWatch: AWS.CloudWatch;
  private environment: string;
  private apiEndpoint: string;
  private region: string;

  constructor(environment: string, apiEndpoint: string, region: string = 'us-east-1') {
    this.environment = environment;
    this.apiEndpoint = apiEndpoint;
    this.region = region;
    this.ssm = new AWS.SSM({ region });
    this.cloudWatch = new AWS.CloudWatch({ region });
  }

  async runBaselineTests(): Promise<void> {
    console.log(`Running performance baseline tests for ${this.environment} environment`);
    console.log(`API Endpoint: ${this.apiEndpoint}`);

    const scenarios = this.getTestScenarios();
    const results: PerformanceMetrics[] = [];

    for (const scenario of scenarios) {
      console.log(`\nRunning scenario: ${scenario.name}`);
      console.log(`Description: ${scenario.description}`);
      
      const metrics = await this.runScenario(scenario);
      results.push(metrics);
      
      // Store baseline metrics
      await this.storeBaselineMetrics(metrics);
      
      // Send metrics to CloudWatch
      await this.sendMetricsToCloudWatch(metrics);
      
      // Wait between scenarios
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Generate summary report
    await this.generateSummaryReport(results);
    
    console.log('\nPerformance baseline tests completed');
  }

  private getTestScenarios(): TestScenario[] {
    return [
      {
        name: 'health-check-load',
        description: 'Basic health check endpoint load test',
        requests: [
          {
            method: 'GET',
            path: '/api/v1/health',
            expectedStatus: 200,
          },
        ],
        concurrency: 10,
        duration: 30,
      },
      {
        name: 'detailed-health-load',
        description: 'Detailed health check endpoint load test',
        requests: [
          {
            method: 'GET',
            path: '/api/v1/health/detailed',
            expectedStatus: 200,
          },
        ],
        concurrency: 5,
        duration: 30,
      },
      {
        name: 'llm-completion-load',
        description: 'LLM completion endpoint load test',
        requests: [
          {
            method: 'POST',
            path: '/api/v1/completions',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': process.env.TEST_API_KEY || 'test-key',
            },
            body: {
              model: 'gpt-4',
              messages: [
                { role: 'user', content: 'Hello, this is a performance test message.' },
              ],
              temperature: 0.7,
              maxTokens: 100,
            },
            expectedStatus: 200,
          },
        ],
        concurrency: 3,
        duration: 60,
      },
      {
        name: 'mixed-workload',
        description: 'Mixed workload simulating real usage patterns',
        requests: [
          {
            method: 'GET',
            path: '/api/v1/health',
            expectedStatus: 200,
          },
          {
            method: 'POST',
            path: '/api/v1/completions',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': process.env.TEST_API_KEY || 'test-key',
            },
            body: {
              model: 'gpt-4',
              messages: [
                { role: 'user', content: 'What are some good wireless headphones under $200?' },
              ],
              mcpContext: {
                searchQuery: 'wireless headphones',
                filters: {
                  category: 'Electronics',
                  priceRange: { min: 0, max: 200 },
                },
              },
            },
            expectedStatus: 200,
          },
          {
            method: 'GET',
            path: '/api/v1/health/metrics',
            expectedStatus: 200,
          },
        ],
        concurrency: 5,
        duration: 120,
      },
    ];
  }

  private async runScenario(scenario: TestScenario): Promise<PerformanceMetrics> {
    const startTime = performance.now();
    const responseTimes: number[] = [];
    const errors: { type: string; count: number }[] = [];
    let totalRequests = 0;
    let totalErrors = 0;

    // Create worker promises for concurrent requests
    const workers = Array.from({ length: scenario.concurrency }, () =>
      this.runWorker(scenario, responseTimes, errors, scenario.duration * 1000)
    );

    // Wait for all workers to complete
    const workerResults = await Promise.all(workers);
    
    // Aggregate results
    totalRequests = workerResults.reduce((sum, result) => sum + result.requests, 0);
    totalErrors = workerResults.reduce((sum, result) => sum + result.errors, 0);

    const endTime = performance.now();
    const actualDuration = (endTime - startTime) / 1000;

    // Calculate metrics
    const sortedResponseTimes = responseTimes.sort((a, b) => a - b);
    const errorTypes = errors.reduce((acc, error) => {
      acc[error.type] = (acc[error.type] || 0) + error.count;
      return acc;
    }, {} as Record<string, number>);

    const metrics: PerformanceMetrics = {
      timestamp: new Date().toISOString(),
      environment: this.environment,
      testSuite: scenario.name,
      metrics: {
        responseTime: {
          min: Math.min(...sortedResponseTimes) || 0,
          max: Math.max(...sortedResponseTimes) || 0,
          avg: sortedResponseTimes.reduce((sum, time) => sum + time, 0) / sortedResponseTimes.length || 0,
          p50: this.percentile(sortedResponseTimes, 50),
          p95: this.percentile(sortedResponseTimes, 95),
          p99: this.percentile(sortedResponseTimes, 99),
        },
        throughput: {
          requestsPerSecond: totalRequests / actualDuration,
          totalRequests,
          duration: actualDuration,
        },
        errorRate: {
          percentage: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
          totalErrors,
          errorTypes,
        },
        resourceUtilization: {
          // These would be populated from CloudWatch metrics in a real implementation
        },
      },
    };

    this.logScenarioResults(scenario.name, metrics);
    return metrics;
  }

  private async runWorker(
    scenario: TestScenario,
    responseTimes: number[],
    errors: { type: string; count: number }[],
    durationMs: number
  ): Promise<{ requests: number; errors: number }> {
    const startTime = performance.now();
    let requests = 0;
    let workerErrors = 0;

    while (performance.now() - startTime < durationMs) {
      // Select a random request from the scenario
      const request = scenario.requests[Math.floor(Math.random() * scenario.requests.length)];
      
      try {
        const requestStart = performance.now();
        const response = await this.makeRequest(request);
        const requestEnd = performance.now();
        
        responseTimes.push(requestEnd - requestStart);
        requests++;

        // Validate response status if expected
        if (request.expectedStatus && response.status !== request.expectedStatus) {
          errors.push({ type: `unexpected_status_${response.status}`, count: 1 });
          workerErrors++;
        }

      } catch (error) {
        const errorType = error instanceof Error ? error.name : 'unknown_error';
        errors.push({ type: errorType, count: 1 });
        workerErrors++;
      }

      // Small delay to prevent overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    return { requests, errors: workerErrors };
  }

  private async makeRequest(request: TestRequest): Promise<Response> {
    const url = `${this.apiEndpoint}${request.path}`;
    const options: RequestInit = {
      method: request.method,
      headers: request.headers || {},
    };

    if (request.body) {
      options.body = JSON.stringify(request.body);
      options.headers = {
        ...options.headers,
        'Content-Type': 'application/json',
      };
    }

    return fetch(url, options);
  }

  private percentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  private logScenarioResults(scenarioName: string, metrics: PerformanceMetrics): void {
    console.log(`\nResults for ${scenarioName}:`);
    console.log(`  Response Time (ms):`);
    console.log(`    Min: ${metrics.metrics.responseTime.min.toFixed(2)}`);
    console.log(`    Max: ${metrics.metrics.responseTime.max.toFixed(2)}`);
    console.log(`    Avg: ${metrics.metrics.responseTime.avg.toFixed(2)}`);
    console.log(`    P95: ${metrics.metrics.responseTime.p95.toFixed(2)}`);
    console.log(`    P99: ${metrics.metrics.responseTime.p99.toFixed(2)}`);
    console.log(`  Throughput:`);
    console.log(`    RPS: ${metrics.metrics.throughput.requestsPerSecond.toFixed(2)}`);
    console.log(`    Total Requests: ${metrics.metrics.throughput.totalRequests}`);
    console.log(`  Error Rate: ${metrics.metrics.errorRate.percentage.toFixed(2)}%`);
    
    if (Object.keys(metrics.metrics.errorRate.errorTypes).length > 0) {
      console.log(`  Error Types:`, metrics.metrics.errorRate.errorTypes);
    }
  }

  private async storeBaselineMetrics(metrics: PerformanceMetrics): Promise<void> {
    const parameterName = `/ai-model-gateway/${this.environment}/performance/baseline/${metrics.testSuite}`;
    
    await this.ssm.putParameter({
      Name: parameterName,
      Value: JSON.stringify(metrics),
      Type: 'String',
      Overwrite: true,
      Description: `Performance baseline for ${metrics.testSuite}`,
    }).promise();

    console.log(`Stored baseline metrics for ${metrics.testSuite}`);
  }

  private async sendMetricsToCloudWatch(metrics: PerformanceMetrics): Promise<void> {
    const namespace = 'AIModelGateway/Performance';
    const dimensions = [
      { Name: 'Environment', Value: this.environment },
      { Name: 'TestSuite', Value: metrics.testSuite },
    ];

    const metricData: AWS.CloudWatch.MetricDatum[] = [
      {
        MetricName: 'ResponseTimeAvg',
        Value: metrics.metrics.responseTime.avg,
        Unit: 'Milliseconds',
        Dimensions: dimensions,
        Timestamp: new Date(),
      },
      {
        MetricName: 'ResponseTimeP95',
        Value: metrics.metrics.responseTime.p95,
        Unit: 'Milliseconds',
        Dimensions: dimensions,
        Timestamp: new Date(),
      },
      {
        MetricName: 'ResponseTimeP99',
        Value: metrics.metrics.responseTime.p99,
        Unit: 'Milliseconds',
        Dimensions: dimensions,
        Timestamp: new Date(),
      },
      {
        MetricName: 'ThroughputRPS',
        Value: metrics.metrics.throughput.requestsPerSecond,
        Unit: 'Count/Second',
        Dimensions: dimensions,
        Timestamp: new Date(),
      },
      {
        MetricName: 'ErrorRate',
        Value: metrics.metrics.errorRate.percentage,
        Unit: 'Percent',
        Dimensions: dimensions,
        Timestamp: new Date(),
      },
    ];

    await this.cloudWatch.putMetricData({
      Namespace: namespace,
      MetricData: metricData,
    }).promise();

    console.log(`Sent performance metrics to CloudWatch for ${metrics.testSuite}`);
  }

  private async generateSummaryReport(results: PerformanceMetrics[]): Promise<void> {
    console.log('\n=== PERFORMANCE BASELINE SUMMARY ===');
    console.log(`Environment: ${this.environment}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Total Test Suites: ${results.length}`);
    
    const overallStats = {
      avgResponseTime: results.reduce((sum, r) => sum + r.metrics.responseTime.avg, 0) / results.length,
      avgThroughput: results.reduce((sum, r) => sum + r.metrics.throughput.requestsPerSecond, 0) / results.length,
      avgErrorRate: results.reduce((sum, r) => sum + r.metrics.errorRate.percentage, 0) / results.length,
      totalRequests: results.reduce((sum, r) => sum + r.metrics.throughput.totalRequests, 0),
    };

    console.log('\nOverall Statistics:');
    console.log(`  Average Response Time: ${overallStats.avgResponseTime.toFixed(2)}ms`);
    console.log(`  Average Throughput: ${overallStats.avgThroughput.toFixed(2)} RPS`);
    console.log(`  Average Error Rate: ${overallStats.avgErrorRate.toFixed(2)}%`);
    console.log(`  Total Requests Processed: ${overallStats.totalRequests}`);

    // Store summary
    const summaryParam = `/ai-model-gateway/${this.environment}/performance/baseline/summary`;
    await this.ssm.putParameter({
      Name: summaryParam,
      Value: JSON.stringify({
        timestamp: new Date().toISOString(),
        environment: this.environment,
        overallStats,
        testSuites: results.map(r => ({
          name: r.testSuite,
          avgResponseTime: r.metrics.responseTime.avg,
          throughput: r.metrics.throughput.requestsPerSecond,
          errorRate: r.metrics.errorRate.percentage,
        })),
      }),
      Type: 'String',
      Overwrite: true,
    }).promise();
  }
}

// Main execution
async function main() {
  const environment = process.argv[2] || process.env.ENVIRONMENT || 'dev';
  const apiEndpoint = process.argv[3] || process.env.API_ENDPOINT;
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!apiEndpoint) {
    console.error('API endpoint is required. Provide it as argument or set API_ENDPOINT environment variable.');
    process.exit(1);
  }

  const baseline = new PerformanceBaseline(environment, apiEndpoint, region);
  await baseline.runBaselineTests();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Performance baseline test failed:', error);
    process.exit(1);
  });
}

export { PerformanceBaseline };