/**
 * AI Compliance Tests
 *
 * Verifies the 5 compliance gaps are closed:
 *   A) User feedback mechanism (D6)
 *   B) Measured latency baselines p50/p95 (F)
 *   C) Hallucination rate aggregate (F)
 *   D) Verification accuracy (F)
 *   E) Cost projections (G2)
 *
 * These tests do NOT require Docker/Postgres — they mock PrismaService
 * and test pure business logic + controller wiring.
 */

// ─── A) USER FEEDBACK MECHANISM ─────────────────────────────────────────

describe('A) User Feedback Mechanism', () => {
  describe('AiMetricsService.createFeedback', () => {
    it('should persist feedback with correct fields', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        id: 'fb-001',
        userId: 'user-1',
        rating: 'UP',
        conversationId: 'conv-1',
        traceId: 'trace-1',
        messageId: null,
        comment: 'Great answer!',
        metadata: null,
        createdAt: new Date()
      });

      const prismaService = {
        aiFeedback: { create: mockCreate }
      } as any;

      // Dynamic import to avoid module-level issues
      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      const result = await service.createFeedback({
        userId: 'user-1',
        rating: 'UP' as any,
        conversationId: 'conv-1',
        traceId: 'trace-1',
        comment: 'Great answer!'
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          rating: 'UP',
          conversationId: 'conv-1',
          traceId: 'trace-1',
          comment: 'Great answer!'
        })
      });
      expect(result.id).toBe('fb-001');
    });

    it('should handle feedback with minimal fields (only rating)', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        id: 'fb-002',
        userId: 'user-2',
        rating: 'DOWN',
        conversationId: null,
        traceId: null,
        messageId: null,
        comment: null,
        metadata: null,
        createdAt: new Date()
      });

      const prismaService = {
        aiFeedback: { create: mockCreate }
      } as any;

      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      const result = await service.createFeedback({
        userId: 'user-2',
        rating: 'DOWN' as any
      });

      expect(result.id).toBe('fb-002');
      expect(mockCreate.mock.calls[0][0].data.conversationId).toBeNull();
      expect(mockCreate.mock.calls[0][0].data.traceId).toBeNull();
    });
  });

  describe('BraintrustTelemetryService.logFeedbackEvent', () => {
    it('should log feedback event to Braintrust logger', async () => {
      const { BraintrustTelemetryService } = await import(
        '../telemetry/braintrust-telemetry.service'
      );

      const configService = {
        get: jest.fn().mockReturnValue(undefined)
      } as any;
      const service = new BraintrustTelemetryService(configService);

      // Manually enable and set mock logger
      (service as any).enabled = true;
      const mockLog = jest.fn();
      (service as any).logger = { log: mockLog };

      await service.logFeedbackEvent({
        feedbackId: 'fb-001',
        userId: 'user-1',
        rating: 'UP',
        traceId: 'trace-1',
        conversationId: 'conv-1'
      });

      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'feedback-fb-001',
          scores: { user_satisfaction: 1.0 },
          metadata: expect.objectContaining({
            type: 'user_feedback',
            rating: 'UP',
            traceId: 'trace-1'
          })
        })
      );
    });

    it('should score DOWN feedback as 0.0', async () => {
      const { BraintrustTelemetryService } = await import(
        '../telemetry/braintrust-telemetry.service'
      );

      const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
      const service = new BraintrustTelemetryService(configService);
      (service as any).enabled = true;
      const mockLog = jest.fn();
      (service as any).logger = { log: mockLog };

      await service.logFeedbackEvent({
        feedbackId: 'fb-002',
        userId: 'user-2',
        rating: 'DOWN',
        traceId: null,
        conversationId: null
      });

      expect(mockLog.mock.calls[0][0].scores.user_satisfaction).toBe(0.0);
    });
  });
});

// ─── B) MEASURED LATENCY BASELINES (p50/p95) ────────────────────────────

