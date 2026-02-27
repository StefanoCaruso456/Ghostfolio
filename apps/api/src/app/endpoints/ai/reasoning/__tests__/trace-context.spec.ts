import type { ReasoningEvent } from '@ghostfolio/common/interfaces';

import { TraceContext } from '../trace-context';

describe('TraceContext', () => {
  let events: ReasoningEvent[];
  let emit: (event: ReasoningEvent) => void;

  beforeEach(() => {
    events = [];
    emit = (event) => events.push(event);
  });

  it('should emit trace.started on construction', () => {
    /* const ctx = */ new TraceContext('trace-1', emit);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('trace.started');
    expect(events[0].traceId).toBe('trace-1');
    expect(events[0].preview).toBeDefined();
    expect(events[0].preview!.steps).toEqual([]);
  });

  it('should emit step.added for plan steps', () => {
    const ctx = new TraceContext('trace-2', emit);
    ctx.addPlanStep('Analyzing question');

    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('step.added');
    expect(events[1].step!.kind).toBe('plan');
    expect(events[1].step!.title).toBe('Analyzing question');
    expect(events[1].step!.status).toBe('success');
  });

  it('should emit step.added for analysis summaries', () => {
    const ctx = new TraceContext('trace-3', emit);
    ctx.addAnalysisSummary(
      'Fetching your portfolio data to answer this question.'
    );

    expect(events).toHaveLength(2);
    expect(events[1].step!.kind).toBe('analysis');
    expect(events[1].step!.title).toContain('Fetching your portfolio');
  });

  it('should handle tool call lifecycle: start → complete', () => {
    const ctx = new TraceContext('trace-4', emit);
    const toolStep = ctx.startToolCall('getPortfolioSummary', {
      userCurrency: 'USD'
    });

    expect(events).toHaveLength(2);
    expect(events[1].step!.status).toBe('running');
    expect(events[1].step!.kind).toBe('tool_call');

    ctx.completeToolCall(
      toolStep.id,
      { status: 'success', holdingsCount: 5 },
      'success',
      150
    );

    expect(events).toHaveLength(3);
    expect(events[2].type).toBe('step.updated');
    expect(events[2].step!.status).toBe('success');
    expect(events[2].step!.durationMs).toBe(150);
    expect(events[2].step!.children).toHaveLength(1);
    expect(events[2].step!.children[0].kind).toBe('tool_result');
  });

  it('should handle tool call errors', () => {
    const ctx = new TraceContext('trace-5', emit);
    const toolStep = ctx.startToolCall('getQuote', { symbols: ['AAPL'] });

    ctx.completeToolCall(
      toolStep.id,
      { status: 'error', message: 'Rate limited' },
      'error',
      500
    );

    const updatedStep = events[events.length - 1].step!;
    expect(updatedStep.status).toBe('error');
    expect(updatedStep.children[0].status).toBe('error');
    expect(updatedStep.children[0].title).toBe('Tool error');
  });

  it('should emit trace.completed with full preview', () => {
    const ctx = new TraceContext('trace-6', emit);
    ctx.addPlanStep('Understanding request');
    ctx.addAnalysisSummary('Looking at your portfolio data');

    const toolStep = ctx.startToolCall('getPerformance', { dateRange: '1y' });
    ctx.completeToolCall(toolStep.id, { performance: 12.5 }, 'success', 200);

    ctx.addAnswerStep();
    const preview = ctx.complete();

    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe('trace.completed');
    expect(lastEvent.preview).toBeDefined();
    expect(preview.steps).toHaveLength(4);
    expect(preview.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(preview.completedAt).not.toBeNull();
  });

  it('should maintain correct event ordering', () => {
    const ctx = new TraceContext('trace-7', emit);
    ctx.addPlanStep('Plan');
    ctx.addAnalysisSummary('Analysis');
    const tool1 = ctx.startToolCall('tool1', {});
    ctx.completeToolCall(tool1.id, {}, 'success', 100);
    const tool2 = ctx.startToolCall('tool2', {});
    ctx.completeToolCall(tool2.id, {}, 'error', 50);
    ctx.addAnswerStep();
    ctx.complete();

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'trace.started',
      'step.added', // plan
      'step.added', // analysis
      'step.added', // tool1 call
      'step.updated', // tool1 result
      'step.added', // tool2 call
      'step.updated', // tool2 result
      'step.added', // answer
      'trace.completed'
    ]);
  });

  it('should redact sensitive data in tool args', () => {
    const ctx = new TraceContext('trace-8', emit);
    ctx.startToolCall('someApi', {
      apiKey: 'sk-secretkey1234567890ab',
      query: 'portfolio summary'
    });

    const stepDetail = events[1].step!.detail!;
    expect(stepDetail).not.toContain('sk-secretkey1234567890ab');
    expect(stepDetail).toContain('[REDACTED]');
    expect(events[1].step!.redactionApplied).toBe(true);
  });

  it('should redact sensitive data in tool results', () => {
    const ctx = new TraceContext('trace-9', emit);
    const toolStep = ctx.startToolCall('fetch', { url: '/api' });

    ctx.completeToolCall(
      toolStep.id,
      {
        data: 'user email is admin@company.com',
        token: 'Bearer sk-12345678901234567890'
      },
      'success',
      100
    );

    const resultChild = events[events.length - 1].step!.children[0];
    expect(resultChild.detail).not.toContain('admin@company.com');
    expect(resultChild.detail).not.toContain('sk-12345678901234567890');
    expect(resultChild.redactionApplied).toBe(true);
  });

  it('should silently ignore completing a non-existent step', () => {
    const ctx = new TraceContext('trace-10', emit);
    // Should not throw
    ctx.completeToolCall('nonexistent-id', {}, 'success', 100);
    expect(events).toHaveLength(1); // Only trace.started
  });

  it('getPreview should return current snapshot', () => {
    const ctx = new TraceContext('trace-11', emit);
    ctx.addPlanStep('Step 1');

    const preview = ctx.getPreview();
    expect(preview.traceId).toBe('trace-11');
    expect(preview.steps).toHaveLength(1);
    expect(preview.completedAt).toBeNull();
    expect(preview.totalDurationMs).toBeNull();
  });
});
