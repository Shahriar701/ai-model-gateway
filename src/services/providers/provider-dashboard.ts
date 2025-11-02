import { ProviderMonitor, ProviderStats, CostOptimizationRecommendation } from './provider-monitor';
import { ProviderHealthService, ProviderHealthReport } from './provider-health';
import { Logger } from '../../shared/utils/logger';

const logger = new Logger('ProviderDashboard');

/**
 * Provider performance dashboard service
 * Provides comprehensive monitoring and analytics for all providers
 */
export class ProviderDashboard {
  constructor(
    private monitor: ProviderMonitor,
    private healthService: ProviderHealthService
  ) {}

  /**
   * Get comprehensive dashboard data
   */
  getDashboardData(): ProviderDashboardData {
    const stats = this.monitor.getAllProviderStats();
    const healthReport = this.healthService.getHealthReport();
    
    return {
      timestamp: new Date(),
      summary: this.calculateSummaryMetrics(stats),
      providers: this.combineProviderData(stats, healthReport),
      healthOverview: healthReport,
      alerts: this.generateAlerts(stats, healthReport),
      trends: this.calculateTrends(stats),
    };
  }

  /**
   * Get performance metrics for a specific time period
   */
  getPerformanceMetrics(
    providerName?: string,
    timeRange: TimeRange = TimeRange.LAST_HOUR
  ): PerformanceMetrics {
    const stats = providerName 
      ? [this.monitor.getProviderStats(providerName)].filter(Boolean) as ProviderStats[]
      : this.monitor.getAllProviderStats();

    return {
      timeRange,
      providers: stats.map(stat => ({
        name: stat.provider,
        metrics: {
          requestCount: stat.totalRequests,
          successRate: stat.successRate,
          avgLatency: stat.avgLatency,
          p95Latency: stat.p95Latency,
          p99Latency: stat.p99Latency,
          totalCost: stat.totalCost,
          avgCost: stat.avgCost,
          errorRate: ((stat.failedRequests / stat.totalRequests) * 100) || 0,
          throughput: this.calculateThroughput(stat),
        },
      })),
      aggregated: this.calculateAggregatedMetrics(stats),
    };
  }

  /**
   * Get cost analysis report
   */
  getCostAnalysis(): CostAnalysisReport {
    const stats = this.monitor.getAllProviderStats();
    
    const providerCosts = stats.map(stat => ({
      provider: stat.provider,
      totalCost: stat.totalCost,
      avgCostPerRequest: stat.avgCost,
      totalRequests: stat.totalRequests,
      costPerToken: stat.totalTokens > 0 ? stat.totalCost / stat.totalTokens : 0,
    }));

    // Sort by total cost
    providerCosts.sort((a, b) => b.totalCost - a.totalCost);

    const totalCost = providerCosts.reduce((sum, p) => sum + p.totalCost, 0);
    const totalRequests = providerCosts.reduce((sum, p) => sum + p.totalRequests, 0);

    return {
      timestamp: new Date(),
      totalCost,
      totalRequests,
      avgCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
      providerBreakdown: providerCosts,
      costTrends: this.calculateCostTrends(stats),
      recommendations: [], // Will be populated by cost optimizer
    };
  }

  /**
   * Get reliability report
   */
  getReliabilityReport(): ReliabilityReport {
    const stats = this.monitor.getAllProviderStats();
    const healthReport = this.healthService.getHealthReport();

    const providerReliability = stats.map(stat => {
      const health = healthReport.providers.find(p => p.name === stat.provider);
      
      return {
        provider: stat.provider,
        successRate: stat.successRate,
        errorRate: ((stat.failedRequests / stat.totalRequests) * 100) || 0,
        availability: health?.available || false,
        mttr: this.calculateMTTR(stat), // Mean Time To Recovery
        mtbf: this.calculateMTBF(stat), // Mean Time Between Failures
        errorsByType: stat.errorsByType,
        circuitBreakerTrips: 0, // Would need to track this separately
      };
    });

    return {
      timestamp: new Date(),
      overallAvailability: this.calculateOverallAvailability(providerReliability),
      providers: providerReliability,
      incidents: [], // Would need incident tracking
      slaCompliance: this.calculateSLACompliance(providerReliability),
    };
  }

