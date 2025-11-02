import { CloudWatch, SNS } from 'aws-sdk';
import { Logger } from '../../shared/utils';
import { SecurityAlert, SecurityAnalysisResult } from './security-monitor';

/**
 * Comprehensive alerting service for operational and security events
 * Integrates with CloudWatch alarms and security monitoring
 */
export class AlertingService {
  private static instance: AlertingService;
  private cloudWatch: CloudWatch;
  private sns: SNS;
  private logger: Logger;
  private namespace: string;
  private alertTopicArn?: string;
  private securityTopicArn?: string;

  // Alert thresholds
  private static readonly ALERT_THRESHOLDS = {
    errorRate: 5, // 5% error rate
    latencyP95: 5000, // 5 seconds
    costPerHour: 100, // $100 per hour
    authFailuresPerMinute: 10,
    rateLimitExceededPerMinute: 50,
    securityEventsPerMinute: 5,
  };

  private constructor() {
    this.cloudWatch = new CloudWatch({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.sns = new SNS({
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.logger = new Logger('AlertingService');
    this.namespace = process.env.CLOUDWATCH_NAMESPACE || 'AIModelGateway';
    this.alertTopicArn = process.env.ALERT_TOPIC_ARN;
    this.securityTopicArn = process.env.SECURITY_ALERT_TOPIC_ARN;
  }

  static getInstance(): AlertingService {
    if (!AlertingService.instance) {
      AlertingService.instance = new AlertingService();
    }
    return AlertingService.instance;
  }

  /**
   * Create comprehensive CloudWatch alarms
   */
  async createAlarms(): Promise<void> {
    try {
      await Promise.all([
        this.createPerformanceAlarms(),
        this.createErrorAlarms(),
        this.createCostAlarms(),
        this.createSecurityAlarms(),
        this.createBusinessAlarms(),
      ]);

      this.logger.info('All CloudWatch alarms created successfully');
    } catch (error) {
      this.logger.error('Failed to create CloudWatch alarms', error as Error);
      throw error;
    }
  }

  /**
   * Create performance-related alarms
   */
  private async createPerformanceAlarms(): Promise<void> {
    // High latency alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-High-Latency',
      AlarmDescription: 'High request latency detected',
      MetricName: 'RequestLatency',
      Statistic: 'Average',
      Threshold: AlertingService.ALERT_THRESHOLDS.latencyP95,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 2,
      Period: 300,
      Severity: 'HIGH',
    });

    // Low throughput alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-Low-Throughput',
      AlarmDescription: 'Unusually low request throughput',
      MetricName: 'RequestCount',
      Statistic: 'Sum',
      Threshold: 10,
      ComparisonOperator: 'LessThanThreshold',
      EvaluationPeriods: 3,
      Period: 300,
      Severity: 'MEDIUM',
    });

    // Provider health alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-Provider-Unhealthy',
      AlarmDescription: 'Provider health check failing',
      MetricName: 'ProviderHealth',
      Statistic: 'Average',
      Threshold: 0.5,
      ComparisonOperator: 'LessThanThreshold',
      EvaluationPeriods: 2,
      Period: 300,
      Severity: 'CRITICAL',
    });
  }

  /**
   * Create error-related alarms
   */
  private async createErrorAlarms(): Promise<void> {
    // High error rate alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-High-Error-Rate',
      AlarmDescription: 'High error rate detected',
      MetricName: 'ErrorCount',
      Statistic: 'Sum',
      Threshold: AlertingService.ALERT_THRESHOLDS.errorRate,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 2,
      Period: 300,
      Severity: 'HIGH',
    });

    // Authentication failures alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-Auth-Failures',
      AlarmDescription: 'High authentication failure rate',
      MetricName: 'AuthenticationFailures',
      Statistic: 'Sum',
      Threshold: AlertingService.ALERT_THRESHOLDS.authFailuresPerMinute,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 1,
      Period: 60,
      Severity: 'HIGH',
    });

    // Provider unavailable alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-Provider-Unavailable',
      AlarmDescription: 'Provider completely unavailable',
      MetricName: 'ErrorCount',
      Dimensions: [{ Name: 'ErrorType', Value: 'PROVIDER_UNAVAILABLE' }],
      Statistic: 'Sum',
      Threshold: 5,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 1,
      Period: 300,
      Severity: 'CRITICAL',
    });
  }

  /**
   * Create cost-related alarms
   */
  private async createCostAlarms(): Promise<void> {
    // High cost per hour alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-High-Cost',
      AlarmDescription: 'High cost per hour detected',
      MetricName: 'TotalCost',
      Dimensions: [{ Name: 'Period', Value: 'hour' }],
      Statistic: 'Sum',
      Threshold: AlertingService.ALERT_THRESHOLDS.costPerHour,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 1,
      Period: 3600,
      Severity: 'MEDIUM',
    });

    // Unusual cost spike alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-Cost-Spike',
      AlarmDescription: 'Unusual cost spike detected',
      MetricName: 'RequestCost',
      Statistic: 'Average',
      Threshold: 1.0, // $1 per request
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 2,
      Period: 300,
      Severity: 'HIGH',
    });
  }

  /**
   * Create security-related alarms
   */
  private async createSecurityAlarms(): Promise<void> {
    // Rate limit violations alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-Rate-Limit-Violations',
      AlarmDescription: 'High rate limit violation rate',
      MetricName: 'RateLimitExceeded',
      Statistic: 'Sum',
      Threshold: AlertingService.ALERT_THRESHOLDS.rateLimitExceededPerMinute,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 1,
      Period: 60,
      Severity: 'MEDIUM',
    });

    // Security events alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-Security-Events',
      AlarmDescription: 'High security event rate',
      MetricName: 'SecurityEvents',
      Dimensions: [{ Name: 'Severity', Value: 'HIGH' }],
      Statistic: 'Sum',
      Threshold: AlertingService.ALERT_THRESHOLDS.securityEventsPerMinute,
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 1,
      Period: 60,
      Severity: 'CRITICAL',
    });

    // Critical security events alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-Critical-Security-Events',
      AlarmDescription: 'Critical security events detected',
      MetricName: 'SecurityEvents',
      Dimensions: [{ Name: 'Severity', Value: 'CRITICAL' }],
      Statistic: 'Sum',
      Threshold: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      EvaluationPeriods: 1,
      Period: 60,
      Severity: 'CRITICAL',
    });
  }

  /**
   * Create business-related alarms
   */
  private async createBusinessAlarms(): Promise<void> {
    // Low cache hit rate alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-Low-Cache-Hit-Rate',
      AlarmDescription: 'Cache hit rate below optimal threshold',
      MetricName: 'CacheHit',
      Statistic: 'Sum',
      Threshold: 0.7, // 70% hit rate
      ComparisonOperator: 'LessThanThreshold',
      EvaluationPeriods: 3,
      Period: 300,
      Severity: 'LOW',
    });

    // Unusual request pattern alarm
    await this.createAlarm({
      AlarmName: 'AI-Gateway-Unusual-Request-Pattern',
      AlarmDescription: 'Unusual request pattern detected',
      MetricName: 'RequestCount',
      Statistic: 'Sum',
      Threshold: 1000, // Adjust based on normal traffic
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 2,
      Period: 300,
      Severity: 'MEDIUM',
    });
  }

  /**
   * Create a CloudWatch alarm with standardized configuration
   */
  private async createAlarm(config: AlarmConfig): Promise<void> {
    const alarmParams: CloudWatch.PutMetricAlarmInput = {
      AlarmName: config.AlarmName,
      AlarmDescription: config.AlarmDescription,
      MetricName: config.MetricName,
      Namespace: this.namespace,
      Statistic: config.Statistic,
      Dimensions: config.Dimensions || [],
      Period: config.Period,
      EvaluationPeriods: config.EvaluationPeriods,
      Threshold: config.Threshold,
      ComparisonOperator: config.ComparisonOperator,
      TreatMissingData: 'notBreaching',
      AlarmActions: this.getAlarmActions(config.Severity),
      OKActions: this.getOkActions(config.Severity),
    };

    try {
      await this.cloudWatch.putMetricAlarm(alarmParams).promise();
      this.logger.debug('CloudWatch alarm created', {
        alarmName: config.AlarmName,
        severity: config.Severity,
      });
    } catch (error) {
      this.logger.error('Failed to create CloudWatch alarm', error as Error, {
        alarmName: config.AlarmName,
      });
      throw error;
    }
  }

  /**
   * Get alarm actions based on severity
   */
  private getAlarmActions(severity: AlertSeverity): string[] {
    const actions: string[] = [];

    if (this.alertTopicArn) {
      actions.push(this.alertTopicArn);
    }

    if (severity === 'CRITICAL' && this.securityTopicArn) {
      actions.push(this.securityTopicArn);
    }

    return actions;
  }

  /**
   * Get OK actions for alarm recovery
   */
  private getOkActions(severity: AlertSeverity): string[] {
    const actions: string[] = [];

    if (this.alertTopicArn && (severity === 'HIGH' || severity === 'CRITICAL')) {
      actions.push(this.alertTopicArn);
    }

    return actions;
  }

  /**
   * Process security analysis results and trigger alerts
   */
  async processSecurityAnalysis(analysis: SecurityAnalysisResult): Promise<void> {
    try {
      for (const alert of analysis.alerts) {
        await this.triggerSecurityAlert(alert, analysis.riskLevel);
      }

      // Create composite security metric
      await this.recordSecurityRiskMetric(analysis.riskLevel);

      this.logger.info('Security analysis processed', {
        alertCount: analysis.alerts.length,
        riskLevel: analysis.riskLevel,
      });
    } catch (error) {
      this.logger.error('Failed to process security analysis', error as Error);
    }
  }

  /**
   * Trigger security alert through multiple channels
   */
  private async triggerSecurityAlert(alert: SecurityAlert, riskLevel: string): Promise<void> {
    const message = {
      alertType: alert.type,
      severity: alert.severity,
      message: alert.message,
      threshold: alert.threshold,
      actualValue: alert.actualValue,
      timeWindow: alert.timeWindow,
      timestamp: alert.timestamp,
      riskLevel,
      recommendations: this.getSecurityRecommendations(alert.type),
    };

    // Send to appropriate SNS topics
    const topics = this.getSecurityAlertTopics(alert.severity);
    
    for (const topicArn of topics) {
      try {
        await this.sns.publish({
          TopicArn: topicArn,
          Subject: `Security Alert: ${alert.type}`,
          Message: JSON.stringify(message, null, 2),
          MessageAttributes: {
            severity: {
              DataType: 'String',
              StringValue: alert.severity,
            },
            alertType: {
              DataType: 'String',
              StringValue: alert.type,
            },
          },
        }).promise();

        this.logger.info('Security alert sent', {
          alertType: alert.type,
          severity: alert.severity,
          topicArn,
        });
      } catch (error) {
        this.logger.error('Failed to send security alert', error as Error, {
          alertType: alert.type,
          topicArn,
        });
      }
    }
  }

  /**
   * Get SNS topics for security alerts based on severity
   */
  private getSecurityAlertTopics(severity: string): string[] {
    const topics: string[] = [];

    if (this.alertTopicArn) {
      topics.push(this.alertTopicArn);
    }

    if ((severity === 'HIGH' || severity === 'CRITICAL') && this.securityTopicArn) {
      topics.push(this.securityTopicArn);
    }

    return topics;
  }

  /**
   * Get security recommendations based on alert type
   */
  private getSecurityRecommendations(alertType: string): string[] {
    const recommendations: Record<string, string[]> = {
      HIGH_AUTH_FAILURES: [
        'Review authentication logs for patterns',
        'Consider implementing IP-based rate limiting',
        'Check for credential stuffing attacks',
      ],
      DANGEROUS_PATTERNS_DETECTED: [
        'Implement additional input validation',
        'Consider WAF rules for detected patterns',
        'Review application security controls',
      ],
      POTENTIAL_COORDINATED_ATTACK: [
        'Implement IP-based blocking',
        'Enable DDoS protection',
        'Review rate limiting policies',
        'Consider emergency response procedures',
      ],
      HIGH_RATE_LIMIT_VIOLATIONS: [
        'Review rate limiting thresholds',
        'Analyze traffic patterns for abuse',
        'Consider implementing CAPTCHA',
      ],
    };

    return recommendations[alertType] || ['Review security logs and take appropriate action'];
  }

  /**
   * Record security risk level as CloudWatch metric
   */
  private async recordSecurityRiskMetric(riskLevel: string): Promise<void> {
    const riskValue = this.getRiskLevelValue(riskLevel);

    try {
      await this.cloudWatch.putMetricData({
        Namespace: this.namespace,
        MetricData: [{
          MetricName: 'SecurityRiskLevel',
          Value: riskValue,
          Unit: 'None',
          Dimensions: [
            { Name: 'RiskLevel', Value: riskLevel },
          ],
          Timestamp: new Date(),
        }],
      }).promise();
    } catch (error) {
      this.logger.error('Failed to record security risk metric', error as Error);
    }
  }

  /**
   * Convert risk level to numeric value for metrics
   */
  private getRiskLevelValue(riskLevel: string): number {
    const values: Record<string, number> = {
      NORMAL: 0,
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      CRITICAL: 4,
    };
    return values[riskLevel] || 0;
  }

  /**
   * Send operational alert
   */
  async sendOperationalAlert(
    title: string,
    message: string,
    severity: AlertSeverity,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (!this.alertTopicArn) {
      this.logger.warn('Alert topic not configured, skipping alert', { title, severity });
      return;
    }

    const alertMessage = {
      title,
      message,
      severity,
      timestamp: new Date().toISOString(),
      service: 'AI-Model-Gateway',
      metadata: metadata || {},
    };

    try {
      await this.sns.publish({
        TopicArn: this.alertTopicArn,
        Subject: `${severity}: ${title}`,
        Message: JSON.stringify(alertMessage, null, 2),
        MessageAttributes: {
          severity: {
            DataType: 'String',
            StringValue: severity,
          },
        },
      }).promise();

      this.logger.info('Operational alert sent', { title, severity });
    } catch (error) {
      this.logger.error('Failed to send operational alert', error as Error, { title, severity });
    }
  }

  /**
   * Test alert system
   */
  async testAlerts(): Promise<void> {
    await this.sendOperationalAlert(
      'Alert System Test',
      'This is a test alert to verify the alerting system is working correctly.',
      'LOW',
      { test: true, timestamp: new Date().toISOString() }
    );
  }
}

/**
 * Alarm configuration interface
 */
interface AlarmConfig {
  AlarmName: string;
  AlarmDescription: string;
  MetricName: string;
  Statistic: string;
  Threshold: number;
  ComparisonOperator: string;
  EvaluationPeriods: number;
  Period: number;
  Dimensions?: CloudWatch.Dimension[];
  Severity: AlertSeverity;
}

/**
 * Alert severity levels
 */
type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';