import { SecurityLogger, SecurityMetrics } from '../../shared/utils/security-logger';
import { Logger } from '../../shared/utils';

/**
 * Security monitoring service for real-time threat detection and alerting
 */
export class SecurityMonitor {
  private static instance: SecurityMonitor;
  private logger: Logger;
  private securityLogger: SecurityLogger;
  
  // Thresholds for triggering alerts
  private static readonly ALERT_THRESHOLDS = {
    authFailuresPerMinute: 10,
    rateLimitExceededPerMinute: 50,
    dangerousPatternsPerMinute: 5,
    oversizedRequestsPerMinute: 20,
    invalidHeadersPerMinute: 15,
  };

  // Time windows for analysis
  private static readonly TIME_WINDOWS = {
    realTime: 60000,      // 1 minute
    shortTerm: 300000,    // 5 minutes
    mediumTerm: 1800000,  // 30 minutes
    longTerm: 3600000,    // 1 hour
  };

  private constructor() {
    this.logger = new Logger('SecurityMonitor');
    this.securityLogger = SecurityLogger.getInstance();
  }

  static getInstance(): SecurityMonitor {
    if (!SecurityMonitor.instance) {
      SecurityMonitor.instance = new SecurityMonitor();
    }
    return SecurityMonitor.instance;
  }

  /**
   * Analyze security metrics and trigger alerts if necessary
   */
  async analyzeSecurityMetrics(): Promise<SecurityAnalysisResult> {
    try {
      const realTimeMetrics = this.securityLogger.generateSecurityMetrics(
        SecurityMonitor.TIME_WINDOWS.realTime
      );
      
      const shortTermMetrics = this.securityLogger.generateSecurityMetrics(
        SecurityMonitor.TIME_WINDOWS.shortTerm
      );

      const alerts = this.checkForAlerts(realTimeMetrics, shortTermMetrics);
      
      const analysis: SecurityAnalysisResult = {
        timestamp: new Date().toISOString(),
        realTimeMetrics,
        shortTermMetrics,
        alerts,
        riskLevel: this.calculateRiskLevel(realTimeMetrics, alerts),
        recommendations: this.generateRecommendations(realTimeMetrics, alerts),
      };

      // Log analysis results
      this.logger.info('Security analysis completed', {
        riskLevel: analysis.riskLevel,
        alertCount: alerts.length,
        authFailures: realTimeMetrics.events.authenticationFailures,
        dangerousPatterns: realTimeMetrics.events.dangerousPatterns,
      });

      // Trigger alerts if necessary
      if (alerts.length > 0) {
        await this.processAlerts(alerts);
      }

      return analysis;
    } catch (error) {
      this.logger.error('Security analysis failed', error as Error);
      throw error;
    }
  }

