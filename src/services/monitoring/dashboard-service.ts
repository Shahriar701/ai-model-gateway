import { CloudWatch } from 'aws-sdk';
import { Logger } from '../../shared/utils';

/**
 * Service for creating and managing CloudWatch dashboards
 * Provides operational visibility into system performance and security
 */
export class DashboardService {
  private static instance: DashboardService;
  private cloudWatch: CloudWatch;
  private logger: Logger;
  private namespace: string;

  private constructor() {
    this.cloudWatch = new CloudWatch({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.logger = new Logger('DashboardService');
    this.namespace = process.env.CLOUDWATCH_NAMESPACE || 'AIModelGateway';
  }

  static getInstance(): DashboardService {
    if (!DashboardService.instance) {
      DashboardService.instance = new DashboardService();
    }
    return DashboardService.instance;
  }

  /**
   * Create comprehensive operational dashboard
   */
  async createOperationalDashboard(): Promise<string> {
    const dashboardName = 'AI-Model-Gateway-Operations';
    
    const dashboardBody = {
      widgets: [
        // Row 1: Overview metrics
        this.createRequestOverviewWidget(0, 0),
        this.createLatencyOverviewWidget(12, 0),
        
        // Row 2: Error and success rates
        this.createErrorRateWidget(0, 6),
        this.createSuccessRateWidget(12, 6),
        
        // Row 3: Cost and performance
        this.createCostMetricsWidget(0, 12),
        this.createPerformanceMetricsWidget(12, 12),
        
        // Row 4: Provider health
        this.createProviderHealthWidget(0, 18),
        this.createProviderLatencyWidget(12, 18),
        
        // Row 5: Cache and rate limiting
        this.createCacheMetricsWidget(0, 24),
        this.createRateLimitWidget(12, 24),
        
        // Row 6: Security overview
        this.createSecurityOverviewWidget(0, 30),
        this.createAuthMetricsWidget(12, 30),
      ],
    };

    try {
      await this.cloudWatch.putDashboard({
        DashboardName: dashboardName,
        DashboardBody: JSON.stringify(dashboardBody),
      }).promise();

      this.logger.info('Operational dashboard created successfully', { dashboardName });
      return dashboardName;
    } catch (error) {
      this.logger.error('Failed to create operational dashboard', error as Error);
      throw error;
    }
  }

  /**
   * Create security-focused dashboard
   */
  async createSecurityDashboard(): Promise<string> {
    const dashboardName = 'AI-Model-Gateway-Security';
    
    const dashboardBody = {
      widgets: [
        // Row 1: Security events overview
        this.createSecurityEventsWidget(0, 0),
        this.createThreatLevelWidget(12, 0),
        
        // Row 2: Authentication and authorization
        this.createAuthFailuresWidget(0, 6),
        this.createRateLimitViolationsWidget(12, 6),
        
        // Row 3: Attack patterns
        this.createAttackPatternsWidget(0, 12),
        this.createSourceIPAnalysisWidget(12, 12),
        
        // Row 4: Security alerts
        this.createSecurityAlertsWidget(0, 18),
        this.createIncidentResponseWidget(12, 18),
      ],
    };

    try {
      await this.cloudWatch.putDashboard({
        DashboardName: dashboardName,
        DashboardBody: JSON.stringify(dashboardBody),
      }).promise();

      this.logger.info('Security dashboard created successfully', { dashboardName });
      return dashboardName;
    } catch (error) {
      this.logger.error('Failed to create security dashboard', error as Error);
      throw error;
    }
  }

  /**
   * Create business metrics dashboard
   */
  async createBusinessDashboard(): Promise<string> {
    const dashboardName = 'AI-Model-Gateway-Business';
    
    const dashboardBody = {
      widgets: [
        // Row 1: Business KPIs
        this.createRevenueMetricsWidget(0, 0),
        this.createUsageMetricsWidget(12, 0),
        
        // Row 2: Cost optimization
        this.createCostOptimizationWidget(0, 6),
        this.createEfficiencyMetricsWidget(12, 6),
        
        // Row 3: User behavior
        this.createUserBehaviorWidget(0, 12),
        this.createModelUsageWidget(12, 12),
        
        // Row 4: Trends and forecasting
        this.createTrendsWidget(0, 18),
        this.createForecastingWidget(12, 18),
      ],
    };

    try {
      await this.cloudWatch.putDashboard({
        DashboardName: dashboardName,
        DashboardBody: JSON.stringify(dashboardBody),
      }).promise();

      this.logger.info('Business dashboard created successfully', { dashboardName });
      return dashboardName;
    } catch (error) {
      this.logger.error('Failed to create business dashboard', error as Error);
      throw error;
    }
  }

  /**
   * Update dashboard with new metrics
   */
  async updateDashboard(dashboardName: string, additionalWidgets: any[]): Promise<void> {
    try {
      // Get existing dashboard
      const existing = await this.cloudWatch.getDashboard({
        DashboardName: dashboardName,
      }).promise();

      const existingBody = JSON.parse(existing.DashboardBody!);
      existingBody.widgets.push(...additionalWidgets);

      // Update dashboard
      await this.cloudWatch.putDashboard({
        DashboardName: dashboardName,
        DashboardBody: JSON.stringify(existingBody),
      }).promise();

      this.logger.info('Dashboard updated successfully', { 
        dashboardName, 
        addedWidgets: additionalWidgets.length 
      });
    } catch (error) {
      this.logger.error('Failed to update dashboard', error as Error, { dashboardName });
      throw error;
    }
  }

  // Widget creation methods

  private createRequestOverviewWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'RequestCount', 'Provider', 'openai'],
          ['.', '.', '.', 'bedrock'],
          ['.', 'SuccessfulRequests'],
          ['.', 'FailedRequests'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Request Overview',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createLatencyOverviewWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'RequestLatency', 'Provider', 'openai'],
          ['.', '.', '.', 'bedrock'],
          ['.', 'AuthenticationLatency'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Latency Overview',
        period: 300,
        stat: 'Average',
        yAxis: {
          left: {
            min: 0,
          },
        },
      },
    };
  }