  /**
   * Generate performance alerts
   */
  generateAlerts(
    stats: ProviderStats[],
    healthReport: ProviderHealthReport
  ): PerformanceAlert[] {
    const alerts: PerformanceAlert[] = [];

    // Check for high error rates
    stats.forEach(stat => {
      const errorRate = (stat.failedRequests / stat.totalRequests) * 100;
      if (errorRate > 5) { // More than 5% error rate
        alerts.push({
          type: AlertType.HIGH_ERROR_RATE,
          severity: errorRate > 15 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
          provider: stat.provider,
          message: `High error rate detected: ${errorRate.toFixed(1)}%`,
          value: errorRate,
          threshold: 5,
          timestamp: new Date(),
        });
      }
    });

    // Check for high latency
    stats.forEach(stat => {
      if (stat.p95Latency > 5000) { // More than 5 seconds P95 latency
        alerts.push({
          type: AlertType.HIGH_LATENCY,
          severity: stat.p95Latency > 10000 ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
          provider: stat.provider,
          message: `High P95 latency detected: ${stat.p95Latency}ms`,
          value: stat.p95Latency,
          threshold: 5000,
          timestamp: new Date(),
        });
      }
    });

    // Check for unhealthy providers
    healthReport.providers.forEach(provider => {
      if (!provider.healthy) {
        alerts.push({
          type: AlertType.PROVIDER_UNHEALTHY,
          severity: AlertSeverity.CRITICAL,
          provider: provider.name,
          message: `Provider is unhealthy`,
          value: 0,
          threshold: 1,
          timestamp: new Date(),
        });
      }
    });

    return alerts;
  }

  private calculateSummaryMetrics(stats: ProviderStats[]): DashboardSummary {
    const totalRequests = stats.reduce((sum, s) => sum + s.totalRequests, 0);
    const totalSuccessful = stats.reduce((sum, s) => sum + s.successfulRequests, 0);
    const totalCost = stats.reduce((sum, s) => sum + s.totalCost, 0);
    const totalLatency = stats.reduce((sum, s) => sum + (s.avgLatency * s.successfulRequests), 0);

    return {
      totalProviders: stats.length,
      totalRequests,
      overallSuccessRate: totalRequests > 0 ? (totalSuccessful / totalRequests) * 100 : 0,
      totalCost,
      avgLatency: totalSuccessful > 0 ? totalLatency / totalSuccessful : 0,
      activeProviders: stats.filter(s => s.lastRequestTime > new Date(Date.now() - 3600000)).length,
    };
  }

  private combineProviderData(
    stats: ProviderStats[],
    healthReport: ProviderHealthReport
  ): ProviderDashboardEntry[] {
    return stats.map(stat => {
      const health = healthReport.providers.find(p => p.name === stat.provider);
      
      return {
        name: stat.provider,
        status: health?.available ? 'available' : 'unavailable',
        health: health?.healthy || false,
        stats: stat,
        healthDetails: health,
      };
    });
  }

  private calculateTrends(stats: ProviderStats[]): TrendData {
    // This is a simplified implementation
    // In a real system, you'd track historical data
    return {
      requestVolume: 'stable',
      successRate: 'stable',
      latency: 'stable',
      cost: 'stable',
    };
  }

  private calculateThroughput(stat: ProviderStats): number {
    // Calculate requests per minute based on last request time
    // This is simplified - in reality you'd need time-series data
    const timeSinceLastRequest = Date.now() - stat.lastRequestTime.getTime();
    const hoursAgo = timeSinceLastRequest / (1000 * 60 * 60);
    
    return hoursAgo > 0 ? stat.totalRequests / (hoursAgo * 60) : 0;
  }

  private calculateAggregatedMetrics(stats: ProviderStats[]): AggregatedMetrics {
    const totalRequests = stats.reduce((sum, s) => sum + s.totalRequests, 0);
    const totalSuccessful = stats.reduce((sum, s) => sum + s.successfulRequests, 0);
    const totalCost = stats.reduce((sum, s) => sum + s.totalCost, 0);
    const weightedLatency = stats.reduce((sum, s) => sum + (s.avgLatency * s.successfulRequests), 0);

    return {
      totalRequests,
      successRate: totalRequests > 0 ? (totalSuccessful / totalRequests) * 100 : 0,
      avgLatency: totalSuccessful > 0 ? weightedLatency / totalSuccessful : 0,
      totalCost,
      avgCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
    };
  }

  private calculateCostTrends(stats: ProviderStats[]): CostTrend[] {
    // Simplified implementation - would need historical data
    return stats.map(stat => ({
      provider: stat.provider,
      trend: 'stable' as const,
      change: 0,
      period: '24h',
    }));
  }

  private calculateMTTR(stat: ProviderStats): number {
    // Mean Time To Recovery - simplified calculation
    // Would need incident tracking for accurate MTTR
    return 0;
  }

  private calculateMTBF(stat: ProviderStats): number {
    // Mean Time Between Failures - simplified calculation
    if (stat.failedRequests === 0) return Infinity;
    return stat.totalRequests / stat.failedRequests;
  }

