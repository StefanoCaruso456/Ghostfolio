import { CostLimiter } from '../guardrails/cost-limiter';

describe('CostLimiter Guardrail', () => {
  it('should not exceed on small costs', () => {
    const limiter = new CostLimiter({ maxCostUsd: 1.0 });

    const exceeded = limiter.addCost(0.01);

    expect(exceeded).toBe(false);
    expect(limiter.isExceeded()).toBe(false);
    expect(limiter.getAccumulatedCost()).toBe(0.01);
  });

  it('should accumulate costs across multiple calls', () => {
    const limiter = new CostLimiter({ maxCostUsd: 1.0 });

    limiter.addCost(0.3);
    limiter.addCost(0.3);
    limiter.addCost(0.3);

    expect(limiter.getAccumulatedCost()).toBeCloseTo(0.9, 2);
    expect(limiter.isExceeded()).toBe(false);
  });

  it('should trigger when cost limit is reached', () => {
    const limiter = new CostLimiter({ maxCostUsd: 1.0 });

    limiter.addCost(0.5);
    const exceeded = limiter.addCost(0.6);

    expect(exceeded).toBe(true);
    expect(limiter.isExceeded()).toBe(true);
  });

  it('should trigger warning at 80% threshold', () => {
    const limiter = new CostLimiter({
      maxCostUsd: 1.0,
      warnThreshold: 0.8
    });

    limiter.addCost(0.7);
    expect(limiter.isWarning()).toBe(false);

    limiter.addCost(0.11);
    expect(limiter.isWarning()).toBe(true);
    expect(limiter.isExceeded()).toBe(false);
  });

  it('should report remaining budget', () => {
    const limiter = new CostLimiter({ maxCostUsd: 1.0 });

    limiter.addCost(0.4);

    expect(limiter.getRemainingBudget()).toBeCloseTo(0.6, 2);
  });

  it('should report zero remaining when exceeded', () => {
    const limiter = new CostLimiter({ maxCostUsd: 0.5 });

    limiter.addCost(0.8);

    expect(limiter.getRemainingBudget()).toBe(0);
  });

  it('should reset correctly', () => {
    const limiter = new CostLimiter({ maxCostUsd: 1.0 });

    limiter.addCost(1.5);
    expect(limiter.isExceeded()).toBe(true);

    limiter.reset();
    expect(limiter.isExceeded()).toBe(false);
    expect(limiter.getAccumulatedCost()).toBe(0);
  });

  it('should use default config values', () => {
    const limiter = new CostLimiter();

    // Default maxCostUsd is 1.0
    limiter.addCost(0.99);
    expect(limiter.isExceeded()).toBe(false);

    limiter.addCost(0.02);
    expect(limiter.isExceeded()).toBe(true);
  });
});
