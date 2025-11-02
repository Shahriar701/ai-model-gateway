#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import { TestConfig } from './test-config';

/**
 * Integration test runner
 * Orchestrates the execution of all integration tests with proper setup and teardown
 */
class IntegrationTestRunner {
  private testConfig: TestConfig;
  private testResults: TestResult[] = [];

  constructor() {
    this.testConfig = TestConfig.getInstance();
  }

  /**
   * Run all integration tests
   */
  async runAllTests(): Promise<void> {
    console.log('🚀 Starting AI Model Gateway Integration Tests');
    console.log('================================================');

    try {
      // Setup test environment
      await this.setupEnvironment();

      // Run test suites
      await this.runTestSuite('System Integration', 'system-integration.test.ts');
      await this.runTestSuite('MCP E-commerce Scenarios', 'mcp-ecommerce-scenarios.test.ts');
      await this.runTestSuite('Comprehensive System Testing', 'comprehensive-system.test.ts');

      // Generate test report
      this.generateTestReport();

    } catch (error) {
      console.error('❌ Integration tests failed:', error);
      process.exit(1);
    } finally {
      // Cleanup
      await this.cleanupEnvironment();
    }
  }

  /**
   * Setup test environment
   */
  private async setupEnvironment(): Promise<void> {
    console.log('🔧 Setting up test environment...');
    
    try {
      await this.testConfig.setupTestEnvironment();
      
      // Verify system health
      const isHealthy = await this.testConfig.verifySystemHealth();
      if (!isHealthy) {
        throw new Error('System health check failed');
      }
      
      console.log('✅ Test environment setup completed');
    } catch (error) {
      console.error('❌ Failed to setup test environment:', error);
      throw error;
    }
  }

  /**
   * Run a specific test suite
   */
  private async runTestSuite(suiteName: string, testFile: string): Promise<void> {
    console.log(`\n📋 Running ${suiteName}...`);
    console.log('-'.repeat(50));

    const startTime = Date.now();
    let success = false;
    let output = '';
    let error = '';

    try {
      // Run Jest for the specific test file
      const command = `npx jest test/integration/${testFile} --verbose --detectOpenHandles --forceExit`;
      output = execSync(command, { 
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: 300000, // 5 minutes timeout
      });
      
      success = true;
      console.log('✅ Test suite passed');
    } catch (err: any) {
      success = false;
      error = err.message || 'Unknown error';
      output = err.stdout || '';
      console.error('❌ Test suite failed');
      console.error(error);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    this.testResults.push({
      suiteName,
      testFile,
      success,
      duration,
      output,
      error,
    });

    console.log(`⏱️  Duration: ${duration}ms`);
  }

  /**
   * Generate comprehensive test report
   */
  private generateTestReport(): void {
    console.log('\n📊 Integration Test Report');
    console.log('='.repeat(50));

    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;
    const totalDuration = this.testResults.reduce((sum, r) => sum + r.duration, 0);

    console.log(`Total Test Suites: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);
    console.log(`Total Duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

    console.log('\nDetailed Results:');
    console.log('-'.repeat(50));

    this.testResults.forEach(result => {
      const status = result.success ? '✅' : '❌';
      const duration = `${result.duration}ms`;
      
      console.log(`${status} ${result.suiteName.padEnd(30)} ${duration.padStart(10)}`);
      
      if (!result.success && result.error) {
        console.log(`   Error: ${result.error.split('\n')[0]}`);
      }
    });

    // Performance analysis
    console.log('\nPerformance Analysis:');
    console.log('-'.repeat(50));
    
    const avgDuration = totalDuration / totalTests;
    console.log(`Average test suite duration: ${avgDuration.toFixed(0)}ms`);
    
    const slowestTest = this.testResults.reduce((prev, current) => 
      prev.duration > current.duration ? prev : current
    );
    console.log(`Slowest test suite: ${slowestTest.suiteName} (${slowestTest.duration}ms)`);

    // Coverage and quality metrics
    console.log('\nTest Coverage Areas:');
    console.log('-'.repeat(50));
    console.log('✅ System Integration (Gateway, Providers, MCP, Caching)');
    console.log('✅ Authentication and Authorization');
    console.log('✅ MCP E-commerce Scenarios');
    console.log('✅ Product Search and Recommendations');
    console.log('✅ Load Testing and Performance');
    console.log('✅ Provider Failover and Circuit Breakers');
    console.log('✅ Security Controls and Compliance');
    console.log('✅ Configuration Management and Feature Flags');
    console.log('✅ Observability and Monitoring');

    // Final status
    if (failedTests === 0) {
      console.log('\n🎉 All integration tests passed successfully!');
      console.log('The AI Model Gateway is ready for production deployment.');
    } else {
      console.log(`\n⚠️  ${failedTests} test suite(s) failed.`);
      console.log('Please review the failures before proceeding to production.');
      process.exit(1);
    }
  }

  /**
   * Cleanup test environment
   */
  private async cleanupEnvironment(): Promise<void> {
    console.log('\n🧹 Cleaning up test environment...');
    
    try {
      await this.testConfig.cleanupTestEnvironment();
      console.log('✅ Test environment cleanup completed');
    } catch (error) {
      console.warn('⚠️  Warning: Test environment cleanup had issues:', error);
    }
  }

  /**
   * Run specific test categories
   */
  async runTestCategory(category: 'integration' | 'mcp' | 'system' | 'all'): Promise<void> {
    console.log(`🎯 Running ${category} tests...`);

    await this.setupEnvironment();

    try {
      switch (category) {
        case 'integration':
          await this.runTestSuite('System Integration', 'system-integration.test.ts');
          break;
        case 'mcp':
          await this.runTestSuite('MCP E-commerce Scenarios', 'mcp-ecommerce-scenarios.test.ts');
          break;
        case 'system':
          await this.runTestSuite('Comprehensive System Testing', 'comprehensive-system.test.ts');
          break;
        case 'all':
        default:
          await this.runAllTests();
          return;
      }

      this.generateTestReport();
    } finally {
      await this.cleanupEnvironment();
    }
  }
}

/**
 * Test result interface
 */
interface TestResult {
  suiteName: string;
  testFile: string;
  success: boolean;
  duration: number;
  output: string;
  error: string;
}

/**
 * CLI interface
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const category = args[0] as 'integration' | 'mcp' | 'system' | 'all' || 'all';

  const runner = new IntegrationTestRunner();
  
  if (category === 'all') {
    await runner.runAllTests();
  } else {
    await runner.runTestCategory(category);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Integration test runner failed:', error);
    process.exit(1);
  });
}

export { IntegrationTestRunner };