describe('B) Measured Latency Baselines', () => {
  describe('computePercentile (pure function)', () => {
    let computePercentile: (sorted: number[], percentile: number) => number;

    beforeAll(async () => {
      const mod = await import('../metrics/ai-metrics.service');
      computePercentile = mod.computePercentile;
    });

    it('should return 0 for empty array', () => {
      expect(computePercentile([], 50)).toBe(0);
    });

    it('should return the single value for a 1-element array', () => {
      expect(computePercentile([42], 50)).toBe(42);
      expect(computePercentile([42], 95)).toBe(42);
    });

    it('should compute p50 correctly for sorted even-length array', () => {
      const sorted = [100, 200, 300, 400];
      // p50 index = 0.5 * 3 = 1.5 → interpolate 200 and 300
      expect(computePercentile(sorted, 50)).toBe(250);
    });

    it('should compute p50 correctly for sorted odd-length array', () => {
      const sorted = [100, 200, 300, 400, 500];
      // p50 index = 0.5 * 4 = 2.0 → exactly 300
      expect(computePercentile(sorted, 50)).toBe(300);
    });

    it('should compute p95 correctly', () => {
      const sorted = Array.from({ length: 100 }, (_, i) => (i + 1) * 10);
      // p95 index = 0.95 * 99 = 94.05
      const result = computePercentile(sorted, 95);
      expect(result).toBeGreaterThanOrEqual(950);
      expect(result).toBeLessThanOrEqual(960);
    });

    it('should compute p0 as first element', () => {
      expect(computePercentile([10, 20, 30], 0)).toBe(10);
    });

    it('should compute p100 as last element', () => {
      expect(computePercentile([10, 20, 30], 100)).toBe(30);
    });
  });

  describe('computeLatencyPercentiles (composite)', () => {
    let computeLatencyPercentiles: (
      values: number[]
    ) => { p50: number; p95: number; count: number; min: number; max: number; mean: number };

    beforeAll(async () => {
      const mod = await import('../metrics/ai-metrics.service');
      computeLatencyPercentiles = mod.computeLatencyPercentiles;
    });

    it('should return zeros for empty input', () => {
      const result = computeLatencyPercentiles([]);
      expect(result).toEqual({
        p50: 0,
        p95: 0,
        count: 0,
        min: 0,
        max: 0,
        mean: 0
      });
    });

    it('should compute correct stats for typical latencies', () => {
      // Simulate 20 traces with latencies from 500ms to 5000ms
      const values = [
        500, 800, 1000, 1200, 1500, 1800, 2000, 2200, 2500, 2800, 3000,
        3200, 3500, 3800, 4000, 4200, 4500, 4700, 4800, 5000
      ];

      const result = computeLatencyPercentiles(values);

      expect(result.count).toBe(20);
      expect(result.min).toBe(500);
      expect(result.max).toBe(5000);
      expect(result.p50).toBeGreaterThanOrEqual(2500);
      expect(result.p50).toBeLessThanOrEqual(3000);
      expect(result.p95).toBeGreaterThanOrEqual(4700);
      expect(result.p95).toBeLessThanOrEqual(5000);
      expect(result.mean).toBeCloseTo(2850, 0);
    });
  });

  describe('AiMetricsService.getLatencyBaselines', () => {
    it('should query metrics within time window and return percentiles', async () => {
      const mockFindMany = jest.fn().mockResolvedValue([
        { totalLatencyMs: 1000, llmLatencyMs: 800, toolLatencyTotalMs: 150 },
        { totalLatencyMs: 2000, llmLatencyMs: 1500, toolLatencyTotalMs: 300 },
        { totalLatencyMs: 3000, llmLatencyMs: 2200, toolLatencyTotalMs: 500 },
        { totalLatencyMs: 4000, llmLatencyMs: 3000, toolLatencyTotalMs: 700 },
        { totalLatencyMs: 5000, llmLatencyMs: 3800, toolLatencyTotalMs: 900 }
      ]);

      const prismaService = {
        aiTraceMetric: { findMany: mockFindMany }
      } as any;

      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      const result = await service.getLatencyBaselines(7);

      expect(mockFindMany).toHaveBeenCalledTimes(1);
      expect(result.days).toBe(7);
      expect(result.traceCount).toBe(5);
      expect(result.totalLatency.p50).toBe(3000);
      expect(result.totalLatency.p95).toBeGreaterThanOrEqual(4600);
      expect(result.totalLatency.count).toBe(5);
      expect(result.llmLatency.p50).toBe(2200);
      expect(result.toolLatency.p50).toBe(500);
    });
  });
});

// ─── C) HALLUCINATION RATE (AGGREGATE) ──────────────────────────────────

