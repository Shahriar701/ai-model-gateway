import { ConfigurationManager } from './configuration-manager';
import { Logger } from '../../shared/utils';
import { SecurityLogger } from '../../shared/utils/security-logger';

/**
 * Configuration rollback service for safe configuration changes
 * Provides rollback capabilities and change history tracking
 */
export class RollbackService {
  private static instance: RollbackService;
  private configManager: ConfigurationManager;
  private logger: Logger;
  private securityLogger: SecurityLogger;
  private changeHistory: Map<string, ConfigChange[]> = new Map();

  // History settings
  private static readonly MAX_HISTORY_PER_KEY = 10;
  private static readonly HISTORY_RETENTION_DAYS = 30;

  private constructor() {
    this.logger = new Logger('RollbackService');
    this.securityLogger = SecurityLogger.getInstance();
    this.configManager = ConfigurationManager.getInstance();
  }

  static getInstance(): RollbackService {
    if (!RollbackService.instance) {
      RollbackService.instance = new RollbackService();
    }
    return RollbackService.instance;
  }

  /**
   * Initialize rollback service and load change history
   */
  async initialize(): Promise<void> {
    try {
      await this.loadChangeHistory();
      this.startHistoryCleanup();
      
      this.logger.info('Rollback service initialized', {
        trackedKeys: this.changeHistory.size,
      });
    } catch (error) {
      this.logger.error('Failed to initialize rollback service', error as Error);
      throw error;
    }
  }

  /**
   * Record a configuration change for rollback capability
   */
  async recordChange(
    key: string,
    oldValue: any,
    newValue: any,
    userId: string,
    reason?: string
  ): Promise<string> {
    try {
      const changeId = this.generateChangeId();
      const change: ConfigChange = {
        id: changeId,
        key,
        oldValue,
        newValue,
        userId,
        reason,
        timestamp: new Date().toISOString(),
        rolledBack: false,
      };

      // Add to history
      if (!this.changeHistory.has(key)) {
        this.changeHistory.set(key, []);
      }

      const history = this.changeHistory.get(key)!;
      history.unshift(change); // Add to beginning

      // Limit history size
      if (history.length > RollbackService.MAX_HISTORY_PER_KEY) {
        history.splice(RollbackService.MAX_HISTORY_PER_KEY);
      }

      // Persist change history
      await this.persistChangeHistory(key, history);

      this.logger.info('Configuration change recorded', {
        changeId,
        key,
        userId,
        reason,
      });

      return changeId;
    } catch (error) {
      this.logger.error('Failed to record configuration change', error as Error, { key });
      throw error;
    }
  }

  /**
   * Rollback a configuration change
   */
  async rollbackChange(changeId: string, userId: string, reason?: string): Promise<void> {
    try {
      const change = this.findChangeById(changeId);
      if (!change) {
        throw new Error(`Change ${changeId} not found`);
      }

      if (change.rolledBack) {
        throw new Error(`Change ${changeId} has already been rolled back`);
      }

      // Perform the rollback
      await this.configManager.set(change.key, change.oldValue, {
        description: `Rollback of change ${changeId} by ${userId}`,
      });

      // Mark as rolled back
      change.rolledBack = true;
      change.rollbackTimestamp = new Date().toISOString();
      change.rollbackUserId = userId;
      change.rollbackReason = reason;

      // Update history
      const history = this.changeHistory.get(change.key);
      if (history) {
        await this.persistChangeHistory(change.key, history);
      }

      // Log rollback
      this.securityLogger.logSecurityConfigChange(
        this.generateCorrelationId(),
        userId,
        change.key,
        change.newValue,
        change.oldValue,
        undefined
      );

      this.logger.info('Configuration change rolled back', {
        changeId,
        key: change.key,
        userId,
        reason,
        originalUserId: change.userId,
      });

    } catch (error) {
      this.logger.error('Failed to rollback configuration change', error as Error, { changeId });
      throw error;
    }
  }

