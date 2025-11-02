#!/usr/bin/env ts-node

import * as AWS from 'aws-sdk';
import { PerformanceBaseline } from './performance-baseline';

interface RegressionThresholds {
  responseTime: {
    avgIncrease: number; // percentage
    p95Increase: number; // percentage
    p99Increase: number; // percentage
  };
  throughput: {
    decrease: number; // percentage
  };
  errorRate: {
    increase: number; // percentage points
  };
}

interface RegressionResult {
  testSuite: string;
  passed: boolean;
  issues: RegressionIssue[];
  currentMetrics: any;
  baselineMetrics: any;
}

interface RegressionIssue {
  metric: string;
  current: number;
  baseline: number;
  change: number;
  threshold: number;
  severity: 'warning' | 'critical';
}

class PerformanceRegression {
  private ssm: AWS.SSM;
  private environment: string;
  private apiEndpoint: string;
  private region: string;
  private thresholds: RegressionThresholds;

  constructor(environment: string, apiEndpoint: string, region: string = 'us-east-1') {
    this.environment = environment;
    this.apiEndpoint = apiEndpoint;
    this.region = region;
    this.ssm = new AWS.SSM({ region });
    
    // Default regression thresholds
    this.thresholds = {
      responseTime: {
        avgIncrease: 20, // 20% increase in average response time
        p95Increase: 25, // 25% increase in P95 response time
        p99Increase: 30, // 30% increase in P99 response time
      },
      throughput: {
        decrease: 15, // 15% decrease in throughput
      },
      errorRate: {
        increase: 2, // 2 percentage points increase in error rate
      },
    };
  }

  async runRegressionTests(): Promise<void> {
    console.log(`Running performance regression tests for ${this.environment} environment`);
    console.log(`API Endpoint: ${this.apiEndpoint}`);

    try {
      // 1. Run current performance tests
      console.log('\nRunning current performance tests...');
      const baseline = new PerformanceBaseline(this.environment, this.apiEndpoint, this.region);
      await baseline.runBaselineTests();

      // 2. Load baseline metrics
      console.log('\nLoading baseline metrics...');
      const baselineMetrics = await this.loadBaselineMetrics();

      // 3. Load current metrics
      console.log('Loading current metrics...');
      const currentMetrics = await this.loadCurrentMetrics();

      // 4. Compare metrics and detect regressions
      console.log('\nAnalyzing performance regression...');
      const regressionResults = await this.analyzeRegression(baselineMetrics, currentMetrics);

      // 5. Generate regression report
      await this.generateRegressionReport(regressionResults);

      // 6. Determine overall result
      const hasRegressions = regressionResults.some(result => !result.passed);
      
      if (hasRegressions) {
        console.log('\n❌ Performance regression detected!');
        process.exit(1);
      } else {
        console.log('\n✅ No performance regression detected');
      }

    } catch (error) {
      console.error('Performance regression test failed:', error);
      process.exit(1);
    }
  }

  private async loadBaselineMetrics(): Promise<Record<string, any>> {
    const baselineMetrics: Record<string, any> = {};
    
    // Get list of test suites from the summary
    try {
      const summaryParam = await this.ssm.getParameter({
        Name: `/ai-model-gateway/${this.environment}/performance/baseline/summary`,
      }).promise();

      const summary = JSON.parse(summaryParam.Parameter?.Value || '{}');
      const testSuites = summary.testSuites || [];

      // Load baseline metrics for each test suite
      for (const testSuite of testSuites) {
        try {
          const param = await this.ssm.getParameter({
            Name: `/ai-model-gateway/${this.environment}/performance/baseline/${testSuite.name}`,
          }).promise();

          baselineMetrics[testSuite.name] = JSON.parse(param.Parameter?.Value || '{}');
        } catch (error) {
          console.warn(`Could not load baseline metrics for ${testSuite.name}:`, error);
        }
      }

    } catch (error) {
      console.warn('Could not load baseline summary:', error);
    }

    return baselineMetrics;
  }

  private async loadCurrentMetrics(): Promise<Record<string, any>> {
    const currentMetrics: Record<string, any> = {};
    
    // Load current metrics (just ran)
    const testSuites = ['health-check-load', 'detailed-health-load', 'llm-completion-load', 'mixed-workload'];
    
    for (const testSuite of testSuites) {
      try {
        const param = await this.ssm.getParameter({
          Name: `/ai-model-gateway/${this.environment}/performance/baseline/${testSuite}`,
        }).promise();

        currentMetrics[testSuite] = JSON.parse(param.Parameter?.Value || '{}');
      } catch (error) {
        console.warn(`Could not load current metrics for ${testSuite}:`, error);
      }
    }

    return currentMetrics;
  }