describe('C) Hallucination Rate', () => {
  describe('AiMetricsService.getHallucinationRate', () => {
    it('should compute rate=0.2 when 2/10 traces have hallucinations', async () => {
      // 10 metrics, 2 with hallucinationFlagCount > 0
      const mockData = [
        { hallucinationFlagCount: 0 },
        { hallucinationFlagCount: 0 },
        { hallucinationFlagCount: 2 }, // hallucinated
        { hallucinationFlagCount: 0 },
        { hallucinationFlagCount: 0 },
        { hallucinationFlagCount: 0 },
        { hallucinationFlagCount: 1 }, // hallucinated
        { hallucinationFlagCount: 0 },
        { hallucinationFlagCount: 0 },
        { hallucinationFlagCount: 0 }
      ];

      const prismaService = {
        aiTraceMetric: { findMany: jest.fn().mockResolvedValue(mockData) }
      } as any;

      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      const result = await service.getHallucinationRate(7);

      expect(result.traceCount).toBe(10);
      expect(result.tracesWithHallucinations).toBe(2);
      expect(result.hallucinationRate).toBeCloseTo(0.2);
      expect(result.definition).toContain('hallucinationFlags.length > 0');
    });

    it('should return rate=0 when no traces have hallucinations', async () => {
      const prismaService = {
        aiTraceMetric: {
          findMany: jest.fn().mockResolvedValue([
            { hallucinationFlagCount: 0 },
            { hallucinationFlagCount: 0 },
            { hallucinationFlagCount: 0 }
          ])
        }
      } as any;

      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      const result = await service.getHallucinationRate(7);

      expect(result.hallucinationRate).toBe(0);
    });

    it('should return rate=0 when no traces exist', async () => {
      const prismaService = {
        aiTraceMetric: { findMany: jest.fn().mockResolvedValue([]) }
      } as any;

      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      const result = await service.getHallucinationRate(7);

      expect(result.hallucinationRate).toBe(0);
      expect(result.traceCount).toBe(0);
    });
  });
});

// ─── D) VERIFICATION ACCURACY ───────────────────────────────────────────

describe('D) Verification Accuracy', () => {
  describe('AiMetricsService.getVerificationAccuracy', () => {
    it('should compute accuracy from labels + metrics alignment', async () => {
      // 4 labels, 4 matching metrics
      const mockLabels = [
        {
          traceId: 't1',
          isHallucination: false,
          verificationShouldHavePassed: true
        },
        {
          traceId: 't2',
          isHallucination: true,
          verificationShouldHavePassed: false
        },
        {
          traceId: 't3',
          isHallucination: false,
          verificationShouldHavePassed: true
        },
        {
          traceId: 't4',
          isHallucination: true,
          verificationShouldHavePassed: false
        }
      ];

      const mockMetrics = [
        {
          traceId: 't1',
          verificationPassed: true,
          hallucinationFlagCount: 0
        }, // correct on both
        {
          traceId: 't2',
          verificationPassed: false,
          hallucinationFlagCount: 2
        }, // correct on both
        {
          traceId: 't3',
          verificationPassed: false,
          hallucinationFlagCount: 0
        }, // wrong verification (should be true)
        {
          traceId: 't4',
          verificationPassed: false,
          hallucinationFlagCount: 0
        } // correct verification, wrong hallucination detection
      ];

      const prismaService = {
        aiVerificationLabel: {
          findMany: jest.fn().mockResolvedValue(mockLabels)
        },
        aiTraceMetric: { findMany: jest.fn().mockResolvedValue(mockMetrics) }
      } as any;

      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      const result = await service.getVerificationAccuracy(30);

      expect(result.labelCount).toBe(4);
      expect(result.matchedCount).toBe(4);
      // t1: verificationPassed=true==true ✓, hallucination=0==false ✓ → 2 correct
      // t2: verificationPassed=false==false ✓, hallucination=2>0==true ✓ → 2 correct
      // t3: verificationPassed=false!=true ✗, hallucination=0==false ✓ → 1 correct
      // t4: verificationPassed=false==false ✓, hallucination=0!=true ✗ → 1 correct
      // Total: 6/8 = 0.75
      expect(result.accuracy).toBeCloseTo(0.75);
      expect(result.details.correctVerificationDecisions).toBe(3);
      expect(result.details.correctHallucinationDetections).toBe(3);
    });

    it('should return null accuracy when no labels exist', async () => {
      const prismaService = {
        aiVerificationLabel: { findMany: jest.fn().mockResolvedValue([]) },
        aiTraceMetric: { findMany: jest.fn().mockResolvedValue([]) }
      } as any;

      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      const result = await service.getVerificationAccuracy(30);

      expect(result.labelCount).toBe(0);
      expect(result.accuracy).toBeNull();
    });

    it('should handle labels without matching metrics gracefully', async () => {
      const mockLabels = [
        {
          traceId: 'orphan-1',
          isHallucination: false,
          verificationShouldHavePassed: true
        }
      ];

      const prismaService = {
        aiVerificationLabel: {
          findMany: jest.fn().mockResolvedValue(mockLabels)
        },
        aiTraceMetric: { findMany: jest.fn().mockResolvedValue([]) } // no matching metrics
      } as any;

      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      const result = await service.getVerificationAccuracy(30);

      expect(result.labelCount).toBe(1);
      expect(result.matchedCount).toBe(0);
      expect(result.accuracy).toBeNull(); // 0 checks → null
    });
  });

  describe('AiMetricsService.createVerificationLabel', () => {
    it('should persist label with correct fields', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        id: 'vl-001',
        traceId: 'trace-1',
        labeledByUserId: 'user-admin',
        isHallucination: true,
        verificationShouldHavePassed: false,
        notes: 'Response fabricated a holding',
        createdAt: new Date()
      });

      const prismaService = {
        aiVerificationLabel: { create: mockCreate }
      } as any;

      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      const result = await service.createVerificationLabel({
        labeledByUserId: 'user-admin',
        traceId: 'trace-1',
        isHallucination: true,
        verificationShouldHavePassed: false,
        notes: 'Response fabricated a holding'
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          traceId: 'trace-1',
          isHallucination: true,
          verificationShouldHavePassed: false
        })
      });
      expect(result.id).toBe('vl-001');
    });
  });
});

