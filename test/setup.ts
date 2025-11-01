// Jest setup file for global test configuration

// Mock Redis (when we add it)
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  })),
}), { virtual: true });

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.AWS_REGION = 'us-east-1';

// Global test timeout
jest.setTimeout(30000);