  private createErrorRateWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'ErrorCount', 'ErrorType', 'AUTHENTICATION_ERROR'],
          ['.', '.', '.', 'RATE_LIMIT_EXCEEDED'],
          ['.', '.', '.', 'PROVIDER_UNAVAILABLE'],
          ['.', '.', '.', 'INTERNAL_ERROR'],
        ],
        view: 'timeSeries',
        stacked: true,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Error Rate by Type',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createSuccessRateWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [{ expression: 'm1/(m1+m2)*100', label: 'Success Rate %' }],
          [this.namespace, 'SuccessfulRequests', { id: 'm1', visible: false }],
          ['.', 'FailedRequests', { id: 'm2', visible: false }],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Success Rate',
        period: 300,
        stat: 'Sum',
        yAxis: {
          left: {
            min: 0,
            max: 100,
          },
        },
      },
    };
  }

  private createCostMetricsWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'RequestCost', 'Provider', 'openai'],
          ['.', '.', '.', 'bedrock'],
          ['.', 'TotalCost'],
          ['.', 'CostPerRequest'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Cost Metrics',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createPerformanceMetricsWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'TokensUsed', 'Provider', 'openai'],
          ['.', '.', '.', 'bedrock'],
          ['.', 'MessageCount'],
          ['.', 'MessageLength'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Performance Metrics',
        period: 300,
        stat: 'Average',
      },
    };
  }

  private createProviderHealthWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'ProviderHealth', 'Provider', 'openai'],
          ['.', '.', '.', 'bedrock'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Provider Health Status',
        period: 300,
        stat: 'Average',
        yAxis: {
          left: {
            min: 0,
            max: 1,
          },
        },
      },
    };
  }

  private createProviderLatencyWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'ProviderLatency', 'Provider', 'openai'],
          ['.', '.', '.', 'bedrock'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Provider Latency',
        period: 300,
        stat: 'Average',
      },
    };
  }

  private createCacheMetricsWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'CacheHit'],
          ['.', 'CacheMiss'],
          [{ expression: 'm1/(m1+m2)*100', label: 'Cache Hit Rate %' }],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Cache Performance',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createRateLimitWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'RateLimitChecks', 'Tier', 'free'],
          ['.', '.', '.', 'basic'],
          ['.', '.', '.', 'premium'],
          ['.', 'RateLimitExceeded'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Rate Limiting',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createSecurityOverviewWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'SecurityEvents', 'SecurityEventType', 'AUTHENTICATION_FAILURE'],
          ['.', '.', '.', 'DANGEROUS_PATTERN_DETECTED'],
          ['.', '.', '.', 'RATE_LIMIT_EXCEEDED'],
        ],
        view: 'timeSeries',
        stacked: true,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Security Events',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createAuthMetricsWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'AuthenticationAttempts', 'AuthResult', 'Success'],
          ['.', '.', '.', 'Failure'],
          ['.', 'AuthenticationFailures'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Authentication Metrics',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  // Security dashboard specific widgets
  private createSecurityEventsWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'SecurityEvents', 'Severity', 'CRITICAL'],
          ['.', '.', '.', 'HIGH'],
          ['.', '.', '.', 'MEDIUM'],
          ['.', '.', '.', 'LOW'],
        ],
        view: 'timeSeries',
        stacked: true,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Security Events by Severity',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createThreatLevelWidget(x: number, y: number) {
    return {
      type: 'number',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'SecurityEvents', 'Severity', 'CRITICAL'],
        ],
        view: 'singleValue',
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Current Threat Level',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createAuthFailuresWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'AuthenticationFailures', 'Tier', 'free'],
          ['.', '.', '.', 'basic'],
          ['.', '.', '.', 'premium'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Authentication Failures by Tier',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createRateLimitViolationsWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'RateLimitExceeded', 'Tier', 'free'],
          ['.', '.', '.', 'basic'],
          ['.', '.', '.', 'premium'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Rate Limit Violations',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createAttackPatternsWidget(x: number, y: number) {
    return {
      type: 'log',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        query: `SOURCE '/aws/lambda/ai-model-gateway' | fields @timestamp, @message
| filter @message like /DANGEROUS_PATTERN_DETECTED/
| stats count() by bin(5m)`,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Attack Patterns Detected',
        view: 'table',
      },
    };
  }

  private createSourceIPAnalysisWidget(x: number, y: number) {
    return {
      type: 'log',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        query: `SOURCE '/aws/lambda/ai-model-gateway' | fields @timestamp, sourceIp
| filter @message like /Authentication failed/
| stats count() by sourceIp
| sort count desc
| limit 10`,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Top Failed Auth Source IPs',
        view: 'table',
      },
    };
  }

  private createSecurityAlertsWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'SecurityEvents', 'SecurityEventType', 'HIGH_AUTH_FAILURES'],
          ['.', '.', '.', 'DANGEROUS_PATTERNS_DETECTED'],
          ['.', '.', '.', 'POTENTIAL_COORDINATED_ATTACK'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Security Alerts',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createIncidentResponseWidget(x: number, y: number) {
    return {
      type: 'log',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        query: `SOURCE '/aws/lambda/ai-model-gateway' | fields @timestamp, @message
| filter @message like /CRITICAL SECURITY ALERT/
| sort @timestamp desc
| limit 20`,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Recent Security Incidents',
        view: 'table',
      },
    };
  }

  // Business dashboard specific widgets
  private createRevenueMetricsWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'TotalCost', 'Period', 'hour'],
          ['.', '.', '.', 'day'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Revenue Metrics',
        period: 3600,
        stat: 'Sum',
      },
    };
  }

  private createUsageMetricsWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'TotalRequests', 'Period', 'hour'],
          ['.', '.', '.', 'day'],
          ['.', 'TokensUsed'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Usage Metrics',
        period: 3600,
        stat: 'Sum',
      },
    };
  }

  private createCostOptimizationWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'CostPerRequest'],
          [{ expression: 'm1*100', label: 'Cache Hit Rate %' }],
          [this.namespace, 'CacheHit', { id: 'm1', visible: false }],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Cost Optimization',
        period: 300,
        stat: 'Average',
      },
    };
  }

  private createEfficiencyMetricsWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'AverageLatency'],
          [{ expression: 'm1/m2', label: 'Tokens per Request' }],
          [this.namespace, 'TokensUsed', { id: 'm1', visible: false }],
          ['.', 'RequestCount', { id: 'm2', visible: false }],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Efficiency Metrics',
        period: 300,
        stat: 'Average',
      },
    };
  }

  private createUserBehaviorWidget(x: number, y: number) {
    return {
      type: 'log',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        query: `SOURCE '/aws/lambda/ai-model-gateway' | fields @timestamp, model, provider
| filter @message like /LLM completion successful/
| stats count() by model
| sort count desc`,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Model Usage Patterns',
        view: 'table',
      },
    };
  }

  private createModelUsageWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'RequestCount', 'Model', 'gpt-4'],
          ['.', '.', '.', 'gpt-3.5-turbo'],
          ['.', '.', '.', 'claude-3'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Model Usage Distribution',
        period: 300,
        stat: 'Sum',
      },
    };
  }

  private createTrendsWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [this.namespace, 'RequestCount'],
          ['.', 'TotalCost'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Usage Trends',
        period: 3600,
        stat: 'Sum',
      },
    };
  }

  private createForecastingWidget(x: number, y: number) {
    return {
      type: 'metric',
      x,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [{ expression: 'ANOMALY_DETECTION_FUNCTION(m1, 2)', label: 'Request Anomaly Detection' }],
          [this.namespace, 'RequestCount', { id: 'm1' }],
        ],
        view: 'timeSeries',
        stacked: false,
        region: process.env.AWS_REGION || 'us-east-1',
        title: 'Anomaly Detection',
        period: 300,
        stat: 'Average',
      },
    };
  }
}