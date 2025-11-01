/**
 * Environment-specific configuration for AI Model Gateway
 * This demonstrates production-ready configuration management
 */

export interface EnvironmentConfig {
  // Environment identification
  environment: string;
  region: string;

  // Application configuration
  app: {
    name: string;
    version: string;
    logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  };

  // API Gateway configuration
  api: {
    throttling: {
      rateLimit: number;
      burstLimit: number;
    };
    cors: {
      allowOrigins: string[];
      allowMethods: string[];
      allowHeaders: string[];
    };
  };

  // LLM Provider configuration
  providers: {
    openai: {
      enabled: boolean;
      priority: number;
      timeout: number;
      retryAttempts: number;
    };
    bedrock: {
      enabled: boolean;
      priority: number;
      timeout: number;
      retryAttempts: number;
      models: string[];
    };
  };

  // Caching configuration
  cache: {
    ttl: number;
    maxSize: string;
    evictionPolicy: 'LRU' | 'LFU';
  };

  // Monitoring and observability
  monitoring: {
    metricsNamespace: string;
    logRetentionDays: number;
    tracingEnabled: boolean;
    alertingEnabled: boolean;
  };

  // Security configuration
  security: {
    encryptionAtRest: boolean;
    encryptionInTransit: boolean;
    apiKeyRotationDays: number;
  };
}

// Development environment configuration
export const devConfig: EnvironmentConfig = {
  environment: 'dev',
  region: 'us-east-1',

  app: {
    name: 'ai-model-gateway',
    version: '0.1.0',
    logLevel: 'DEBUG',
  },

  api: {
    throttling: {
      rateLimit: 100,
      burstLimit: 200,
    },
    cors: {
      allowOrigins: ['*'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    },
  },

  providers: {
    openai: {
      enabled: true,
      priority: 1,
      timeout: 30000,
      retryAttempts: 3,
    },
    bedrock: {
      enabled: true,
      priority: 2,
      timeout: 30000,
      retryAttempts: 3,
      models: ['anthropic.claude-3-sonnet-20240229-v1:0', 'meta.llama2-70b-chat-v1'],
    },
  },

  cache: {
    ttl: 300, // 5 minutes
    maxSize: '100mb',
    evictionPolicy: 'LRU',
  },

  monitoring: {
    metricsNamespace: 'AIGateway/Dev',
    logRetentionDays: 7,
    tracingEnabled: true,
    alertingEnabled: false,
  },

  security: {
    encryptionAtRest: true,
    encryptionInTransit: true,
    apiKeyRotationDays: 90,
  },
};

// Production environment configuration
export const prodConfig: EnvironmentConfig = {
  environment: 'prod',
  region: 'us-east-1',

  app: {
    name: 'ai-model-gateway',
    version: '0.1.0',
    logLevel: 'INFO',
  },

  api: {
    throttling: {
      rateLimit: 1000,
      burstLimit: 2000,
    },
    cors: {
      allowOrigins: ['https://yourdomain.com', 'https://api.yourdomain.com'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    },
  },

  providers: {
    openai: {
      enabled: true,
      priority: 1,
      timeout: 30000,
      retryAttempts: 3,
    },
    bedrock: {
      enabled: true,
      priority: 2,
      timeout: 30000,
      retryAttempts: 3,
      models: [
        'anthropic.claude-3-sonnet-20240229-v1:0',
        'anthropic.claude-3-haiku-20240307-v1:0',
        'meta.llama2-70b-chat-v1',
      ],
    },
  },

  cache: {
    ttl: 600, // 10 minutes
    maxSize: '1gb',
    evictionPolicy: 'LRU',
  },

  monitoring: {
    metricsNamespace: 'AIGateway/Prod',
    logRetentionDays: 30,
    tracingEnabled: true,
    alertingEnabled: true,
  },

  security: {
    encryptionAtRest: true,
    encryptionInTransit: true,
    apiKeyRotationDays: 30,
  },
};

// Configuration factory
export const getConfig = (environment?: string): EnvironmentConfig => {
  const env = environment || process.env.ENVIRONMENT || 'dev';

  switch (env) {
    case 'prod':
    case 'production':
      return prodConfig;
    case 'dev':
    case 'development':
    default:
      return devConfig;
  }
};
