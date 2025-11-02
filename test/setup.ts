// Jest setup file for global test configuration

// Mock Redis
jest.mock(
  'redis',
  () => ({
    createClient: jest.fn(() => ({
      connect: jest.fn(),
      disconnect: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn(),
      flushall: jest.fn(),
    })),
  }),
  { virtual: true }
);

// Mock AWS SDK
jest.mock('aws-sdk', () => ({
  SSM: jest.fn(() => ({
    getParameter: jest.fn().mockReturnValue({
      promise: () => Promise.resolve({ Parameter: { Value: 'test-value' } }),
    }),
    putParameter: jest.fn().mockReturnValue({
      promise: () => Promise.resolve({}),
    }),
    deleteParameter: jest.fn().mockReturnValue({
      promise: () => Promise.resolve({}),
    }),
    getParametersByPath: jest.fn().mockReturnValue({
      promise: () => Promise.resolve({ Parameters: [] }),
    }),
  })),
  CloudWatch: jest.fn(() => ({
    putMetricData: jest.fn().mockReturnValue({
      promise: () => Promise.resolve({}),
    }),
    putDashboard: jest.fn().mockReturnValue({
      promise: () => Promise.resolve({}),
    }),
    getDashboard: jest.fn().mockReturnValue({
      promise: () => Promise.resolve({ DashboardBody: '{}' }),
    }),
    putMetricAlarm: jest.fn().mockReturnValue({
      promise: () => Promise.resolve({}),
    }),
  })),
  SNS: jest.fn(() => ({
    publish: jest.fn().mockReturnValue({
      promise: () => Promise.resolve({ MessageId: 'test-message-id' }),
    }),
  })),
  DynamoDB: {
    DocumentClient: jest.fn(() => ({
      get: jest.fn().mockReturnValue({
        promise: () => Promise.resolve({ Item: {} }),
      }),
      put: jest.fn().mockReturnValue({
        promise: () => Promise.resolve({}),
      }),
      update: jest.fn().mockReturnValue({
        promise: () => Promise.resolve({}),
      }),
      delete: jest.fn().mockReturnValue({
        promise: () => Promise.resolve({}),
      }),
      query: jest.fn().mockReturnValue({
        promise: () => Promise.resolve({ Items: [] }),
      }),
      scan: jest.fn().mockReturnValue({
        promise: () => Promise.resolve({ Items: [] }),
      }),
    })),
  },
  BedrockRuntime: jest.fn(() => ({
    invokeModel: jest.fn().mockReturnValue({
      promise: () => Promise.resolve({
        body: Buffer.from(JSON.stringify({
          completion: 'Test response',
          stop_reason: 'end_turn',
        })),
      }),
    }),
  })),
}));

// Mock X-Ray SDK
jest.mock('aws-xray-sdk-core', () => ({
  getSegment: jest.fn(() => ({
    trace_id: 'test-trace-id',
    id: 'test-segment-id',
    addNewSubsegment: jest.fn(() => ({
      addAnnotation: jest.fn(),
      addMetadata: jest.fn(),
      addError: jest.fn(),
      close: jest.fn(),
    })),
    addAnnotation: jest.fn(),
    addMetadata: jest.fn(),
    addError: jest.fn(),
  })),
  captureAWS: jest.fn((service) => service),
  captureHTTPsGlobal: jest.fn(),
  config: jest.fn(),
  middleware: {
    setSamplingRules: jest.fn(),
  },
  plugins: {
    ECSPlugin: {},
    EC2Plugin: {},
  },
  Segment: jest.fn(() => ({
    addAnnotation: jest.fn(),
    addMetadata: jest.fn(),
    addError: jest.fn(),
    close: jest.fn(),
  })),
}));

// Mock Axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    post: jest.fn(),
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  })),
  post: jest.fn(),
  get: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
}));

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.AWS_REGION = 'us-east-1';
process.env.CLOUDWATCH_NAMESPACE = 'AIModelGateway-Test';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.ADMIN_API_KEY = 'test-admin-key';

// Global test timeout
jest.setTimeout(30000);

// Global test utilities
global.testUtils = {
  createMockLLMRequest: (overrides = {}) => ({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.7,
    maxTokens: 100,
    ...overrides,
  }),
  
  createMockLLMResponse: (overrides = {}) => ({
    id: 'test-response-id',
    model: 'gpt-4',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello! How can I help you?' },
        finishReason: 'stop',
      },
    ],
    usage: {
      promptTokens: 10,
      completionTokens: 15,
      totalTokens: 25,
    },
    cost: {
      total: 0.001,
      promptCost: 0.0003,
      completionCost: 0.0007,
      currency: 'USD',
    },
    latency: 1500,
    provider: 'openai',
    ...overrides,
  }),
  
  createMockAPIGatewayEvent: (overrides = {}) => ({
    httpMethod: 'GET',
    path: '/api/v1/health',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'test-agent',
    },
    queryStringParameters: null,
    pathParameters: null,
    body: null,
    isBase64Encoded: false,
    requestContext: {
      requestId: 'test-request-id',
      stage: 'test',
      httpMethod: 'GET',
      path: '/api/v1/health',
      protocol: 'HTTP/1.1',
      requestTime: '01/Jan/2023:00:00:00 +0000',
      requestTimeEpoch: 1672531200000,
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent',
      },
      accountId: '123456789012',
      apiId: 'test-api-id',
      resourceId: 'test-resource-id',
      resourcePath: '/api/v1/health',
    },
    resource: '/api/v1/health',
    stageVariables: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    ...overrides,
  }),
};
