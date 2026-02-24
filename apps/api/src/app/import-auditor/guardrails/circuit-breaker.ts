/**
 * Circuit Breaker — Detects repeated identical tool calls and aborts.
 *
 * AgentForge rule: If same action (tool + args signature) repeats 3x → abort.
 * Prevents infinite loops, token waste, and downstream service hammering.
 */

export interface CircuitBreakerConfig {
  /** Max times the same action can repeat before tripping. Default: 3. */
  maxRepetitions: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxRepetitions: 3
};

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private readonly actionCounts = new Map<string, number>();
  private tripped = false;
  private tripReason: string | undefined;

  public constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a tool call. Returns true if the circuit breaker has tripped.
   */
  public recordAction(toolName: string, args: unknown): boolean {
    if (this.tripped) {
      return true;
    }

    const signature = this.createSignature(toolName, args);
    const count = (this.actionCounts.get(signature) ?? 0) + 1;
    this.actionCounts.set(signature, count);

    if (count >= this.config.maxRepetitions) {
      this.tripped = true;
      this.tripReason = `Circuit breaker tripped: "${toolName}" called ${count} times with identical arguments`;

      return true;
    }

    return false;
  }

  public isTripped(): boolean {
    return this.tripped;
  }

  public getTripReason(): string | undefined {
    return this.tripReason;
  }

  public reset(): void {
    this.actionCounts.clear();
    this.tripped = false;
    this.tripReason = undefined;
  }

  public getActionCounts(): Map<string, number> {
    return new Map(this.actionCounts);
  }

  /**
   * Create a stable string signature for a tool + args combination.
   * Uses sorted JSON to ensure deterministic comparison.
   */
  private createSignature(toolName: string, args: unknown): string {
    try {
      const sortedArgs = JSON.stringify(
        args,
        Object.keys(args as Record<string, unknown>).sort()
      );

      return `${toolName}::${sortedArgs}`;
    } catch {
      // Fallback for non-serializable args
      return `${toolName}::${String(args)}`;
    }
  }
}