  private async analyzeRegression(
    baselineMetrics: Record<string, any>,
    currentMetrics: Record<string, any>
  ): Promise<RegressionResult[]> {
    const results: RegressionResult[] = [];

    for (const testSuite of Object.keys(currentMetrics)) {
      const current = currentMetrics[testSuite];
      const baseline = baselineMetrics[testSuite];

      if (!baseline) {
        console.warn(`No baseline metrics found for ${testSuite}, skipping regression analysis`);
        continue;
      }

      const issues: RegressionIssue[] = [];

      // Check response time regressions
      const avgResponseTimeChange = this.calculatePercentageChange(
        baseline.metrics.responseTime.avg,
        current.metrics.responseTime.avg
      );

      if (avgResponseTimeChange > this.thresholds.responseTime.avgIncrease) {
        issues.push({
          metric: 'Average Response Time',
          current: current.metrics.responseTime.avg,
          baseline: baseline.metrics.responseTime.avg,
          change: avgResponseTimeChange,
          threshold: this.thresholds.responseTime.avgIncrease,
          severity: avgResponseTimeChange > this.thresholds.responseTime.avgIncrease * 1.5 ? 'critical' : 'warning',
        });
      }

      const p95ResponseTimeChange = this.calculatePercentageChange(
        baseline.metrics.responseTime.p95,
        current.metrics.responseTime.p95
      );

      if (p95ResponseTimeChange > this.thresholds.responseTime.p95Increase) {
        issues.push({
          metric: 'P95 Response Time',
          current: current.metrics.responseTime.p95,
          baseline: baseline.metrics.responseTime.p95,
          change: p95ResponseTimeChange,
          threshold: this.thresholds.responseTime.p95Increase,
          severity: p95ResponseTimeChange > this.thresholds.responseTime.p95Increase * 1.5 ? 'critical' : 'warning',
        });
      }

      // Check throughput regressions
      const throughputChange = this.calculatePercentageChange(
        baseline.metrics.throughput.requestsPerSecond,
        current.metrics.throughput.requestsPerSecond
      );

      if (throughputChange < -this.thresholds.throughput.decrease) {
        issues.push({
          metric: 'Throughput',
          current: current.metrics.throughput.requestsPerSecond,
          baseline: baseline.metrics.throughput.requestsPerSecond,
          change: throughputChange,
          threshold: -this.thresholds.throughput.decrease,
          severity: throughputChange < -this.thresholds.throughput.decrease * 1.5 ? 'critical' : 'warning',
        });
      }

      // Check error rate regressions
      const errorRateChange = current.metrics.errorRate.percentage - baseline.metrics.errorRate.percentage;

      if (errorRateChange > this.thresholds.errorRate.increase) {
        issues.push({
          metric: 'Error Rate',
          current: current.metrics.errorRate.percentage,
          baseline: baseline.metrics.errorRate.percentage,
          change: errorRateChange,
          threshold: this.thresholds.errorRate.increase,
          severity: errorRateChange > this.thresholds.errorRate.increase * 2 ? 'critical' : 'warning',
        });
      }

      results.push({
        testSuite,
        passed: issues.length === 0,
        issues,
        currentMetrics: current.metrics,
        baselineMetrics: baseline.metrics,
      });
    }

    return results;
  }

  private calculatePercentageChange(baseline: number, current: number): number {
    if (baseline === 0) return current === 0 ? 0 : 100;
    return ((current - baseline) / baseline) * 100;
  }

  private async generateRegressionReport(results: RegressionResult[]): Promise<void> {
    console.log('\n=== PERFORMANCE REGRESSION ANALYSIS ===');
    console.log(`Environment: ${this.environment}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    let totalIssues = 0;
    let criticalIssues = 0;
    let warningIssues = 0;

    for (const result of results) {
      console.log(`\n📊 Test Suite: ${result.testSuite}`);
      console.log(`Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);

      if (result.issues.length > 0) {
        console.log(`Issues Found: ${result.issues.length}`);
        
        for (const issue of result.issues) {
          const icon = issue.severity === 'critical' ? '🔴' : '🟡';
          console.log(`  ${icon} ${issue.metric}:`);
          console.log(`    Current: ${issue.current.toFixed(2)}`);
          console.log(`    Baseline: ${issue.baseline.toFixed(2)}`);
          console.log(`    Change: ${issue.change > 0 ? '+' : ''}${issue.change.toFixed(2)}%`);
          console.log(`    Threshold: ${issue.threshold}%`);
          console.log(`    Severity: ${issue.severity.toUpperCase()}`);
          
          totalIssues++;
          if (issue.severity === 'critical') {
            criticalIssues++;
          } else {
            warningIssues++;
          }
        }
      } else {
        console.log('✅ No performance regressions detected');
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Total Test Suites: ${results.length}`);
    console.log(`Passed: ${results.filter(r => r.passed).length}`);
    console.log(`Failed: ${results.filter(r => !r.passed).length}`);
    console.log(`Total Issues: ${totalIssues}`);
    console.log(`Critical Issues: ${criticalIssues}`);
    console.log(`Warning Issues: ${warningIssues}`);

    // Store regression report
    const reportParam = `/ai-model-gateway/${this.environment}/performance/regression/latest`;
    const report = {
      timestamp: new Date().toISOString(),
      environment: this.environment,
      summary: {
        totalTestSuites: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
        totalIssues,
        criticalIssues,
        warningIssues,
      },
      results: results.map(r => ({
        testSuite: r.testSuite,
        passed: r.passed,
        issueCount: r.issues.length,
        issues: r.issues,
      })),
    };

    await this.ssm.putParameter({
      Name: reportParam,
      Value: JSON.stringify(report),
      Type: 'String',
      Overwrite: true,
      Description: 'Latest performance regression test report',
    }).promise();

    console.log('\nRegression report stored in Parameter Store');
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

  const regression = new PerformanceRegression(environment, apiEndpoint, region);
  await regression.runRegressionTests();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Performance regression test failed:', error);
    process.exit(1);
  });
}

export { PerformanceRegression };