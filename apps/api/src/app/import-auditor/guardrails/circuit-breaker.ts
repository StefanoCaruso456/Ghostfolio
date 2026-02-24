/**
 * Circuit Breaker — Detects repeated identical tool calls and aborts.
 *
 * AgentForge rule: If same action (tool + args signature) repeats 3x → abort.
 * Prevents infinite loops, token waste, and downstream service hammering.
 *
 * Signature normalization: args are sorted, strings trimmed+truncated,
 * numbers bucketed — so slightly different args still match.
 */
import crypto from 'crypto';

export interface CircuitBreakerConfig {
  /** Max times the same action can repeat before tripping. Default: 3. */
  maxRepetitions: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxRepetitions: 3
};

/**
 * Normalize args for stable hashing: sort keys, trim+truncate strings,
 * round numbers to 2 decimal places. This prevents the LLM from
 * trivially evading the breaker with whitespace or precision changes.
 */
function normalizeArgs(args: unknown): unknown {
  if (args === null || args === undefined) {
    return {};
  }

  if (typeof args !== 'object' || Array.isArray(args)) {
    return args;
  }

  const obj = args as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const normalized: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    const v = obj[key];

    if (typeof v === 'string') {
      normalized[key] = v.trim().slice(0, 200);
    } else if (typeof v === 'number') {
      normalized[key] = Math.round(v * 100) / 100;
    } else if (Array.isArray(v)) {
      normalized[key] = v.length; // bucket arrays by length
    } else {
      normalized[key] = v;
    }
  }

  return normalized;
}

/**
 * Create a stable SHA-256 signature for a tool + normalized args combination.
 */
export function createSignature(toolName: string, args: unknown): string {
  const norm = normalizeArgs(args ?? {});
  const raw = toolName + ':' + JSON.stringify(norm);

  return crypto.createHash('sha256').update(raw).digest('hex');
}

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

    const signature = createSignature(toolName, args);
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
}
