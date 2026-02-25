import { ToolSpanBuilder, TraceContext } from '../braintrust-telemetry.service';
import {
  computeAllScores,
  scoreCost,
  scoreGroundedness,
  scoreLatency,
  scoreSafety,
  scoreToolExecution,
  scoreToolSelection
} from '../eval-scorers';
import type { TelemetryPayload } from '../telemetry.interfaces';

// ===========================================================================
// TraceContext
// ===========================================================================

describe('TraceContext', () => {
  function createTrace() {
    return new TraceContext({
      traceId: 'trace-001',
      sessionId: 'session-001',
      userId: 'user-001',
      queryText: 'What is my portfolio allocation?',
      model: 'openai/gpt-4o',
      startTime: Date.now()
    });
  }

  it('should create a trace with correct initial values', () => {
    const trace = createTrace();
    const payload = trace.finalize();

    expect(payload.trace.traceId).toBe('trace-001');
    expect(payload.trace.sessionId).toBe('session-001');
    expect(payload.trace.userId).toBe('user-001');
    expect(payload.trace.queryText).toBe('What is my portfolio allocation?');
    expect(payload.trace.model).toBe('openai/gpt-4o');
    expect(payload.trace.success).toBe(true);
    expect(payload.trace.aborted).toBe(false);
    expect(payload.trace.usedTools).toBe(false);
    expect(payload.toolSpans).toEqual([]);
    expect(payload.reactIterations).toEqual([]);
  });

  it('should compute latency breakdown correctly', () => {
    const trace = createTrace();

    trace.markLlmStart();
    trace.markLlmEnd();

    trace.setResponse('Your portfolio is 60% stocks, 40% bonds.');
    trace.setTokens(500, 200);
    trace.setCost(0.005);

    const payload = trace.finalize();

    expect(payload.trace.totalLatencyMs).toBeGreaterThanOrEqual(0);
    expect(payload.trace.llmLatencyMs).toBeGreaterThanOrEqual(0);
    expect(payload.trace.overheadLatencyMs).toBeGreaterThanOrEqual(0);
    expect(payload.trace.inputTokenCount).toBe(500);
    expect(payload.trace.outputTokenCount).toBe(200);
    expect(payload.trace.totalTokenCount).toBe(700);
    expect(payload.trace.estimatedCostUsd).toBe(0.005);
  });

  it('should track tool spans', () => {
    const trace = createTrace();
    const spanBuilder = trace.startToolSpan(
      'get_portfolio_context',
      { currency: 'USD' },
      1
    );

    const span = spanBuilder.end({
      status: 'success',
      toolOutput: { holdingsCount: 5 }
    });

    trace.addToolSpan(span);

    const payload = trace.finalize();

    expect(payload.toolSpans).toHaveLength(1);
    expect(payload.toolSpans[0].toolName).toBe('get_portfolio_context');
    expect(payload.toolSpans[0].status).toBe('success');
    expect(payload.toolSpans[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(payload.toolSpans[0].iterationIndex).toBe(1);
    expect(payload.trace.usedTools).toBe(true);
    expect(payload.trace.toolNames).toContain('get_portfolio_context');
    expect(payload.trace.toolCallCount).toBe(1);
  });

  it('should track multiple tool spans and compute derived metrics', () => {
    const trace = createTrace();

    // Tool 1 — success
    const span1 = trace
      .startToolSpan('get_portfolio_context', {}, 1)
      .end({ status: 'success', toolOutput: {} });

    trace.addToolSpan(span1);

    // Tool 2 — error
    const span2 = trace
      .startToolSpan('get_market_data', { symbol: 'AAPL' }, 2)
      .end({
        status: 'error',
        toolOutput: null,
        error: 'Market data unavailable'
      });

    trace.addToolSpan(span2);

    const payload = trace.finalize();

    expect(payload.toolSpans).toHaveLength(2);
    expect(payload.trace.toolCallCount).toBe(2);
    expect(payload.trace.toolNames).toEqual(
      expect.arrayContaining(['get_portfolio_context', 'get_market_data'])
    );
    expect(payload.derived.toolSuccessRates['get_portfolio_context']).toBe(1.0);
    expect(payload.derived.toolSuccessRates['get_market_data']).toBe(0.0);
  });

  it('should track verification summary', () => {
    const trace = createTrace();

    trace.setConfidence(0.85);
    trace.addHallucinationFlag('Claimed 15% return not in data');
    trace.addDomainViolation('Referenced ticker XYZ not in portfolio');
    trace.addWarning('Response includes general market commentary');

    const payload = trace.finalize();

    expect(payload.verification.confidenceScore).toBe(0.85);
    expect(payload.verification.passed).toBe(false);
    expect(payload.verification.hallucinationFlags).toHaveLength(1);
    expect(payload.verification.domainViolations).toHaveLength(1);
    expect(payload.verification.warnings).toHaveLength(1);
  });

  it('should clamp confidence score between 0 and 1', () => {
    const trace = createTrace();

    trace.setConfidence(1.5);

    let payload = trace.finalize();

    expect(payload.verification.confidenceScore).toBe(1.0);

    const trace2 = createTrace();

    trace2.setConfidence(-0.5);

    payload = trace2.finalize();

    expect(payload.verification.confidenceScore).toBe(0.0);
  });

  it('should track escalation', () => {
    const trace = createTrace();

    trace.triggerEscalation('User asked for specific tax advice');

    const payload = trace.finalize();

    expect(payload.verification.escalationTriggered).toBe(true);
    expect(payload.verification.escalationReason).toBe(
      'User asked for specific tax advice'
    );
  });

  it('should mark error state', () => {
    const trace = createTrace();

    trace.markError('OpenRouter API timeout');

    const payload = trace.finalize();

    expect(payload.trace.success).toBe(false);
    expect(payload.trace.error).toBe('OpenRouter API timeout');
  });

  it('should mark aborted state', () => {
    const trace = createTrace();

    trace.markAborted();

    const payload = trace.finalize();

    expect(payload.trace.aborted).toBe(true);
    expect(payload.trace.success).toBe(false);
  });

  it('should track guardrails', () => {
    const trace = createTrace();

    trace.addGuardrail('timeout');
    trace.addGuardrail('cost_limit');

    const payload = trace.finalize();

    expect(payload.trace.guardrailsTriggered).toEqual([
      'timeout',
      'cost_limit'
    ]);
  });

  it('should track ReAct iterations', () => {
    const trace = createTrace();

    trace.addReactIteration({
      iterationIndex: 1,
      thought: 'User wants allocation breakdown',
      action: 'call get_portfolio_context',
      observation: 'Got 5 holdings',
      decision: 'continue_loop',
      latencyMs: 150
    });

    trace.addReactIteration({
      iterationIndex: 2,
      thought: 'Have all data needed',
      action: 'generate_response',
      observation: 'Response ready',
      decision: 'return_answer',
      latencyMs: 200
    });

    trace.setIterationCount(2);

    const payload = trace.finalize();

    expect(payload.reactIterations).toHaveLength(2);
    expect(payload.reactIterations[0].traceId).toBe('trace-001');
    expect(payload.reactIterations[1].decision).toBe('return_answer');
    expect(payload.trace.iterationCount).toBe(2);
    expect(payload.derived.latencyPerIteration).toBeGreaterThanOrEqual(0);
  });

  it('should set query category', () => {
    const trace = createTrace();

    trace.setQueryCategory('allocation');

    const payload = trace.finalize();

    expect(payload.trace.queryCategory).toBe('allocation');
  });
});

// ===========================================================================
// ToolSpanBuilder
// ===========================================================================

describe('ToolSpanBuilder', () => {
  it('should build a successful tool span', () => {
    const builder = new ToolSpanBuilder(
      'trace-001',
      'get_portfolio_context',
      { currency: 'USD' },
      1
    );
    const span = builder.end({
      status: 'success',
      toolOutput: { holdings: 5 }
    });

    expect(span.traceId).toBe('trace-001');
    expect(span.toolName).toBe('get_portfolio_context');
    expect(span.status).toBe('success');
    expect(span.error).toBeNull();
    expect(span.retryCount).toBe(0);
    expect(span.iterationIndex).toBe(1);
    expect(span.wasCorrectTool).toBeNull();
    expect(span.latencyMs).toBeGreaterThanOrEqual(0);
    expect(span.startedAt).toBeDefined();
    expect(span.endedAt).toBeDefined();
  });

  it('should build a failed tool span with error', () => {
    const builder = new ToolSpanBuilder(
      'trace-001',
      'get_market_data',
      { symbol: 'AAPL' },
      2
    );
    const span = builder.end({
      status: 'error',
      toolOutput: null,
      error: 'API rate limited'
    });

    expect(span.status).toBe('error');
    expect(span.error).toBe('API rate limited');
    expect(span.toolOutput).toBeNull();
  });

  it('should track retry count', () => {
    const builder = new ToolSpanBuilder('trace-001', 'search', {}, 1);

    builder.setRetryCount(3);

    const span = builder.end({ status: 'success', toolOutput: {} });

    expect(span.retryCount).toBe(3);
  });

  it('should set wasCorrectTool flag', () => {
    const builder = new ToolSpanBuilder('trace-001', 'search', {}, 1);
    const span = builder.end({
      status: 'success',
      toolOutput: {},
      wasCorrectTool: true
    });

    expect(span.wasCorrectTool).toBe(true);
  });
});

// ===========================================================================
// Eval Scorers
// ===========================================================================

describe('Eval Scorers', () => {
  function buildPayload(
    overrides: Partial<TelemetryPayload> = {}
  ): TelemetryPayload {
    return {
      trace: {
        traceId: 'trace-001',
        sessionId: 'session-001',
        userId: 'user-001',
        queryText: 'test query',
        queryCategory: 'general',
        responseText: 'test response',
        totalLatencyMs: 1500,
        llmLatencyMs: 1000,
        toolLatencyTotalMs: 300,
        overheadLatencyMs: 200,
        inputTokenCount: 500,
        outputTokenCount: 200,
        totalTokenCount: 700,
        estimatedCostUsd: 0.005,
        usedTools: true,
        toolNames: ['get_portfolio_context'],
        toolCallCount: 1,
        iterationCount: 1,
        guardrailsTriggered: [],
        success: true,
        error: null,
        aborted: false,
        model: 'openai/gpt-4o',
        timestamp: new Date().toISOString()
      },
      toolSpans: [
        {
          spanId: 'span-001',
          traceId: 'trace-001',
          toolName: 'get_portfolio_context',
          toolInput: {},
          toolOutput: {},
          latencyMs: 300,
          status: 'success',
          error: null,
          retryCount: 0,
          iterationIndex: 1,
          wasCorrectTool: true,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString()
        }
      ],
      verification: {
        traceId: 'trace-001',
        passed: true,
        confidenceScore: 0.95,
        hallucinationFlags: [],
        factCheckSources: ['portfolio_data'],
        domainViolations: [],
        warnings: [],
        errors: [],
        escalationTriggered: false,
        escalationReason: null
      },
      reactIterations: [],
      derived: {
        toolOverheadRatio: 0.2,
        costPerToolCall: 0.005,
        latencyPerIteration: 1500,
        toolSuccessRates: { get_portfolio_context: 1.0 }
      },
      ...overrides
    };
  }

  describe('scoreLatency', () => {
    it('should return 1.0 for <2s', () => {
      expect(scoreLatency(1500)).toBe(1.0);
    });

    it('should return 0.75 for <3s', () => {
      expect(scoreLatency(2500)).toBe(0.75);
    });

    it('should return 0.5 for <5s', () => {
      expect(scoreLatency(4000)).toBe(0.5);
    });

    it('should return 0.25 for <10s', () => {
      expect(scoreLatency(7000)).toBe(0.25);
    });

    it('should return 0.0 for >=10s', () => {
      expect(scoreLatency(15000)).toBe(0.0);
    });
  });

  describe('scoreCost', () => {
    it('should return 1.0 for <$0.05', () => {
      expect(scoreCost(0.01)).toBe(1.0);
    });

    it('should return 0.75 for <$0.10', () => {
      expect(scoreCost(0.08)).toBe(0.75);
    });

    it('should return 0.5 for <$0.50', () => {
      expect(scoreCost(0.3)).toBe(0.5);
    });

    it('should return 0.25 for <$1.00', () => {
      expect(scoreCost(0.75)).toBe(0.25);
    });

    it('should return 0.0 for >=$1.00', () => {
      expect(scoreCost(1.5)).toBe(0.0);
    });
  });

  describe('scoreSafety', () => {
    it('should return 1.0 for clean verification', () => {
      const payload = buildPayload();

      expect(scoreSafety(payload)).toBe(1.0);
    });

    it('should return 0.0 when escalation triggered', () => {
      const payload = buildPayload({
        verification: {
          ...buildPayload().verification,
          escalationTriggered: true,
          escalationReason: 'tax advice'
        }
      });

      expect(scoreSafety(payload)).toBe(0.0);
    });

    it('should return 0.25 for domain violations', () => {
      const payload = buildPayload({
        verification: {
          ...buildPayload().verification,
          domainViolations: ['invalid ticker']
        }
      });

      expect(scoreSafety(payload)).toBe(0.25);
    });

    it('should return 0.75 for warnings only', () => {
      const payload = buildPayload({
        verification: {
          ...buildPayload().verification,
          warnings: ['general market commentary']
        }
      });

      expect(scoreSafety(payload)).toBe(0.75);
    });
  });

  describe('scoreGroundedness', () => {
    it('should return 1.0 when verification passed with no hallucinations', () => {
      const payload = buildPayload();

      expect(scoreGroundedness(payload)).toBe(1.0);
    });

    it('should return ratio of grounded claims', () => {
      const payload = buildPayload({
        verification: {
          ...buildPayload().verification,
          passed: false,
          hallucinationFlags: ['fake claim'],
          factCheckSources: ['source1', 'source2']
        }
      });

      // 2 / (1 + 2) = 0.666...
      expect(scoreGroundedness(payload)).toBeCloseTo(0.667, 2);
    });
  });

  describe('scoreToolSelection', () => {
    it('should return 1.0 when no tools needed', () => {
      const payload = buildPayload({ toolSpans: [] });

      expect(scoreToolSelection(payload)).toBe(1.0);
    });

    it('should return 1.0 when all tools correct', () => {
      const payload = buildPayload();

      expect(scoreToolSelection(payload)).toBe(1.0);
    });

    it('should return 0.5 when tools not yet scored', () => {
      const payload = buildPayload({
        toolSpans: [
          {
            ...buildPayload().toolSpans[0],
            wasCorrectTool: null
          }
        ]
      });

      expect(scoreToolSelection(payload)).toBe(0.5);
    });
  });

  describe('scoreToolExecution', () => {
    it('should return 1.0 when all tools succeed', () => {
      const payload = buildPayload();

      expect(scoreToolExecution(payload)).toBe(1.0);
    });

    it('should return 0.5 when half of tools fail', () => {
      const payload = buildPayload({
        toolSpans: [
          { ...buildPayload().toolSpans[0], status: 'success' },
          { ...buildPayload().toolSpans[0], status: 'error' }
        ]
      });

      expect(scoreToolExecution(payload)).toBe(0.5);
    });
  });

  describe('computeAllScores', () => {
    it('should compute all scores for a healthy payload', () => {
      const payload = buildPayload();
      const scores = computeAllScores(payload);

      expect(scores.latency).toBe(1.0); // 1500ms < 2000ms
      expect(scores.cost).toBe(1.0); // $0.005 < $0.05
      expect(scores.safety).toBe(1.0); // no escalation
      expect(scores.groundedness).toBe(1.0); // passed, no hallucinations
      expect(scores.toolSelection).toBe(1.0); // all correct
      expect(scores.toolExecution).toBe(1.0); // all success
      expect(scores.correctness).toBe(0.95); // proxy from confidence
      expect(scores.relevance).toBe(0.95); // proxy from confidence
    });
  });
});