  /**
   * Rollback to a specific point in time
   */
  async rollbackToTimestamp(
    key: string,
    timestamp: string,
    userId: string,
    reason?: string
  ): Promise<void> {
    try {
      const history = this.changeHistory.get(key);
      if (!history || history.length === 0) {
        throw new Error(`No change history found for key ${key}`);
      }

      // Find the change closest to the target timestamp
      const targetTime = new Date(timestamp).getTime();
      let targetChange: ConfigChange | null = null;

      for (const change of history) {
        const changeTime = new Date(change.timestamp).getTime();
        if (changeTime <= targetTime) {
          targetChange = change;
          break;
        }
      }

      if (!targetChange) {
        throw new Error(`No change found before timestamp ${timestamp} for key ${key}`);
      }

      // Perform the rollback
      await this.configManager.set(key, targetChange.oldValue, {
        description: `Rollback to ${timestamp} by ${userId}`,
      });

      // Record this as a new change
      await this.recordChange(
        key,
        await this.configManager.get(key), // Current value
        targetChange.oldValue,
        userId,
        `Rollback to ${timestamp}: ${reason || 'No reason provided'}`
      );

      this.logger.info('Configuration rolled back to timestamp', {
        key,
        timestamp,
        userId,
        reason,
        targetChangeId: targetChange.id,
      });

    } catch (error) {
      this.logger.error('Failed to rollback to timestamp', error as Error, { key, timestamp });
      throw error;
    }
  }

  /**
   * Get change history for a configuration key
   */
  getChangeHistory(key: string): ConfigChange[] {
    return this.changeHistory.get(key) || [];
  }

  /**
   * Get all change history
   */
  getAllChangeHistory(): Record<string, ConfigChange[]> {
    const result: Record<string, ConfigChange[]> = {};
    for (const [key, history] of this.changeHistory.entries()) {
      result[key] = [...history]; // Return copy
    }
    return result;
  }

  /**
   * Get change by ID
   */
  getChangeById(changeId: string): ConfigChange | null {
    return this.findChangeById(changeId);
  }

  /**
   * Get recent changes across all keys
   */
  getRecentChanges(limit: number = 50): ConfigChange[] {
    const allChanges: ConfigChange[] = [];
    
    for (const history of this.changeHistory.values()) {
      allChanges.push(...history);
    }

    // Sort by timestamp (newest first)
    allChanges.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return allChanges.slice(0, limit);
  }

  /**
   * Get rollback statistics
   */
  getRollbackStatistics(): RollbackStatistics {
    let totalChanges = 0;
    let rolledBackChanges = 0;
    const changesByUser: Record<string, number> = {};
    const changesByKey: Record<string, number> = {};

    for (const [key, history] of this.changeHistory.entries()) {
      changesByKey[key] = history.length;
      
      for (const change of history) {
        totalChanges++;
        
        if (change.rolledBack) {
          rolledBackChanges++;
        }

        changesByUser[change.userId] = (changesByUser[change.userId] || 0) + 1;
      }
    }

    return {
      totalChanges,
      rolledBackChanges,
      rollbackRate: totalChanges > 0 ? (rolledBackChanges / totalChanges) * 100 : 0,
      trackedKeys: this.changeHistory.size,
      changesByUser,
      changesByKey,
    };
  }

