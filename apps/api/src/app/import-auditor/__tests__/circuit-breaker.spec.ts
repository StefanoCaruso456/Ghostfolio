import { CircuitBreaker } from '../guardrails/circuit-breaker';

describe('CircuitBreaker Guardrail', () => {
  it('should not trip on first call', () => {
    const cb = new CircuitBreaker({ maxRepetitions: 3 });
    const tripped = cb.recordAction('parseCSV', { content: 'a,b,c' });

    expect(tripped).toBe(false);
    expect(cb.isTripped()).toBe(false);
  });

  it('should not trip on different actions', () => {
    const cb = new CircuitBreaker({ maxRepetitions: 3 });

    cb.recordAction('parseCSV', { content: 'a' });
    cb.recordAction('mapBrokerFields', { headers: ['a'] });
    cb.recordAction('validateTransactions', { activities: [] });

    expect(cb.isTripped()).toBe(false);
  });

  it('should trip on 3 identical actions', () => {
    const cb = new CircuitBreaker({ maxRepetitions: 3 });
    const args = { content: 'same-csv-data' };

    cb.recordAction('parseCSV', args);
    cb.recordAction('parseCSV', args);
    const tripped = cb.recordAction('parseCSV', args);

    expect(tripped).toBe(true);
    expect(cb.isTripped()).toBe(true);
    expect(cb.getTripReason()).toContain('parseCSV');
    expect(cb.getTripReason()).toContain('3 times');
  });

  it('should not trip on same tool with different args', () => {
    const cb = new CircuitBreaker({ maxRepetitions: 3 });

    cb.recordAction('parseCSV', { content: 'data1' });
    cb.recordAction('parseCSV', { content: 'data2' });
    cb.recordAction('parseCSV', { content: 'data3' });

    expect(cb.isTripped()).toBe(false);
  });

  it('should stay tripped once tripped', () => {
    const cb = new CircuitBreaker({ maxRepetitions: 2 });
    const args = { x: 1 };

    cb.recordAction('tool', args);
    cb.recordAction('tool', args);

    expect(cb.isTripped()).toBe(true);

    // Any further call should also report tripped
    const tripped = cb.recordAction('differentTool', { y: 2 });
    expect(tripped).toBe(true);
  });

  it('should reset correctly', () => {
    const cb = new CircuitBreaker({ maxRepetitions: 2 });

    cb.recordAction('tool', { x: 1 });
    cb.recordAction('tool', { x: 1 });
    expect(cb.isTripped()).toBe(true);

    cb.reset();
    expect(cb.isTripped()).toBe(false);
    expect(cb.getTripReason()).toBeUndefined();

    // Should be able to record again
    cb.recordAction('tool', { x: 1 });
    expect(cb.isTripped()).toBe(false);
  });

  it('should track action counts', () => {
    const cb = new CircuitBreaker({ maxRepetitions: 5 });

    cb.recordAction('parseCSV', { a: 1 });
    cb.recordAction('parseCSV', { a: 1 });
    cb.recordAction('mapFields', { b: 2 });

    const counts = cb.getActionCounts();
    expect(counts.size).toBe(2);
  });

  it('should use default maxRepetitions of 3', () => {
    const cb = new CircuitBreaker();

    cb.recordAction('t', { x: 1 });
    cb.recordAction('t', { x: 1 });
    expect(cb.isTripped()).toBe(false);

    cb.recordAction('t', { x: 1 });
    expect(cb.isTripped()).toBe(true);
  });
});
