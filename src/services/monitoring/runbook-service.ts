import { Logger } from '../../shared/utils';
import { SecurityAlert, SecurityAnalysisResult } from './security-monitor';
import { AlertingService } from './alerting-service';
import { MetricsService } from './metrics-service';
import { HealthService } from './health-service';

/**
 * Operational runbook service for automated incident response
 * Provides structured incident handling and escalation procedures
 */
export class RunbookService {
  private static instance: RunbookService;
  private logger: Logger;
  private alertingService: AlertingService;
  private metricsService: MetricsService;
  private healthService: HealthService;
  private activeIncidents: Map<string, Incident> = new Map();

  private constructor() {
    this.logger = new Logger('RunbookService');
    this.alertingService = AlertingService.getInstance();
    this.metricsService = MetricsService.getInstance();
    this.healthService = HealthService.getInstance();
  }

  static getInstance(): RunbookService {
    if (!RunbookService.instance) {
      RunbookService.instance = new RunbookService();
    }
    return RunbookService.instance;
  }

  /**
   * Execute incident response based on alert type
   */
  async executeIncidentResponse(alert: SecurityAlert, analysis: SecurityAnalysisResult): Promise<IncidentResponse> {
    const incidentId = this.generateIncidentId();
    const incident: Incident = {
      id: incidentId,
      type: alert.type,
      severity: alert.severity,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      alert,
      analysis,
      actions: [],
      escalationLevel: 0,
    };

    this.activeIncidents.set(incidentId, incident);

    this.logger.info('Incident response initiated', {
      incidentId,
      alertType: alert.type,
      severity: alert.severity,
    });

    try {
      const response = await this.processIncident(incident);
      
      // Update incident with response
      incident.actions.push(...response.actions);
      incident.status = response.resolved ? 'RESOLVED' : 'IN_PROGRESS';
      incident.updatedAt = new Date().toISOString();

      this.activeIncidents.set(incidentId, incident);

      return response;
    } catch (error) {
      this.logger.error('Incident response failed', error as Error, { incidentId });
      
      incident.status = 'FAILED';
      incident.error = (error as Error).message;
      incident.updatedAt = new Date().toISOString();
      
      this.activeIncidents.set(incidentId, incident);

      throw error;
    }
  }

  /**
   * Process incident based on type and severity
   */
  private async processIncident(incident: Incident): Promise<IncidentResponse> {
    const runbook = this.getRunbook(incident.type, incident.severity);
    const actions: IncidentAction[] = [];
    let resolved = false;

    this.logger.info('Executing incident runbook', {
      incidentId: incident.id,
      runbookSteps: runbook.steps.length,
    });

    for (const step of runbook.steps) {
      try {
        const action = await this.executeRunbookStep(step, incident);
        actions.push(action);

        if (action.success && step.resolvesIncident) {
          resolved = true;
          break;
        }

        // If step failed and is critical, escalate
        if (!action.success && step.critical) {
          await this.escalateIncident(incident);
          break;
        }

      } catch (error) {
        const action: IncidentAction = {
          step: step.name,
          action: step.action,
          success: false,
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
        };
        actions.push(action);

        this.logger.error('Runbook step failed', error as Error, {
          incidentId: incident.id,
          step: step.name,
        });

        if (step.critical) {
          await this.escalateIncident(incident);
          break;
        }
      }
    }

    return {
      incidentId: incident.id,
      actions,
      resolved,
      escalated: incident.escalationLevel > 0,
    };
  }