// ─── E) COST PROJECTIONS ────────────────────────────────────────────────

describe('E) Cost Projections', () => {
  describe('computeCostProjections', () => {
    let computeCostProjections: any;
    let formatProjectionsMarkdown: any;
    let DEFAULT_ASSUMPTIONS: any;

    beforeAll(async () => {
      const mod = await import('../telemetry/cost-projections');
      computeCostProjections = mod.computeCostProjections;
      formatProjectionsMarkdown = mod.formatProjectionsMarkdown;
      DEFAULT_ASSUMPTIONS = mod.DEFAULT_ASSUMPTIONS;
    });

    it('should compute projections for 100, 1k, 10k, 100k users', () => {
      const rows = computeCostProjections([100, 1_000, 10_000, 100_000]);

      expect(rows).toHaveLength(4);
      expect(rows[0].users).toBe(100);
      expect(rows[1].users).toBe(1_000);
      expect(rows[2].users).toBe(10_000);
      expect(rows[3].users).toBe(100_000);

      // Each row should have positive costs
      for (const row of rows) {
        expect(row.monthlyCostUsd).toBeGreaterThan(0);
        expect(row.costPerQuery).toBeGreaterThan(0);
        expect(row.costPerUser).toBeGreaterThan(0);
        expect(row.queriesPerMonth).toBeGreaterThan(0);
        expect(row.inputTokensPerMonth).toBeGreaterThan(0);
        expect(row.outputTokensPerMonth).toBeGreaterThan(0);
      }
    });

    it('should scale linearly with user count', () => {
      const rows = computeCostProjections([100, 1_000]);

      // 10x users → 10x cost
      const ratio = rows[1].monthlyCostUsd / rows[0].monthlyCostUsd;
      expect(ratio).toBeCloseTo(10, 1);
    });

    it('should use MODEL_PRICING for cost calculation', () => {
      const rows = computeCostProjections([1], DEFAULT_ASSUMPTIONS);
      const row = rows[0];

      // Verify cost is positive and reasonable
      // 1 user × 3 queries/day × 30 days = 90 queries
      expect(row.queriesPerMonth).toBe(90);
      expect(row.monthlyCostUsd).toBeGreaterThan(0);
      expect(row.monthlyCostUsd).toBeLessThan(10); // 1 user shouldn't cost $10
    });

    it('should produce valid markdown table', () => {
      const rows = computeCostProjections([100, 1_000, 10_000, 100_000]);
      const markdown = formatProjectionsMarkdown(rows);

      expect(markdown).toContain('# AI Chat Production Cost Projections');
      expect(markdown).toContain('## Assumptions');
      expect(markdown).toContain('## Cost Projections');
      expect(markdown).toContain('| Users |');
      expect(markdown).toContain('anthropic/claude-sonnet-4');
      // Verify all 4 user tiers appear
      expect(markdown).toContain('100');
      expect(markdown).toContain('1,000');
      expect(markdown).toContain('10,000');
      expect(markdown).toContain('100,000');
    });
  });

  describe('cost projection snapshot', () => {
    it('should match snapshot for default assumptions', async () => {
      const { computeCostProjections, DEFAULT_ASSUMPTIONS } = await import(
        '../telemetry/cost-projections'
      );

      const rows = computeCostProjections(
        [100, 1_000, 10_000, 100_000],
        DEFAULT_ASSUMPTIONS
      );

      // Sanitize to remove non-deterministic parts (none here, but future-proof)
      const sanitized = rows.map((row) => ({
        users: row.users,
        queriesPerMonth: row.queriesPerMonth,
        costPerQuery: row.costPerQuery,
        costPerUser: row.costPerUser
      }));

      expect(sanitized).toMatchSnapshot();
    });
  });
});