  /**
   * Validate rollback safety
   */
  async validateRollbackSafety(changeId: string): Promise<RollbackValidation> {
    try {
      const change = this.findChangeById(changeId);
      if (!change) {
        return {
          safe: false,
          warnings: [`Change ${changeId} not found`],
          blockers: [],
        };
      }

      const warnings: string[] = [];
      const blockers: string[] = [];

      // Check if already rolled back
      if (change.rolledBack) {
        blockers.push('Change has already been rolled back');
      }

      // Check age of change
      const changeAge = Date.now() - new Date(change.timestamp).getTime();
      const maxSafeAge = 24 * 60 * 60 * 1000; // 24 hours
      
      if (changeAge > maxSafeAge) {
        warnings.push('Change is older than 24 hours - rollback may have unexpected effects');
      }

      // Check for dependent changes
      const history = this.changeHistory.get(change.key) || [];
      const newerChanges = history.filter(c => 
        new Date(c.timestamp) > new Date(change.timestamp) && !c.rolledBack
      );

      if (newerChanges.length > 0) {
        warnings.push(`${newerChanges.length} newer changes exist for this key`);
      }

      // Check if key is marked as critical
      const criticalKeys = [
        'security/encryption/enabled',
        'auth/api-key/required',
        'providers/openai/api-key',
        'cache/redis/password',
      ];

      if (criticalKeys.includes(change.key)) {
        warnings.push('This is a critical security configuration - proceed with caution');
      }

      return {
        safe: blockers.length === 0,
        warnings,
        blockers,
        change,
        newerChangesCount: newerChanges.length,
      };

    } catch (error) {
      this.logger.error('Failed to validate rollback safety', error as Error, { changeId });
      return {
        safe: false,
        warnings: [],
        blockers: ['Failed to validate rollback safety'],
      };
    }
  }

  // Private methods

  private async loadChangeHistory(): Promise<void> {
    try {
      // Load change history from Parameter Store
      const historyConfigs = await this.configManager.getAll('change-history');
      
      for (const [key, value] of Object.entries(historyConfigs)) {
        const configKey = key.replace('change-history/', '');
        this.changeHistory.set(configKey, value as ConfigChange[]);
      }
    } catch (error) {
      this.logger.warn('Failed to load change history', { error: (error as Error).message });
    }
  }

  private async persistChangeHistory(key: string, history: ConfigChange[]): Promise<void> {
    try {
      await this.configManager.set(`change-history/${key}`, history, {
        description: `Change history for ${key}`,
      });
    } catch (error) {
      this.logger.error('Failed to persist change history', error as Error, { key });
    }
  }

  private findChangeById(changeId: string): ConfigChange | null {
    for (const history of this.changeHistory.values()) {
      const change = history.find(c => c.id === changeId);
      if (change) {
        return change;
      }
    }
    return null;
  }

  private generateChangeId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `CHG-${timestamp}-${random}`.toUpperCase();
  }

  private generateCorrelationId(): string {
    return `rollback-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  private startHistoryCleanup(): void {
    // Clean up old history entries every hour
    setInterval(() => {
      this.cleanupOldHistory();
    }, 60 * 60 * 1000);
  }

  private cleanupOldHistory(): void {
    const cutoffTime = Date.now() - (RollbackService.HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const [key, history] of this.changeHistory.entries()) {
      const originalLength = history.length;
      
      // Remove old entries
      const filteredHistory = history.filter(change => 
        new Date(change.timestamp).getTime() > cutoffTime
      );

      if (filteredHistory.length !== originalLength) {
        this.changeHistory.set(key, filteredHistory);
        cleanedCount += originalLength - filteredHistory.length;
        
        // Persist updated history
        this.persistChangeHistory(key, filteredHistory).catch(error => {
          this.logger.error('Failed to persist cleaned history', error as Error, { key });
        });
      }
    }

    if (cleanedCount > 0) {
      this.logger.info('Cleaned up old change history', { cleanedCount });
    }
  }
}

// Interfaces

export interface ConfigChange {
  id: string;
  key: string;
  oldValue: any;
  newValue: any;
  userId: string;
  reason?: string;
  timestamp: string;
  rolledBack: boolean;
  rollbackTimestamp?: string;
  rollbackUserId?: string;
  rollbackReason?: string;
}

export interface RollbackStatistics {
  totalChanges: number;
  rolledBackChanges: number;
  rollbackRate: number;
  trackedKeys: number;
  changesByUser: Record<string, number>;
  changesByKey: Record<string, number>;
}

export interface RollbackValidation {
  safe: boolean;
  warnings: string[];
  blockers: string[];
  change?: ConfigChange;
  newerChangesCount?: number;
}