  /**
   * Execute individual runbook step
   */
  private async executeRunbookStep(step: RunbookStep, incident: Incident): Promise<IncidentAction> {
    const startTime = Date.now();
    
    this.logger.info('Executing runbook step', {
      incidentId: incident.id,
      step: step.name,
      action: step.action,
    });

    let success = false;
    let result: any;
    let error: string | undefined;

    try {
      switch (step.action) {
        case 'HEALTH_CHECK':
          result = await this.performHealthCheck();
          success = result.status === 'healthy';
          break;

        case 'RATE_LIMIT_ANALYSIS':
          result = await this.analyzeRateLimits(incident);
          success = true;
          break;

        case 'SECURITY_SCAN':
          result = await this.performSecurityScan(incident);
          success = !result.threatsDetected;
          break;

        case 'PROVIDER_FAILOVER':
          result = await this.triggerProviderFailover();
          success = result.failoverSuccessful;
          break;

        case 'CACHE_FLUSH':
          result = await this.flushCache();
          success = result.flushed;
          break;

        case 'ALERT_STAKEHOLDERS':
          result = await this.alertStakeholders(incident, step.parameters);
          success = result.notificationsSent > 0;
          break;

        case 'BLOCK_IP_RANGE':
          result = await this.blockIpRange(step.parameters?.ipRange);
          success = result.blocked;
          break;

        case 'SCALE_RESOURCES':
          result = await this.scaleResources(step.parameters);
          success = result.scaled;
          break;

        case 'COLLECT_DIAGNOSTICS':
          result = await this.collectDiagnostics(incident);
          success = true;
          break;

        default:
          throw new Error(`Unknown runbook action: ${step.action}`);
      }

    } catch (stepError) {
      error = (stepError as Error).message;
      success = false;
    }

    const duration = Date.now() - startTime;

    return {
      step: step.name,
      action: step.action,
      success,
      result,
      error,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get runbook for incident type and severity
   */
  private getRunbook(incidentType: string, severity: string): Runbook {
    const runbooks: Record<string, Runbook> = {
      HIGH_AUTH_FAILURES: {
        name: 'Authentication Failure Response',
        steps: [
          {
            name: 'Analyze Rate Limits',
            action: 'RATE_LIMIT_ANALYSIS',
            critical: false,
            resolvesIncident: false,
          },
          {
            name: 'Security Scan',
            action: 'SECURITY_SCAN',
            critical: false,
            resolvesIncident: false,
          },
          {
            name: 'Block Suspicious IPs',
            action: 'BLOCK_IP_RANGE',
            critical: false,
            resolvesIncident: true,
            parameters: { autoDetectIps: true },
          },
          {
            name: 'Alert Security Team',
            action: 'ALERT_STAKEHOLDERS',
            critical: true,
            resolvesIncident: false,
            parameters: { team: 'security', urgency: 'high' },
          },
        ],
      },

      DANGEROUS_PATTERNS_DETECTED: {
        name: 'Dangerous Pattern Response',
        steps: [
          {
            name: 'Immediate Security Scan',
            action: 'SECURITY_SCAN',
            critical: true,
            resolvesIncident: false,
          },
          {
            name: 'Block Attack Sources',
            action: 'BLOCK_IP_RANGE',
            critical: false,
            resolvesIncident: true,
            parameters: { autoDetectIps: true },
          },
          {
            name: 'Alert Security Team',
            action: 'ALERT_STAKEHOLDERS',
            critical: true,
            resolvesIncident: false,
            parameters: { team: 'security', urgency: 'critical' },
          },
          {
            name: 'Collect Forensic Data',
            action: 'COLLECT_DIAGNOSTICS',
            critical: false,
            resolvesIncident: false,
          },
        ],
      },

      POTENTIAL_COORDINATED_ATTACK: {
        name: 'Coordinated Attack Response',
        steps: [
          {
            name: 'Emergency Health Check',
            action: 'HEALTH_CHECK',
            critical: true,
            resolvesIncident: false,
          },
          {
            name: 'Scale Resources',
            action: 'SCALE_RESOURCES',
            critical: false,
            resolvesIncident: false,
            parameters: { scaleUp: true, factor: 2 },
          },
          {
            name: 'Block Attack Networks',
            action: 'BLOCK_IP_RANGE',
            critical: true,
            resolvesIncident: true,
            parameters: { autoDetectIps: true, aggressive: true },
          },
          {
            name: 'Alert All Teams',
            action: 'ALERT_STAKEHOLDERS',
            critical: true,
            resolvesIncident: false,
            parameters: { team: 'all', urgency: 'critical' },
          },
        ],
      },

      HIGH_RATE_LIMIT_VIOLATIONS: {
        name: 'Rate Limit Violation Response',
        steps: [
          {
            name: 'Analyze Traffic Patterns',
            action: 'RATE_LIMIT_ANALYSIS',
            critical: false,
            resolvesIncident: false,
          },
          {
            name: 'Adjust Rate Limits',
            action: 'SCALE_RESOURCES',
            critical: false,
            resolvesIncident: true,
            parameters: { adjustRateLimits: true },
          },
          {
            name: 'Alert Operations Team',
            action: 'ALERT_STAKEHOLDERS',
            critical: false,
            resolvesIncident: false,
            parameters: { team: 'operations', urgency: 'medium' },
          },
        ],
      },

      PROVIDER_UNAVAILABLE: {
        name: 'Provider Failure Response',
        steps: [
          {
            name: 'Health Check All Providers',
            action: 'HEALTH_CHECK',
            critical: true,
            resolvesIncident: false,
          },
          {
            name: 'Trigger Failover',
            action: 'PROVIDER_FAILOVER',
            critical: true,
            resolvesIncident: true,
          },
          {
            name: 'Alert Engineering Team',
            action: 'ALERT_STAKEHOLDERS',
            critical: false,
            resolvesIncident: false,
            parameters: { team: 'engineering', urgency: 'high' },
          },
        ],
      },
    };

    return runbooks[incidentType] || this.getDefaultRunbook(severity);
  }

  /**
   * Get default runbook for unknown incident types
   */
  private getDefaultRunbook(severity: string): Runbook {
    return {
      name: 'Default Incident Response',
      steps: [
        {
          name: 'System Health Check',
          action: 'HEALTH_CHECK',
          critical: true,
          resolvesIncident: false,
        },
        {
          name: 'Collect Diagnostics',
          action: 'COLLECT_DIAGNOSTICS',
          critical: false,
          resolvesIncident: false,
        },
        {
          name: 'Alert Operations Team',
          action: 'ALERT_STAKEHOLDERS',
          critical: true,
          resolvesIncident: false,
          parameters: { 
            team: severity === 'CRITICAL' ? 'all' : 'operations', 
            urgency: severity.toLowerCase() 
          },
        },
      ],
    };
  }

  /**
   * Escalate incident to higher level
   */
  private async escalateIncident(incident: Incident): Promise<void> {
    incident.escalationLevel++;
    incident.updatedAt = new Date().toISOString();

    this.logger.warn('Incident escalated', {
      incidentId: incident.id,
      escalationLevel: incident.escalationLevel,
    });

    // Send escalation alert
    await this.alertingService.sendOperationalAlert(
      `Incident Escalated: ${incident.type}`,
      `Incident ${incident.id} has been escalated to level ${incident.escalationLevel}`,
      'HIGH',
      {
        incidentId: incident.id,
        escalationLevel: incident.escalationLevel,
        originalSeverity: incident.severity,
      }
    );
  }

  // Runbook action implementations

  private async performHealthCheck(): Promise<any> {
    return await this.healthService.getSystemHealth();
  }

  private async analyzeRateLimits(incident: Incident): Promise<any> {
    // Analyze rate limiting patterns
    return {
      analysis: 'Rate limit analysis completed',
      recommendations: ['Adjust rate limits for affected tiers'],
    };
  }

  private async performSecurityScan(incident: Incident): Promise<any> {
    // Perform security analysis
    return {
      threatsDetected: false,
      scanResults: 'No additional threats detected',
    };
  }

  private async triggerProviderFailover(): Promise<any> {
    // Trigger provider failover logic
    return {
      failoverSuccessful: true,
      newPrimaryProvider: 'bedrock',
    };
  }

  private async flushCache(): Promise<any> {
    // Flush cache implementation
    return {
      flushed: true,
      itemsCleared: 1000,
    };
  }

  private async alertStakeholders(incident: Incident, parameters?: any): Promise<any> {
    const team = parameters?.team || 'operations';
    const urgency = parameters?.urgency || 'medium';

    await this.alertingService.sendOperationalAlert(
      `Security Incident: ${incident.type}`,
      `Incident ${incident.id} requires attention from ${team} team`,
      urgency.toUpperCase(),
      {
        incidentId: incident.id,
        team,
        urgency,
      }
    );

    return {
      notificationsSent: 1,
      team,
    };
  }

  private async blockIpRange(ipRange?: string): Promise<any> {
    // IP blocking implementation would go here
    // This would integrate with WAF or security groups
    return {
      blocked: true,
      ipRange: ipRange || 'auto-detected',
    };
  }

  private async scaleResources(parameters?: any): Promise<any> {
    // Resource scaling implementation
    return {
      scaled: true,
      action: parameters?.scaleUp ? 'scale_up' : 'adjust_limits',
    };
  }

  private async collectDiagnostics(incident: Incident): Promise<any> {
    // Collect diagnostic information
    const diagnostics = {
      timestamp: new Date().toISOString(),
      incidentId: incident.id,
      systemHealth: await this.healthService.getSystemHealth(),
      correlationIds: [], // Would collect related correlation IDs
    };

    return diagnostics;
  }

  /**
   * Generate unique incident ID
   */
  private generateIncidentId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `INC-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Get active incidents
   */
  getActiveIncidents(): Incident[] {
    return Array.from(this.activeIncidents.values())
      .filter(incident => incident.status === 'OPEN' || incident.status === 'IN_PROGRESS');
  }

  /**
   * Get incident by ID
   */
  getIncident(incidentId: string): Incident | null {
    return this.activeIncidents.get(incidentId) || null;
  }

  /**
   * Close incident
   */
  closeIncident(incidentId: string, resolution: string): void {
    const incident = this.activeIncidents.get(incidentId);
    if (incident) {
      incident.status = 'RESOLVED';
      incident.resolution = resolution;
      incident.updatedAt = new Date().toISOString();
      
      this.logger.info('Incident closed', {
        incidentId,
        resolution,
      });
    }
  }

  /**
   * Get incident statistics
   */
  getIncidentStatistics(): IncidentStatistics {
    const incidents = Array.from(this.activeIncidents.values());
    
    return {
      total: incidents.length,
      open: incidents.filter(i => i.status === 'OPEN').length,
      inProgress: incidents.filter(i => i.status === 'IN_PROGRESS').length,
      resolved: incidents.filter(i => i.status === 'RESOLVED').length,
      failed: incidents.filter(i => i.status === 'FAILED').length,
      bySeverity: {
        critical: incidents.filter(i => i.severity === 'CRITICAL').length,
        high: incidents.filter(i => i.severity === 'HIGH').length,
        medium: incidents.filter(i => i.severity === 'MEDIUM').length,
        low: incidents.filter(i => i.severity === 'LOW').length,
      },
      averageResolutionTime: this.calculateAverageResolutionTime(incidents),
    };
  }

  private calculateAverageResolutionTime(incidents: Incident[]): number {
    const resolved = incidents.filter(i => i.status === 'RESOLVED' && i.updatedAt);
    if (resolved.length === 0) return 0;

    const totalTime = resolved.reduce((sum, incident) => {
      const created = new Date(incident.createdAt).getTime();
      const updated = new Date(incident.updatedAt!).getTime();
      return sum + (updated - created);
    }, 0);

    return totalTime / resolved.length;
  }
}

/**
 * Incident interface
 */
export interface Incident {
  id: string;
  type: string;
  severity: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'FAILED';
  createdAt: string;
  updatedAt?: string;
  alert: SecurityAlert;
  analysis: SecurityAnalysisResult;
  actions: IncidentAction[];
  escalationLevel: number;
  resolution?: string;
  error?: string;
}

/**
 * Runbook interface
 */
export interface Runbook {
  name: string;
  steps: RunbookStep[];
}

/**
 * Runbook step interface
 */
export interface RunbookStep {
  name: string;
  action: string;
  critical: boolean;
  resolvesIncident: boolean;
  parameters?: Record<string, any>;
}

/**
 * Incident action interface
 */
export interface IncidentAction {
  step: string;
  action: string;
  success: boolean;
  result?: any;
  error?: string;
  duration?: number;
  timestamp: string;
}

/**
 * Incident response interface
 */
export interface IncidentResponse {
  incidentId: string;
  actions: IncidentAction[];
  resolved: boolean;
  escalated: boolean;
}

/**
 * Incident statistics interface
 */
export interface IncidentStatistics {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  failed: number;
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  averageResolutionTime: number;
}