// ─── TRACE METRIC PERSISTENCE ───────────────────────────────────────────

describe('Trace Metric Persistence', () => {
  describe('AiMetricsService.persistTraceMetric', () => {
    it('should persist metric with correct fields', async () => {
      const mockCreate = jest.fn().mockResolvedValue({ id: 'metric-001' });

      const prismaService = {
        aiTraceMetric: { create: mockCreate }
      } as any;

      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      await service.persistTraceMetric({
        traceId: 'trace-1',
        userId: 'user-1',
        totalLatencyMs: 2500,
        llmLatencyMs: 2000,
        toolLatencyTotalMs: 300,
        toolCallCount: 2,
        usedTools: true,
        hallucinationFlagCount: 0,
        verificationPassed: true,
        estimatedCostUsd: 0.05
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          traceId: 'trace-1',
          totalLatencyMs: 2500,
          hallucinationFlagCount: 0,
          verificationPassed: true
        })
      });
    });

    it('should swallow DB errors without throwing', async () => {
      const mockCreate = jest
        .fn()
        .mockRejectedValue(new Error('DB connection failed'));

      const prismaService = {
        aiTraceMetric: { create: mockCreate }
      } as any;

      const { AiMetricsService } = await import(
        '../metrics/ai-metrics.service'
      );
      const service = new AiMetricsService(prismaService);

      // Should NOT throw
      await expect(
        service.persistTraceMetric({
          traceId: 'trace-2',
          userId: 'user-1',
          totalLatencyMs: 1000,
          llmLatencyMs: 800,
          toolLatencyTotalMs: 100,
          toolCallCount: 1,
          usedTools: true,
          hallucinationFlagCount: 0,
          verificationPassed: true,
          estimatedCostUsd: 0.03
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('BraintrustTelemetryService.logTrace calls persistTraceMetric', () => {
    it('should call metricsService.persistTraceMetric when wired', async () => {
      const { BraintrustTelemetryService } = await import(
        '../telemetry/braintrust-telemetry.service'
      );

      const configService = {
        get: jest.fn().mockReturnValue(undefined)
      } as any;
      const service = new BraintrustTelemetryService(configService);

      // Mock the metrics service
      const mockPersist = jest.fn().mockResolvedValue(undefined);
      const mockMetricsService = {
        persistTraceMetric: mockPersist
      } as any;
      service.setMetricsService(mockMetricsService);

      // Telemetry is disabled (no Braintrust key), but metric persistence should still work
      const payload = buildMinimalPayload();

      await service.logTrace(payload);

      // Wait for async fire-and-forget
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockPersist).toHaveBeenCalledTimes(1);
      expect(mockPersist).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: payload.trace.traceId,
          userId: payload.trace.userId,
          totalLatencyMs: payload.trace.totalLatencyMs
        })
      );
    });
  });
});

// ─── Helper: Build minimal TelemetryPayload ─────────────────────────────

function buildMinimalPayload() {
  return {
    trace: {
      traceId: 'test-trace-001',
      sessionId: 'sess-001',
      userId: 'user-1',
      queryText: 'Test query',
      queryCategory: 'general' as const,
      responseText: 'Test response',
      totalLatencyMs: 2500,
      llmLatencyMs: 2000,
      toolLatencyTotalMs: 300,
      overheadLatencyMs: 200,
      inputTokenCount: 100,
      outputTokenCount: 50,
      totalTokenCount: 150,
      estimatedCostUsd: 0.05,
      usedTools: true,
      toolNames: ['getQuote'],
      toolCallCount: 1,
      iterationCount: 1,
      guardrailsTriggered: [],
      success: true,
      error: null,
      aborted: false,
      model: 'test-model',
      timestamp: new Date().toISOString()
    },
    toolSpans: [],
    verification: {
      traceId: 'test-trace-001',
      passed: true,
      confidenceScore: 0.9,
      hallucinationFlags: [],
      factCheckSources: ['getQuote'],
      domainViolations: [],
      warnings: [],
      errors: [],
      escalationTriggered: false,
      escalationReason: null
    },
    reactIterations: [],
    derived: {
      toolOverheadRatio: 0.12,
      costPerToolCall: 0.05,
      latencyPerIteration: 2500,
      toolSuccessRates: { getQuote: 1.0 },
      failedToolCount: 0
    }
  };
}
