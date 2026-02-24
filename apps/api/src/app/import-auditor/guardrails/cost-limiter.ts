/**
 * Cost Limiter — Prevents bill explosions by tracking per-query cost.
 *
 * AgentForge rule: COST_LIMIT per query with alerting on anomalies.
 */

export interface CostLimiterConfig {
  /** Max cost in USD per query. Default: $1.00 */
  maxCostUsd: number;
  /** Warn threshold (fraction of max). Default: 0.8 */
  warnThreshold: number;
}

const DEFAULT_CONFIG: CostLimiterConfig = {
  maxCostUsd: 1.0,
  warnThreshold: 0.8
};

export class CostLimiter {
  private readonly config: CostLimiterConfig;
  private accumulatedCostUsd = 0;
  private exceeded = false;

  public constructor(config: Partial<CostLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add cost from a step. Returns true if limit exceeded.
   */
  public addCost(costUsd: number): boolean {
    this.accumulatedCostUsd += costUsd;

    if (this.accumulatedCostUsd >= this.config.maxCostUsd) {
      this.exceeded = true;

      return true;
    }

    return false;
  }

  public isExceeded(): boolean {
    return this.exceeded;
  }

  public isWarning(): boolean {
    return (
      this.accumulatedCostUsd >=
      this.config.maxCostUsd * this.config.warnThreshold
    );
  }

  public getAccumulatedCost(): number {
    return this.accumulatedCostUsd;
  }

  public getRemainingBudget(): number {
    return Math.max(0, this.config.maxCostUsd - this.accumulatedCostUsd);
  }

  public reset(): void {
    this.accumulatedCostUsd = 0;
    this.exceeded = false;
  }
}
