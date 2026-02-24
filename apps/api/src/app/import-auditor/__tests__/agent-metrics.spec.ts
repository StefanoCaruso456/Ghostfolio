import {
  createAgentMetrics,
  estimateCost,
  finalizeMetrics
} from '../schemas/agent-metrics.schema';

describe('AgentMetrics', () => {
  it('should create metrics with correct defaults', () => {
    const metrics = createAgentMetrics('test-session-123');

    expect(metrics.taskId).toBe('test-session-123');
    expect(metrics.startTime).toBeDefined();
    expect(metrics.endTime).toBeUndefined();
    expect(metrics.durationMs).toBe(0);
    expect(metrics.iterations).toBe(0);
    expect(metrics.totalTokens).toBe(0);
    expect(metrics.totalCostUsd).toBe(0);
    expect(metrics.toolsCalled).toEqual([]);
    expect(metrics.success).toBe(false);
    expect(metrics.guardrailTriggered).toBeUndefined();
    expect(metrics.thoughtLog).toEqual([]);
    expect(metrics.actionLog).toEqual([]);
    expect(metrics.observationLog).toEqual([]);
  });

  it('should finalize metrics with end time and duration', () => {
    const metrics = createAgentMetrics('test-session');
    // Simulate some time passing
    const finalized = finalizeMetrics(metrics);

    expect(finalized.endTime).toBeDefined();
    expect(finalized.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should preserve all data when finalizing', () => {
    const metrics = createAgentMetrics('test');
    metrics.iterations = 5;
    metrics.totalTokens = 1000;
    metrics.toolsCalled = ['parseCSV', 'mapBrokerFields'];
    metrics.success = true;

    const finalized = finalizeMetrics(metrics);

    expect(finalized.iterations).toBe(5);
    expect(finalized.totalTokens).toBe(1000);
    expect(finalized.toolsCalled).toEqual(['parseCSV', 'mapBrokerFields']);
    expect(finalized.success).toBe(true);
  });
});

describe('estimateCost', () => {
  it('should estimate cost for known model', () => {
    const cost = estimateCost('openai/gpt-4o', 1000, 500);

    // (1000/1000) * 0.0025 + (500/1000) * 0.01 = 0.0025 + 0.005 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 4);
  });

  it('should use default pricing for unknown model', () => {
    const cost = estimateCost('unknown/model', 1000, 500);

    // (1000/1000) * 0.003 + (500/1000) * 0.015 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it('should return 0 for zero tokens', () => {
    const cost = estimateCost('openai/gpt-4o', 0, 0);
    expect(cost).toBe(0);
  });

  it('should scale linearly with token count', () => {
    const cost1k = estimateCost('openai/gpt-4o', 1000, 0);
    const cost2k = estimateCost('openai/gpt-4o', 2000, 0);

    expect(cost2k).toBeCloseTo(cost1k * 2, 6);
  });
});
