import { TestConfig } from './test-config';

/**
 * Global setup for integration tests
 * Runs before all test suites
 */
beforeAll(async () => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.AWS_REGION = 'us-east-1';
  process.env.LOG_LEVEL = 'warn'; // Reduce log noise during tests
  
  // Increase timeout for integration tests
  jest.setTimeout(60000);
  
  console.log('🔧 Integration test environment initialized');
}, 30000);

/**
 * Global teardown for integration tests
 * Runs after all test suites
 */
afterAll(async () => {
  // Give time for async operations to complete
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('🧹 Integration test environment cleaned up');
}, 10000);

/**
 * Setup for each test file
 */
beforeEach(() => {
  // Reset any global state if needed
  jest.clearAllMocks();
});

/**
 * Teardown for each test
 */
afterEach(async () => {
  // Clean up any test-specific resources
  await new Promise(resolve => setTimeout(resolve, 100));
});