  private calculateOverallAvailability(reliability: ProviderReliability[]): number {
    if (reliability.length === 0) return 0;
    
    const totalAvailability = reliability.reduce((sum, r) => sum + r.successRate, 0);
    return totalAvailability / reliability.length;
  }

  private calculateSLACompliance(reliability: ProviderReliability[]): SLACompliance {
    // Assuming SLA targets
    const slaTargets = {
      availability: 99.9,
      successRate: 99.5,
      maxLatency: 2000,
    };

    const compliantProviders = reliability.filter(r => 
      r.successRate >= slaTargets.successRate
    ).length;

    return {
      overall: (compliantProviders / reliability.length) * 100,
      targets: slaTargets,
      compliance: reliability.map(r => ({
        provider: r.provider,
        compliant: r.successRate >= slaTargets.successRate,
        metrics: {
          successRate: r.successRate,
          availability: r.availability ? 100 : 0,
        },
      })),
    };
  }
}

// Types and interfaces
export enum TimeRange {
  LAST_HOUR = 'LAST_HOUR',
  LAST_24H = 'LAST_24H',
  LAST_7D = 'LAST_7D',
  LAST_30D = 'LAST_30D',
}

export enum AlertType {
  HIGH_ERROR_RATE = 'HIGH_ERROR_RATE',
  HIGH_LATENCY = 'HIGH_LATENCY',
  HIGH_COST = 'HIGH_COST',
  PROVIDER_UNHEALTHY = 'PROVIDER_UNHEALTHY',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
}

export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}

export interface ProviderDashboardData {
  timestamp: Date;
  summary: DashboardSummary;
  providers: ProviderDashboardEntry[];
  healthOverview: ProviderHealthReport;
  alerts: PerformanceAlert[];
  trends: TrendData;
}

export interface DashboardSummary {
  totalProviders: number;
  totalRequests: number;
  overallSuccessRate: number;
  totalCost: number;
  avgLatency: number;
  activeProviders: number;
}

export interface ProviderDashboardEntry {
  name: string;
  status: 'available' | 'unavailable' | 'degraded';
  health: boolean;
  stats: ProviderStats;
  healthDetails?: any;
}

export interface TrendData {
  requestVolume: 'increasing' | 'decreasing' | 'stable';
  successRate: 'improving' | 'degrading' | 'stable';
  latency: 'improving' | 'degrading' | 'stable';
  cost: 'increasing' | 'decreasing' | 'stable';
}

export interface PerformanceMetrics {
  timeRange: TimeRange;
  providers: ProviderMetricsEntry[];
  aggregated: AggregatedMetrics;
}

export interface ProviderMetricsEntry {
  name: string;
  metrics: {
    requestCount: number;
    successRate: number;
    avgLatency: number;
    p95Latency: number;
    p99Latency: number;
    totalCost: number;
    avgCost: number;
    errorRate: number;
    throughput: number;
  };
}

export interface AggregatedMetrics {
  totalRequests: number;
  successRate: number;
  avgLatency: number;
  totalCost: number;
  avgCostPerRequest: number;
}

export interface CostAnalysisReport {
  timestamp: Date;
  totalCost: number;
  totalRequests: number;
  avgCostPerRequest: number;
  providerBreakdown: ProviderCostBreakdown[];
  costTrends: CostTrend[];
  recommendations: CostOptimizationRecommendation[];
}

export interface ProviderCostBreakdown {
  provider: string;
  totalCost: number;
  avgCostPerRequest: number;
  totalRequests: number;
  costPerToken: number;
}

export interface CostTrend {
  provider: string;
  trend: 'increasing' | 'decreasing' | 'stable';
  change: number;
  period: string;
}

export interface ReliabilityReport {
  timestamp: Date;
  overallAvailability: number;
  providers: ProviderReliability[];
  incidents: Incident[];
  slaCompliance: SLACompliance;
}

export interface ProviderReliability {
  provider: string;
  successRate: number;
  errorRate: number;
  availability: boolean;
  mttr: number;
  mtbf: number;
  errorsByType: Record<string, number>;
  circuitBreakerTrips: number;
}

export interface Incident {
  id: string;
  provider: string;
  type: string;
  severity: AlertSeverity;
  startTime: Date;
  endTime?: Date;
  description: string;
  resolved: boolean;
}

export interface SLACompliance {
  overall: number;
  targets: {
    availability: number;
    successRate: number;
    maxLatency: number;
  };
  compliance: ProviderSLACompliance[];
}

export interface ProviderSLACompliance {
  provider: string;
  compliant: boolean;
  metrics: {
    successRate: number;
    availability: number;
  };
}

export interface PerformanceAlert {
  type: AlertType;
  severity: AlertSeverity;
  provider: string;
  message: string;
  value: number;
  threshold: number;
  timestamp: Date;
}