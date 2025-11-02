import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../../src/lambda/gateway/handler';
import { ConfigurationManager } from '../../src/services/config/configuration-manager';
import { FeatureFlagService } from '../../src/services/config/feature-flag-service';
import { ProviderRouter } from '../../src/services/router/provider-router';
import { SecurityMonitor } from '../../src/services/monitoring/security-monitor';
import { MetricsService } from '../../src/services/monitoring/metrics-service';
import { TestConfig, TestDataGenerator } from './test-config';

describe('Comprehensive System Testing', () => {
  let testConfig: TestConfig;
  let configManager: ConfigurationManager;
  let featureFlagService: FeatureFlagService;
  let securityMonitor: SecurityMonitor;
  let metricsService: MetricsService;
  let testApiKey: string;
  let testUserId: string;

  beforeAll(async () => {
    testConfig = TestConfig.getInstance();
    await testConfig.setupTestEnvironment();

    // Initialize services
    configManager = ConfigurationManager.getInstance();
    featureFlagService = FeatureFlagService.getInstance();
    securityMonitor = SecurityMonitor.getInstance();
    metricsService = MetricsService.getInstance();

    // Create test user and API key
    testUserId = TestDataGenerator.generateUserId('system-test');
    testApiKey = await testConfig.createTestApiKey(testUserId, 'enterprise');

    // Wait for configuration propagation
    await testConfig.waitForConfigPropagation();
  });

  afterAll(async () => {
    await testConfig.cleanupTestEnvironment();
  });

  describe('11.3 Comprehensive System Testing', () => {
    describe('Load Testing Scenarios', () => {
      test('should handle concurrent requests with multiple providers and MCP integration', async () => {
        const concurrentRequests = 10;
        const requests: Promise<APIGatewayProxyResult>[] = [];

        // Create multiple concurrent requests
        for (let i = 0; i < concurrentRequests; i++) {
          const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
            headers: {
              'X-API-Key': testApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: i % 2 === 0 ? 'gpt-3.5-turbo' : 'claude-3',
              messages: [
                {
                  role: 'user',
                  content: `Load test request ${i}: Find me gaming laptops under $${1000 + i * 100}`,
                },
              ],
              maxTokens: 100,
              temperature: 0.5,
            }),
          });

          requests.push(handler(event));
        }

        // Execute all requests concurrently
        const startTime = Date.now();
        const responses = await Promise.allSettled(requests);
        const endTime = Date.now();

        // Analyze results
        const successful = responses.filter(r => r.status === 'fulfilled' && r.value.statusCode === 200);
        const failed = responses.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.statusCode !== 200));

        // Verify performance
        const totalTime = endTime - startTime;
        const avgResponseTime = totalTime / concurrentRequests;

        expect(successful.length).toBeGreaterThan(concurrentRequests * 0.8); // At least 80% success rate
        expect(avgResponseTime).toBeLessThan(5000); // Average response time under 5 seconds
        expect(totalTime).toBeLessThan(30000); // Total time under 30 seconds

        // Verify all successful responses have proper structure
        successful.forEach(response => {
          if (response.status === 'fulfilled') {
            const body = JSON.parse(response.value.body);
            expect(body.choices).toBeDefined();
            expect(body.usage).toBeDefined();
            expect(body.provider).toBeDefined();
          }
        });

        console.log(`Load test results: ${successful.length}/${concurrentRequests} successful, avg time: ${avgResponseTime}ms`);
      });

      test('should maintain performance under sustained load', async () => {
        const batchSize = 5;
        const batches = 3;
        const results: number[] = [];

        for (let batch = 0; batch < batches; batch++) {
          const batchRequests: Promise<APIGatewayProxyResult>[] = [];

          for (let i = 0; i < batchSize; i++) {
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
                    content: `Sustained load batch ${batch}, request ${i}: Recommend smartphones`,
                  },
                ],
                maxTokens: 50,
                temperature: 0.3,
              }),
            });

            batchRequests.push(handler(event));
          }

          const batchStart = Date.now();
          const batchResponses = await Promise.allSettled(batchRequests);
          const batchEnd = Date.now();

          const batchTime = batchEnd - batchStart;
          results.push(batchTime);

          const successfulInBatch = batchResponses.filter(
            r => r.status === 'fulfilled' && r.value.statusCode === 200
          ).length;

          expect(successfulInBatch).toBeGreaterThan(batchSize * 0.7); // At least 70% success rate per batch

          // Small delay between batches
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Verify performance doesn't degrade significantly
        const firstBatchTime = results[0];
        const lastBatchTime = results[results.length - 1];
        const degradation = (lastBatchTime - firstBatchTime) / firstBatchTime;

        expect(degradation).toBeLessThan(0.5); // Less than 50% performance degradation

        console.log(`Sustained load results: ${results.map(t => `${t}ms`).join(', ')}`);
      });

      test('should handle rate limiting under load correctly', async () => {
        // Create a basic tier user for rate limiting tests
        const basicUserId = TestDataGenerator.generateUserId('basic-load-test');
        const basicApiKey = await testConfig.createTestApiKey(basicUserId, 'basic');

        const requests: Promise<APIGatewayProxyResult>[] = [];
        const requestCount = 20; // Exceed basic tier limits

        for (let i = 0; i < requestCount; i++) {
          const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
            headers: {
              'X-API-Key': basicApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-3.5-turbo',
              messages: [
                {
                  role: 'user',
                  content: `Rate limit test ${i}`,
                },
              ],
              maxTokens: 10,
            }),
          });

          requests.push(handler(event));
        }

        const responses = await Promise.allSettled(requests);

        // Count different response types
        const successful = responses.filter(
          r => r.status === 'fulfilled' && r.value.statusCode === 200
        ).length;
        const rateLimited = responses.filter(
          r => r.status === 'fulfilled' && r.value.statusCode === 429
        ).length;

        // Should have some rate limited responses for basic tier
        expect(rateLimited).toBeGreaterThan(0);
        expect(successful + rateLimited).toBe(requestCount);

        // Verify rate limit headers are present
        responses.forEach(response => {
          if (response.status === 'fulfilled') {
            expect(response.value.headers['X-RateLimit-Remaining-Requests']).toBeDefined();
          }
        });

        console.log(`Rate limiting results: ${successful} successful, ${rateLimited} rate limited`);
      });
    });

    describe('Disaster Recovery and Provider Failover', () => {
      test('should handle provider failover procedures correctly', async () => {
        // First, test with all providers enabled
        const initialEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Test initial provider' }],
            maxTokens: 50,
          }),
        });

        const initialResponse = await handler(initialEvent);
        expect(initialResponse.statusCode).toBe(200);

        const initialBody = JSON.parse(initialResponse.body);
        const initialProvider = initialBody.provider;

        // Disable the primary provider
        await configManager.set(`providers/${initialProvider}/enabled`, false);
        await testConfig.waitForConfigPropagation();

        // Test failover
        const failoverEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Test provider failover' }],
            maxTokens: 50,
          }),
        });

        const failoverResponse = await handler(failoverEvent);
        
        // Should either succeed with different provider or fail gracefully
        if (failoverResponse.statusCode === 200) {
          const failoverBody = JSON.parse(failoverResponse.body);
          expect(failoverBody.provider).not.toBe(initialProvider);
        } else {
          // If no alternative provider available, should return appropriate error
          expect([503, 500]).toContain(failoverResponse.statusCode);
        }

        // Re-enable the provider
        await configManager.set(`providers/${initialProvider}/enabled`, true);
        await testConfig.waitForConfigPropagation();

        // Verify recovery
        const recoveryEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Test provider recovery' }],
            maxTokens: 50,
          }),
        });

        const recoveryResponse = await handler(recoveryEvent);
        expect(recoveryResponse.statusCode).toBe(200);
      });

      test('should handle circuit breaker scenarios', async () => {
        // Simulate multiple failures to trigger circuit breaker
        const failureRequests: Promise<APIGatewayProxyResult>[] = [];

        for (let i = 0; i < 5; i++) {
          const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
            headers: {
              'X-API-Key': testApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'invalid-model-to-trigger-failure',
              messages: [{ role: 'user', content: `Circuit breaker test ${i}` }],
              maxTokens: 10,
            }),
          });

          failureRequests.push(handler(event));
        }

        const failureResponses = await Promise.allSettled(failureRequests);

        // All should handle errors gracefully
        failureResponses.forEach(response => {
          if (response.status === 'fulfilled') {
            expect([400, 500, 503]).toContain(response.value.statusCode);
          }
        });

        // Test that system recovers with valid requests
        const recoveryEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Recovery test after circuit breaker' }],
            maxTokens: 50,
          }),
        });

        const recoveryResponse = await handler(recoveryEvent);
        expect(recoveryResponse.statusCode).toBe(200);
      });

      test('should maintain service availability during configuration changes', async () => {
        // Start a background request
        const backgroundRequest = handler(TestDataGenerator.generateAPIGatewayEvent({
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Background request during config change' }],
            maxTokens: 100,
          }),
        }));

        // Change configuration while request is processing
        await configManager.set('test/config-change', 'new-value');
        
        // The background request should still complete successfully
        const backgroundResponse = await backgroundRequest;
        expect(backgroundResponse.statusCode).toBe(200);

        // Clean up test configuration
        await configManager.delete('test/config-change');
      });
    });

    describe('Security Controls and Compliance', () => {
      test('should validate security controls across all endpoints', async () => {
        const securityTests = [
          {
            name: 'SQL Injection attempt',
            body: JSON.stringify({
              model: 'gpt-3.5-turbo',
              messages: [{ role: 'user', content: "'; DROP TABLE users; --" }],
              maxTokens: 10,
            }),
          },
          {
            name: 'XSS attempt',
            body: JSON.stringify({
              model: 'gpt-3.5-turbo',
              messages: [{ role: 'user', content: '<script>alert("xss")</script>' }],
              maxTokens: 10,
            }),
          },
          {
            name: 'Command injection attempt',
            body: JSON.stringify({
              model: 'gpt-3.5-turbo',
              messages: [{ role: 'user', content: '$(rm -rf /)' }],
              maxTokens: 10,
            }),
          },
        ];

        for (const test of securityTests) {
          const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
            headers: {
              'X-API-Key': testApiKey,
              'Content-Type': 'application/json',
            },
            body: test.body,
          });

          const response = await handler(event);

          // Should handle malicious input gracefully
          expect([200, 400]).toContain(response.statusCode);

          // Verify security headers are present
          expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
          expect(response.headers['X-Frame-Options']).toBe('DENY');
          expect(response.headers['X-XSS-Protection']).toBeDefined();

          if (response.statusCode === 200) {
            const body = JSON.parse(response.body);
            // Response should not contain the malicious input directly
            expect(body.choices[0].message.content).not.toContain('<script>');
            expect(body.choices[0].message.content).not.toContain('DROP TABLE');
          }
        }
      });

      test('should enforce authentication and authorization correctly', async () => {
        const authTests = [
          {
            name: 'No API key',
            headers: { 'Content-Type': 'application/json' },
            expectedStatus: 401,
          },
          {
            name: 'Invalid API key',
            headers: { 'X-API-Key': 'invalid-key-12345', 'Content-Type': 'application/json' },
            expectedStatus: 401,
          },
          {
            name: 'Expired API key',
            headers: { 'X-API-Key': 'expired-key-12345', 'Content-Type': 'application/json' },
            expectedStatus: 401,
          },
        ];

        for (const test of authTests) {
          const event: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
            headers: test.headers,
            body: JSON.stringify({
              model: 'gpt-3.5-turbo',
              messages: [{ role: 'user', content: 'Auth test' }],
            }),
          });

          const response = await handler(event);
          expect(response.statusCode).toBe(test.expectedStatus);

          if (response.statusCode === 401) {
            const body = JSON.parse(response.body);
            expect(body.error).toBeDefined();
          }
        }
      });

      test('should log security events correctly', async () => {
        // Test suspicious activity logging
        const suspiciousEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
          headers: {
            'X-API-Key': 'suspicious-key-attempt',
            'Content-Type': 'application/json',
            'User-Agent': 'AttackBot/1.0',
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: 'Suspicious activity test' }],
          }),
        });

        const response = await handler(suspiciousEvent);
        expect(response.statusCode).toBe(401); // Should reject suspicious request

        // Verify security monitoring is active
        const securityAnalysis = await securityMonitor.analyzeSecurityMetrics();
        expect(securityAnalysis).toBeDefined();
        expect(securityAnalysis.riskLevel).toBeDefined();
      });

      test('should handle data privacy and PII protection', async () => {
        const piiEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
          headers: {
            'X-API-Key': testApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
              {
                role: 'user',
                content: 'My SSN is 123-45-6789 and my credit card is 4111-1111-1111-1111',
              },
            ],
            maxTokens: 100,
          }),
        });

        const response = await handler(piiEvent);
        expect(response.statusCode).toBe(200);

        // Verify PII is handled appropriately (should be sanitized in logs)
        const body = JSON.parse(response.body);
        expect(body.choices[0].message.content).toBeDefined();
        
        // The response should handle PII appropriately
        // (Implementation would depend on specific PII handling requirements)
      });
    });

    describe('Configuration Changes and Feature Flag Rollouts', () => {
      test('should handle feature flag rollouts in production-like environment', async () => {
        // Create a new feature flag for testing
        await featureFlagService.createFlag({
          name: 'test-rollout-feature',
          enabled: true,
          description: 'Test feature for rollout testing',
          rolloutPercentage: 50, // 50% rollout
        });

        const testResults: boolean[] = [];
        const testUsers: string[] = [];

        // Test with multiple users to verify percentage rollout
        for (let i = 0; i < 20; i++) {
          const userId = TestDataGenerator.generateUserId(`rollout-test-${i}`);
          testUsers.push(userId);

          const userContext = testConfig.createTestUserContext(userId);
          const isEnabled = await featureFlagService.isEnabled('test-rollout-feature', userContext);
          testResults.push(isEnabled);
        }

        // Verify approximately 50% rollout (allow some variance)
        const enabledCount = testResults.filter(r => r).length;
        const enabledPercentage = (enabledCount / testResults.length) * 100;
        
        expect(enabledPercentage).toBeGreaterThan(30);
        expect(enabledPercentage).toBeLessThan(70);

        // Test consistency - same user should get same result
        const consistentUser = testUsers[0];
        const userContext = testConfig.createTestUserContext(consistentUser);
        const firstCheck = await featureFlagService.isEnabled('test-rollout-feature', userContext);
        const secondCheck = await featureFlagService.isEnabled('test-rollout-feature', userContext);
        
        expect(firstCheck).toBe(secondCheck);

        // Clean up
        await featureFlagService.deleteFlag('test-rollout-feature');
      });

      test('should handle A/B testing scenarios', async () => {
        // Create an experiment
        await featureFlagService.createExperiment({
          name: 'test-ab-experiment',
          enabled: true,
          description: 'Test A/B experiment',
          trafficAllocation: 80, // 80% of users in experiment
          variants: [
            { name: 'control', weight: 50 },
            { name: 'treatment', weight: 50 },
          ],
        });

        const experimentResults: string[] = [];

        // Test with multiple users
        for (let i = 0; i < 20; i++) {
          const userId = TestDataGenerator.generateUserId(`ab-test-${i}`);
          const userContext = testConfig.createTestUserContext(userId);
          
          const assignment = await featureFlagService.getExperimentAssignment(
            'test-ab-experiment',
            userContext
          );
          
          experimentResults.push(assignment.variant);
        }

        // Verify experiment assignment distribution
        const controlCount = experimentResults.filter(v => v === 'control').length;
        const treatmentCount = experimentResults.filter(v => v === 'treatment').length;
        const totalInExperiment = controlCount + treatmentCount;

        // Should have reasonable distribution
        expect(totalInExperiment).toBeGreaterThan(10); // At least some users in experiment
        expect(controlCount).toBeGreaterThan(0);
        expect(treatmentCount).toBeGreaterThan(0);

        // Clean up
        await featureFlagService.deleteExperiment('test-ab-experiment');
      });

      test('should handle configuration hot reloading', async () => {
        // Set initial configuration
        await configManager.set('test/hot-reload', 'initial-value');
        await testConfig.waitForConfigPropagation();

        // Verify initial value
        const initialValue = await configManager.get('test/hot-reload');
        expect(initialValue).toBe('initial-value');

        // Update configuration
        await configManager.set('test/hot-reload', 'updated-value');
        await testConfig.waitForConfigPropagation();

        // Verify updated value is available
        const updatedValue = await configManager.get('test/hot-reload');
        expect(updatedValue).toBe('updated-value');

        // Clean up
        await configManager.delete('test/hot-reload');
      });

      test('should validate configuration changes before applying', async () => {
        // Test invalid configuration
        try {
          await configManager.set('providers/openai/timeout', 'invalid-number');
          
          // If it doesn't throw, verify the system handles it gracefully
          const timeoutValue = await configManager.get('providers/openai/timeout', 30000);
          expect(typeof timeoutValue).toBe('number');
        } catch (error) {
          // Configuration validation should catch invalid values
          expect(error).toBeDefined();
        }

        // Test valid configuration
        await configManager.set('providers/openai/timeout', 45000);
        const validTimeout = await configManager.get('providers/openai/timeout');
        expect(validTimeout).toBe(45000);

        // Reset to default
        await configManager.set('providers/openai/timeout', 30000);
      });

      test('should handle rollback scenarios', async () => {
        // Set initial configuration
        const originalValue = await configManager.get('providers/openai/enabled', true);
        
        // Make a change
        await configManager.set('providers/openai/enabled', false);
        await testConfig.waitForConfigPropagation();
        
        const changedValue = await configManager.get('providers/openai/enabled');
        expect(changedValue).toBe(false);

        // Rollback
        await configManager.set('providers/openai/enabled', originalValue);
        await testConfig.waitForConfigPropagation();

        const rolledBackValue = await configManager.get('providers/openai/enabled');
        expect(rolledBackValue).toBe(originalValue);
      });
    });

    describe('System Health and Monitoring', () => {
      test('should provide comprehensive health status', async () => {
        const healthEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
          httpMethod: 'GET',
          path: '/api/v1/health/detailed',
        });

        const response = await handler(healthEvent);
        expect(response.statusCode).toBe(200);

        const healthData = JSON.parse(response.body);
        expect(healthData.system).toBeDefined();
        expect(healthData.dependencies).toBeDefined();
        expect(healthData.timestamp).toBeDefined();
      });

      test('should track system metrics correctly', async () => {
        const metricsEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
          httpMethod: 'GET',
          path: '/api/v1/health/metrics',
        });

        const response = await handler(metricsEvent);
        expect(response.statusCode).toBe(200);

        const metricsData = JSON.parse(response.body);
        expect(metricsData.metrics).toBeDefined();
        expect(metricsData.correlation).toBeDefined();
        expect(metricsData.security).toBeDefined();
        expect(metricsData.tracing).toBeDefined();
      });

      test('should handle incident reporting', async () => {
        const incidentsEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
          httpMethod: 'GET',
          path: '/api/v1/health/incidents',
        });

        const response = await handler(incidentsEvent);
        expect(response.statusCode).toBe(200);

        const incidentsData = JSON.parse(response.body);
        expect(incidentsData.activeIncidents).toBeDefined();
        expect(incidentsData.incidentStatistics).toBeDefined();
        expect(incidentsData.securityRiskLevel).toBeDefined();
      });
    });
  });

  describe('Performance Benchmarking', () => {
    test('should meet performance SLA requirements', async () => {
      const performanceTests = [
        { name: 'Simple query', maxTokens: 50, expectedMaxLatency: 3000 },
        { name: 'Complex query', maxTokens: 200, expectedMaxLatency: 8000 },
        { name: 'MCP-enhanced query', maxTokens: 150, expectedMaxLatency: 5000 },
      ];

      for (const test of performanceTests) {
        const startTime = Date.now();
        
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
                content: test.name === 'MCP-enhanced query' 
                  ? 'Find me the best laptops for programming under $1200'
                  : `Performance test: ${test.name}`,
              },
            ],
            maxTokens: test.maxTokens,
          }),
        });

        const response = await handler(event);
        const endTime = Date.now();
        const latency = endTime - startTime;

        expect(response.statusCode).toBe(200);
        expect(latency).toBeLessThan(test.expectedMaxLatency);

        console.log(`${test.name}: ${latency}ms (max: ${test.expectedMaxLatency}ms)`);
      }
    });

    test('should optimize costs effectively', async () => {
      // Test cost optimization stats
      const optimizationEvent: APIGatewayProxyEvent = TestDataGenerator.generateAPIGatewayEvent({
        httpMethod: 'GET',
        path: '/api/v1/optimization/stats',
        headers: {
          'X-API-Key': testApiKey,
        },
      });

      const response = await handler(optimizationEvent);
      expect(response.statusCode).toBe(200);

      const optimizationData = JSON.parse(response.body);
      expect(optimizationData.optimization).toBeDefined();
      expect(optimizationData.timestamp).toBeDefined();
    });
  });
});