  /**
   * Check for security alerts based on metrics
   */
  private checkForAlerts(
    realTimeMetrics: SecurityMetrics,
    shortTermMetrics: SecurityMetrics
  ): SecurityAlert[] {
    const alerts: SecurityAlert[] = [];

    // Check authentication failures
    if (realTimeMetrics.events.authenticationFailures > SecurityMonitor.ALERT_THRESHOLDS.authFailuresPerMinute) {
      alerts.push({
        type: 'HIGH_AUTH_FAILURES',
        severity: 'HIGH',
        message: `High number of authentication failures: ${realTimeMetrics.events.authenticationFailures} in the last minute`,
        threshold: SecurityMonitor.ALERT_THRESHOLDS.authFailuresPerMinute,
        actualValue: realTimeMetrics.events.authenticationFailures,
        timeWindow: 'realTime',
        timestamp: new Date().toISOString(),
      });
    }

    // Check dangerous patterns
    if (realTimeMetrics.events.dangerousPatterns > SecurityMonitor.ALERT_THRESHOLDS.dangerousPatternsPerMinute) {
      alerts.push({
        type: 'DANGEROUS_PATTERNS_DETECTED',
        severity: 'CRITICAL',
        message: `Dangerous patterns detected: ${realTimeMetrics.events.dangerousPatterns} in the last minute`,
        threshold: SecurityMonitor.ALERT_THRESHOLDS.dangerousPatternsPerMinute,
        actualValue: realTimeMetrics.events.dangerousPatterns,
        timeWindow: 'realTime',
        timestamp: new Date().toISOString(),
      });
    }

    // Check rate limit exceeded events
    if (realTimeMetrics.events.rateLimitExceeded > SecurityMonitor.ALERT_THRESHOLDS.rateLimitExceededPerMinute) {
      alerts.push({
        type: 'HIGH_RATE_LIMIT_VIOLATIONS',
        severity: 'MEDIUM',
        message: `High number of rate limit violations: ${realTimeMetrics.events.rateLimitExceeded} in the last minute`,
        threshold: SecurityMonitor.ALERT_THRESHOLDS.rateLimitExceededPerMinute,
        actualValue: realTimeMetrics.events.rateLimitExceeded,
        timeWindow: 'realTime',
        timestamp: new Date().toISOString(),
      });
    }

    // Check oversized requests
    if (realTimeMetrics.events.oversizedRequests > SecurityMonitor.ALERT_THRESHOLDS.oversizedRequestsPerMinute) {
      alerts.push({
        type: 'OVERSIZED_REQUESTS',
        severity: 'MEDIUM',
        message: `High number of oversized requests: ${realTimeMetrics.events.oversizedRequests} in the last minute`,
        threshold: SecurityMonitor.ALERT_THRESHOLDS.oversizedRequestsPerMinute,
        actualValue: realTimeMetrics.events.oversizedRequests,
        timeWindow: 'realTime',
        timestamp: new Date().toISOString(),
      });
    }

    // Check for coordinated attacks (multiple IPs with similar patterns)
    if (realTimeMetrics.topSourceIps.length > 5 && 
        realTimeMetrics.events.authenticationFailures > 20) {
      alerts.push({
        type: 'POTENTIAL_COORDINATED_ATTACK',
        severity: 'CRITICAL',
        message: `Potential coordinated attack detected: ${realTimeMetrics.topSourceIps.length} IPs with ${realTimeMetrics.events.authenticationFailures} auth failures`,
        threshold: 5,
        actualValue: realTimeMetrics.topSourceIps.length,
        timeWindow: 'realTime',
        timestamp: new Date().toISOString(),
      });
    }

    return alerts;
  }

  /**
   * Calculate overall risk level
   */
  private calculateRiskLevel(metrics: SecurityMetrics, alerts: SecurityAlert[]): RiskLevel {
    const criticalAlerts = alerts.filter(a => a.severity === 'CRITICAL').length;
    const highAlerts = alerts.filter(a => a.severity === 'HIGH').length;
    const mediumAlerts = alerts.filter(a => a.severity === 'MEDIUM').length;

    if (criticalAlerts > 0) {
      return 'CRITICAL';
    }
    
    if (highAlerts > 2 || (highAlerts > 0 && mediumAlerts > 3)) {
      return 'HIGH';
    }
    
    if (highAlerts > 0 || mediumAlerts > 2) {
      return 'MEDIUM';
    }
    
    if (mediumAlerts > 0 || alerts.length > 0) {
      return 'LOW';
    }
    
    return 'NORMAL';
  }

  /**
   * Generate security recommendations
   */
  private generateRecommendations(
    metrics: SecurityMetrics,
    alerts: SecurityAlert[]
  ): string[] {
    const recommendations: string[] = [];

    if (alerts.some(a => a.type === 'HIGH_AUTH_FAILURES')) {
      recommendations.push('Consider implementing IP-based rate limiting for authentication attempts');
      recommendations.push('Review and potentially strengthen API key validation');
    }

    if (alerts.some(a => a.type === 'DANGEROUS_PATTERNS_DETECTED')) {
      recommendations.push('Implement additional input validation and sanitization');
      recommendations.push('Consider implementing Web Application Firewall (WAF) rules');
    }

    if (alerts.some(a => a.type === 'POTENTIAL_COORDINATED_ATTACK')) {
      recommendations.push('Implement IP-based blocking for suspicious sources');
      recommendations.push('Consider enabling DDoS protection');
      recommendations.push('Review and update rate limiting policies');
    }

    if (metrics.events.oversizedRequests > 10) {
      recommendations.push('Review request size limits and implement stricter validation');
    }

    if (recommendations.length === 0) {
      recommendations.push('Security posture appears normal - continue monitoring');
    }

    return recommendations;
  }

