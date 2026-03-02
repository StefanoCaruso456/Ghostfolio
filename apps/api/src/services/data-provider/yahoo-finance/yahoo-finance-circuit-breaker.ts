/**
 * Network-level circuit breaker for Yahoo Finance.
 *
 * When Yahoo is unreachable (e.g. Railway IPv6 outage), this prevents
 * dozens of requests from each timing out individually. After
 * `failureThreshold` consecutive failures, the circuit opens for
 * `cooldownMs` and all subsequent calls fail instantly. After the
 * cooldown, one probe request is allowed through (half-open state).
 */
import { Logger } from '@nestjs/common';

const logger = new Logger('YahooFinanceCircuitBreaker');

type CircuitState = 'closed' | 'open' | 'half-open';

export class YahooFinanceCircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;

  public constructor(
    private readonly failureThreshold: number = 5,
    private readonly cooldownMs: number = 60_000
  ) {}

  /**
   * Check whether a request should be allowed through.
   * Returns true if the circuit is closed or half-open (probe).
   */
  public canExecute(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'half-open';
        logger.log(
          'Circuit half-open — allowing one probe request to Yahoo Finance'
        );

        return true;
      }

      return false;
    }

    // half-open: already allowing one probe
    return false;
  }

  /** Record a successful request. Resets the circuit to closed. */
  public recordSuccess(): void {
    if (this.state !== 'closed') {
      logger.log('Yahoo Finance circuit breaker reset to closed');
    }

    this.consecutiveFailures = 0;
    this.state = 'closed';
  }

  /** Record a failed request. May trip the circuit open. */
  public recordFailure(): void {
    this.consecutiveFailures++;

    if (this.state === 'half-open') {
      // Probe failed — reopen
      this.state = 'open';
      this.openedAt = Date.now();
      logger.warn(
        `Yahoo Finance probe failed — circuit re-opened for ${this.cooldownMs / 1000}s`
      );

      return;
    }

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
      logger.warn(
        `Yahoo Finance circuit breaker OPEN after ${this.consecutiveFailures} consecutive failures — blocking requests for ${this.cooldownMs / 1000}s`
      );
    }
  }

  public getState(): CircuitState {
    return this.state;
  }

  public getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }
}

/** Singleton shared across YahooFinanceService and MarketChartService */
let instance: YahooFinanceCircuitBreaker | null = null;

export function getYahooCircuitBreaker(): YahooFinanceCircuitBreaker {
  if (!instance) {
    instance = new YahooFinanceCircuitBreaker();
  }

  return instance;
}