  /**
   * Process and escalate security alerts
   */
  private async processAlerts(alerts: SecurityAlert[]): Promise<void> {
    for (const alert of alerts) {
      this.logger.warn('Security alert triggered', {
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        threshold: alert.threshold,
        actualValue: alert.actualValue,
      });

      // In production, implement:
      // - Send to PagerDuty/OpsGenie for critical alerts
      // - Create CloudWatch alarms
      // - Send Slack notifications
      // - Update security dashboard
      // - Trigger automated responses (e.g., IP blocking)

      if (alert.severity === 'CRITICAL') {
        await this.triggerCriticalAlert(alert);
      }
    }
  }

  /**
   * Trigger critical alert response
   */
  private async triggerCriticalAlert(alert: SecurityAlert): Promise<void> {
    this.logger.error('CRITICAL SECURITY ALERT', undefined, {
      type: alert.type,
      message: alert.message,
      timestamp: alert.timestamp,
    });

    // In production, implement:
    // - Immediate notification to security team
    // - Automated incident creation
    // - Potential automated blocking/mitigation
  }

  /**
   * Generate security dashboard data
   */
  generateDashboardData(): SecurityDashboardData {
    const realTimeMetrics = this.securityLogger.generateSecurityMetrics(
      SecurityMonitor.TIME_WINDOWS.realTime
    );
    
    const hourlyMetrics = this.securityLogger.generateSecurityMetrics(
      SecurityMonitor.TIME_WINDOWS.longTerm
    );

    return {
      timestamp: new Date().toISOString(),
      realTimeMetrics,
      hourlyMetrics,
      alertThresholds: SecurityMonitor.ALERT_THRESHOLDS,
      systemStatus: this.getSystemStatus(realTimeMetrics),
    };
  }

  /**
   * Get overall system security status
   */
  private getSystemStatus(metrics: SecurityMetrics): SystemStatus {
    const totalEvents = Object.values(metrics.events).reduce((sum, count) => sum + count, 0);
    
    if (totalEvents === 0) {
      return 'HEALTHY';
    }
    
    if (metrics.events.dangerousPatterns > 0 || metrics.events.authenticationFailures > 20) {
      return 'UNDER_ATTACK';
    }
    
    if (totalEvents > 50) {
      return 'ELEVATED_ACTIVITY';
    }
    
    return 'NORMAL_ACTIVITY';
  }
}

/**
 * Security analysis result
 */
export interface SecurityAnalysisResult {
  timestamp: string;
  realTimeMetrics: SecurityMetrics;
  shortTermMetrics: SecurityMetrics;
  alerts: SecurityAlert[];
  riskLevel: RiskLevel;
  recommendations: string[];
}

/**
 * Security alert
 */
export interface SecurityAlert {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  threshold: number;
  actualValue: number;
  timeWindow: string;
  timestamp: string;
}

/**
 * Risk levels
 */
export type RiskLevel = 'NORMAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * System status
 */
export type SystemStatus = 'HEALTHY' | 'NORMAL_ACTIVITY' | 'ELEVATED_ACTIVITY' | 'UNDER_ATTACK';

/**
 * Security dashboard data
 */
export interface SecurityDashboardData {
  timestamp: string;
  realTimeMetrics: SecurityMetrics;
  hourlyMetrics: SecurityMetrics;
  alertThresholds: Record<string, number>;
  systemStatus: SystemStatus;
}