import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { AiMetricsService } from '../metrics/ai-metrics.service';
import {
  getMarketDataCacheStats,
  resetMarketDataCacheHits
} from '../providers';
import { scoreGroundedness } from './eval-scorers';
import type {
  DerivedMetrics,
  GroundednessMode,
  GuardrailType,
  ReactIteration,
  TelemetryPayload,
  ToolPolicyDecision,
  ToolSpan,
  TraceLevelSummary,
  VerificationSummary
} from './telemetry.interfaces';

// ─── Config Versioning ──────────────────────────────────────────────
// Bump these when you change the system prompt or tool schemas.
const SYSTEM_PROMPT_VERSION = '2.1.0'; // multimodal + image analysis
const TOOL_SCHEMA_VERSION = '1.3.0'; // yahoo-finance2 v3

/**
 * BraintrustTelemetryService
 *
 * Logs three core layers per AI query to Braintrust:
 *   1. Trace-Level Summary  — top-level request metrics
 *   2. Tool Spans           — per-tool-call timing, input/output, status
 *   3. Verification Summary — hallucination, confidence, domain violations
 *
 * Uses the Braintrust SDK's `initLogger` for structured experiment logging.
 */
@Injectable()
export class BraintrustTelemetryService implements OnModuleInit {
  private logger: any; // Braintrust logger instance
  private enabled = false;
  private readonly nestLogger = new Logger(BraintrustTelemetryService.name);

  private metricsService: AiMetricsService | null = null;

  public constructor(
    private readonly configurationService: ConfigurationService
  ) {}

  /**
   * Set the metrics service for DB persistence of trace metrics.
   * Called by AiModule after both services are initialized to avoid circular deps.
   */
  public setMetricsService(service: AiMetricsService): void {
    this.metricsService = service;
  }

  public async onModuleInit() {
    const apiKey = this.configurationService.get('BRAINTRUST_API_KEY');
    const project = this.configurationService.get('BRAINTRUST_PROJECT');

    if (!apiKey) {
      this.nestLogger.warn(
        'BRAINTRUST_API_KEY not set — telemetry disabled. Set it in Railway to enable logging.'
      );

      return;
    }

    try {
      const braintrust = await import('braintrust');

      this.logger = braintrust.initLogger({
        apiKey,
        projectName: project || 'ghostfolio-ai'
      });

      this.enabled = true;
      this.nestLogger.log(
        `Braintrust telemetry enabled for project "${project || 'ghostfolio-ai'}"`
      );
    } catch (error) {
      this.nestLogger.error(
        `Failed to initialize Braintrust: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // =========================================================================
  // Public API — called by AiService
  // =========================================================================

  /**
   * Create a new trace context. Call this at the start of every AI query.
   */
  public startTrace(params: {
    sessionId: string;
    userId: string;
    queryText: string;
    model: string;
  }): TraceContext {
    return new TraceContext({
      traceId: randomUUID(),
      sessionId: params.sessionId,
      userId: params.userId,
      queryText: params.queryText,
      model: params.model,
      startTime: Date.now()
    });
  }

  /**
   * Log a completed trace with all spans and verification to Braintrust.
   *
   * Architecture:
   *   Root span  — accurate start/end timing + metrics + metadata + tags
   *   └─ LLM span — covers the generateText() call
   *   └─ Tool span × N — one real child span per tool invocation
   *   └─ Verification span — groundedness check
   */
  public async logTrace(payload: TelemetryPayload): Promise<void> {
    // ── Always persist trace metric to DB (independent of Braintrust) ──
    if (this.metricsService) {
      this.metricsService
        .persistTraceMetric({
          traceId: payload.trace.traceId,
          userId: payload.trace.userId,
          totalLatencyMs: payload.trace.totalLatencyMs,
          llmLatencyMs: payload.trace.llmLatencyMs,
          toolLatencyTotalMs: payload.trace.toolLatencyTotalMs,
          toolCallCount: payload.trace.toolCallCount,
          usedTools: payload.trace.usedTools,
          hallucinationFlagCount:
            payload.verification.hallucinationFlags.length,
          verificationPassed: payload.verification.passed,
          estimatedCostUsd: payload.trace.estimatedCostUsd
        })
        .catch((dbError) => {
          this.nestLogger.warn(
            `DB metric persist failed: ${dbError instanceof Error ? dbError.message : String(dbError)}`
          );
        });
    }

    if (!this.enabled || !this.logger) {
      this.nestLogger.debug(
        `Telemetry skip (disabled): trace=${payload.trace.traceId}`
      );

      return;
    }

    try {
      // ── Build tags for Braintrust filtering ─────────────────────────
      const tags: string[] = [
        payload.trace.queryCategory,
        payload.trace.success ? 'success' : 'error',
        payload.trace.usedTools ? 'tools_used' : 'no_tools',
        payload.toolPolicyDecision,
        payload.groundednessMode
      ];

      if (payload.trace.aborted) {
        tags.push('aborted');
      }

      if (payload.trace.guardrailsTriggered.length > 0) {
        tags.push('guardrail_triggered');
      }

      // ── 1. Root span with accurate timing + metrics ─────────────────
      const rootSpan = this.logger.startSpan({
        name: 'ai-chat',
        spanAttributes: { type: 'task' },
        startTime: payload.timing.startEpochS
      });

      rootSpan.log({
        id: payload.trace.traceId,
        input: payload.trace.queryText,
        output: payload.trace.responseText,
        tags,

        // ── Braintrust metrics layer (surfaced as table columns) ──────
        metrics: {
          start: payload.timing.startEpochS,
          end: payload.timing.endEpochS,
          total_latency_ms: payload.trace.totalLatencyMs,
          llm_latency_ms: payload.trace.llmLatencyMs,
          tool_latency_ms: payload.trace.toolLatencyTotalMs,
          overhead_latency_ms: payload.trace.overheadLatencyMs,
          total_tokens: payload.trace.totalTokenCount,
          input_tokens: payload.trace.inputTokenCount,
          output_tokens: payload.trace.outputTokenCount,
          estimated_cost_usd: payload.trace.estimatedCostUsd,
          tool_call_count: payload.trace.toolCallCount,
          iteration_count: payload.trace.iterationCount,
          confidence: payload.verification.confidenceScore
        },

        // ── Scores (eval dashboard) ──────────────────────────────────
        scores: {
          latency: payload.trace.success
            ? this.scoreLatency(payload.trace.totalLatencyMs)
            : 0,
          cost: payload.trace.success
            ? this.scoreCost(payload.trace.estimatedCostUsd)
            : 0,
          confidence: payload.verification.confidenceScore,
          safety: payload.verification.escalationTriggered ? 0 : 1,
          groundedness: scoreGroundedness(payload)
        },

        // ── Metadata (rich debug info) ───────────────────────────────
        metadata: {
          sessionId: payload.trace.sessionId,
          userId: payload.trace.userId,
          queryCategory: payload.trace.queryCategory,
          model: payload.trace.model,
          timestamp: payload.trace.timestamp,

          // Decision fields
          toolPolicyDecision: payload.toolPolicyDecision,
          groundednessMode: payload.groundednessMode,

          // Config versioning
          systemPromptVersion: payload.versions.systemPromptVersion,
          toolSchemaVersion: payload.versions.toolSchemaVersion,
          reactEnabled: payload.versions.reactEnabled,
          verificationEnabled: payload.versions.verificationEnabled,

          // Tool usage
          usedTools: payload.trace.usedTools,
          toolNames: payload.trace.toolNames,

          // Guardrails
          guardrailsTriggered: payload.trace.guardrailsTriggered,

          // Outcome
          success: payload.trace.success,
          error: payload.trace.error,
          aborted: payload.trace.aborted,

          // Verification summary
          verification: {
            passed: payload.verification.passed,
            confidenceScore: payload.verification.confidenceScore,
            hallucinationFlags: payload.verification.hallucinationFlags,
            factCheckSources: payload.verification.factCheckSources,
            domainViolations: payload.verification.domainViolations,
            warnings: payload.verification.warnings,
            errors: payload.verification.errors,
            escalationTriggered: payload.verification.escalationTriggered,
            escalationReason: payload.verification.escalationReason
          },

          // Derived / computed
          derived: {
            toolOverheadRatio: payload.derived.toolOverheadRatio,
            costPerToolCall: payload.derived.costPerToolCall,
            latencyPerIteration: payload.derived.latencyPerIteration,
            toolSuccessRates: payload.derived.toolSuccessRates,
            failedToolCount: payload.derived.failedToolCount
          },

          // Extended metadata
          requestShape: payload.trace.requestShape,
          toolDataVolume: payload.trace.toolDataVolume,
          providerMeta: payload.trace.providerMeta,
          cachingMeta: payload.trace.cachingMeta,
          answerQualitySignals: payload.trace.answerQualitySignals,

          // ReAct thought chain
          reactIterations: payload.reactIterations.map((iter) => ({
            iterationIndex: iter.iterationIndex,
            thought: iter.thought,
            action: iter.action,
            observation: iter.observation,
            decision: iter.decision,
            latencyMs: iter.latencyMs
          }))
        }
      });

      // ── 2. LLM child span ──────────────────────────────────────────
      if (payload.timing.llmStartEpochS > 0) {
        const llmSpan = rootSpan.startSpan({
          name: 'llm-generate',
          spanAttributes: { type: 'llm' },
          startTime: payload.timing.llmStartEpochS
        });

        llmSpan.log({
          metadata: {
            model: payload.trace.model,
            inputTokens: payload.trace.inputTokenCount,
            outputTokens: payload.trace.outputTokenCount
          },
          metrics: {
            start: payload.timing.llmStartEpochS,
            end: payload.timing.llmEndEpochS,
            tokens: payload.trace.totalTokenCount,
            cost: payload.trace.estimatedCostUsd
          }
        });

        llmSpan.end({ endTime: payload.timing.llmEndEpochS });
      }

      // ── 3. Tool child spans (one per tool invocation) ──────────────
      for (const span of payload.toolSpans) {
        const toolStartS = new Date(span.startedAt).getTime() / 1000;
        const toolEndS = new Date(span.endedAt).getTime() / 1000;

        const toolSpan = rootSpan.startSpan({
          name: `tool:${span.toolName}`,
          spanAttributes: { type: 'tool' },
          startTime: toolStartS
        });

        toolSpan.log({
          input: span.toolInput,
          output: span.toolOutput,
          metadata: {
            toolName: span.toolName,
            status: span.status,
            error: span.error,
            retryCount: span.retryCount,
            iterationIndex: span.iterationIndex,
            wasCorrectTool: span.wasCorrectTool,
            ...(span.providerName && { providerName: span.providerName }),
            ...(span.assetType && { assetType: span.assetType }),
            ...(span.normalizedSymbol && {
              normalizedSymbol: span.normalizedSymbol
            })
          },
          metrics: {
            start: toolStartS,
            end: toolEndS,
            latency_ms: span.latencyMs
          },
          scores: {
            success: span.status === 'success' ? 1 : 0
          }
        });

        toolSpan.end({ endTime: toolEndS });
      }

      // ── 4. Close root span ─────────────────────────────────────────
      rootSpan.end({ endTime: payload.timing.endEpochS });

      this.nestLogger.debug(
        `Logged trace ${payload.trace.traceId} — ${payload.trace.totalLatencyMs}ms, ${payload.toolSpans.length} tool spans, confidence=${payload.verification.confidenceScore}`
      );
    } catch (error) {
      this.nestLogger.error(
        `Failed to log trace to Braintrust: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Log a user feedback event to Braintrust (non-blocking).
   */
  public async logFeedbackEvent(params: {
    feedbackId: string;
    userId: string;
    rating: string;
    traceId: string | null;
    conversationId: string | null;
  }): Promise<void> {
    if (!this.enabled || !this.logger) {
      return;
    }

    try {
      this.logger.log({
        id: `feedback-${params.feedbackId}`,
        input: `User feedback: ${params.rating}`,
        output: params.rating,
        metadata: {
          type: 'user_feedback',
          feedbackId: params.feedbackId,
          userId: params.userId,
          rating: params.rating,
          traceId: params.traceId,
          conversationId: params.conversationId,
          timestamp: new Date().toISOString()
        },
        scores: {
          user_satisfaction: params.rating === 'UP' ? 1.0 : 0.0
        }
      });
    } catch (error) {
      this.nestLogger.warn(
        `Failed to log feedback event: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Flush pending logs (call on app shutdown or after critical queries).
   */
  public async flush(): Promise<void> {
    if (this.enabled && this.logger) {
      try {
        await this.logger.flush();
      } catch (error) {
        this.nestLogger.error(
          `Braintrust flush failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  // =========================================================================
  // Scoring helpers (inline scores for Braintrust dashboard)
  // =========================================================================

  /** 1.0 = <2s, 0.5 = <5s, 0.0 = >=5s */
  private scoreLatency(totalMs: number): number {
    if (totalMs < 2000) {
      return 1.0;
    }

    if (totalMs < 5000) {
      return 0.5;
    }

    return 0.0;
  }

  /** 1.0 = <$0.10, 0.5 = <$1.00, 0.0 = >=$1.00 */
  private scoreCost(costUsd: number): number {
    if (costUsd < 0.1) {
      return 1.0;
    }

    if (costUsd < 1.0) {
      return 0.5;
    }

    return 0.0;
  }
}

// ===========================================================================
// TraceContext — mutable builder used during a single AI query lifecycle
// ===========================================================================

export class TraceContext {
  public readonly traceId: string;
  public readonly sessionId: string;
  public readonly userId: string;
  public readonly queryText: string;
  public readonly model: string;
  private readonly startTime: number;

  private responseText = '';
  private queryCategory: TraceLevelSummary['queryCategory'] = 'general';
  private llmStartTime = 0;
  private llmEndTime = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private estimatedCostUsd = 0;
  private success = true;
  private error: string | null = null;
  private aborted = false;
  private iterationCount = 0;
  private historyMessageCount = 0;
  private guardrailsTriggered: GuardrailType[] = [];

  private toolSpans: ToolSpan[] = [];
  private reactIterations: ReactIteration[] = [];
  private verification: VerificationSummary;

  public constructor(params: {
    traceId: string;
    sessionId: string;
    userId: string;
    queryText: string;
    model: string;
    startTime: number;
  }) {
    this.traceId = params.traceId;
    this.sessionId = params.sessionId;
    this.userId = params.userId;
    this.queryText = params.queryText;
    this.model = params.model;
    this.startTime = params.startTime;

    // Default verification (everything clean)
    this.verification = {
      traceId: params.traceId,
      passed: true,
      confidenceScore: 1.0,
      hallucinationFlags: [],
      factCheckSources: [],
      domainViolations: [],
      warnings: [],
      errors: [],
      escalationTriggered: false,
      escalationReason: null
    };
  }

  // ── Setters ──────────────────────────────────────────────────────────────

  public setResponse(text: string): void {
    this.responseText = text;
  }

  public setQueryCategory(category: TraceLevelSummary['queryCategory']): void {
    this.queryCategory = category;
  }

  public markLlmStart(): void {
    this.llmStartTime = Date.now();
  }

  public markLlmEnd(): void {
    this.llmEndTime = Date.now();
  }

  public setTokens(input: number, output: number): void {
    this.inputTokens = input;
    this.outputTokens = output;
  }

  public setCost(costUsd: number): void {
    this.estimatedCostUsd = costUsd;
  }

  public markError(errorMessage: string): void {
    this.success = false;
    this.error = errorMessage;
  }

  public markAborted(): void {
    this.aborted = true;
    this.success = false;
  }

  public setIterationCount(count: number): void {
    this.iterationCount = count;
  }

  public setHistoryMessageCount(count: number): void {
    this.historyMessageCount = count;
  }

  public addGuardrail(guardrail: GuardrailType): void {
    this.guardrailsTriggered.push(guardrail);
  }

  // ── Tool Span recording ──────────────────────────────────────────────────

  public startToolSpan(
    toolName: string,
    toolInput: Record<string, unknown>,
    iterationIndex: number
  ): ToolSpanBuilder {
    return new ToolSpanBuilder(
      this.traceId,
      toolName,
      toolInput,
      iterationIndex
    );
  }

  public addToolSpan(span: ToolSpan): void {
    this.toolSpans.push(span);
  }

  // ── ReAct iteration recording ────────────────────────────────────────────

  public addReactIteration(iteration: Omit<ReactIteration, 'traceId'>): void {
    this.reactIterations.push({
      ...iteration,
      traceId: this.traceId
    });
  }

  // ── Verification ─────────────────────────────────────────────────────────

  public setVerification(
    verification: Omit<VerificationSummary, 'traceId'>
  ): void {
    this.verification = { ...verification, traceId: this.traceId };
  }

  public addHallucinationFlag(flag: string): void {
    this.verification.hallucinationFlags.push(flag);
    this.verification.passed = false;
  }

  public addDomainViolation(violation: string): void {
    this.verification.domainViolations.push(violation);
    this.verification.passed = false;
  }

  public addWarning(warning: string): void {
    this.verification.warnings.push(warning);
  }

  public setConfidence(score: number): void {
    this.verification.confidenceScore = Math.max(0, Math.min(1, score));
  }

  public triggerEscalation(reason: string): void {
    this.verification.escalationTriggered = true;
    this.verification.escalationReason = reason;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private estimateRowCount(output: Record<string, unknown> | null): number {
    if (!output) {
      return 0;
    }

    // Look for common array fields in tool output data
    const data = output.data ?? output;

    if (!data || typeof data !== 'object') {
      return 0;
    }

    let rows = 0;

    for (const value of Object.values(data as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        rows += value.length;
      }
    }

    return rows || 1; // At least 1 row if data exists
  }

  // ── Finalize ─────────────────────────────────────────────────────────────

  /**
   * Build the complete TelemetryPayload ready for Braintrust logging.
   */
  public finalize(): TelemetryPayload {
    const endTime = Date.now();
    const totalLatencyMs = endTime - this.startTime;
    const llmLatencyMs =
      this.llmEndTime > 0 ? this.llmEndTime - this.llmStartTime : 0;
    const toolLatencyTotalMs = this.toolSpans.reduce(
      (sum, span) => sum + span.latencyMs,
      0
    );
    const overheadLatencyMs = Math.max(
      0,
      totalLatencyMs - llmLatencyMs - toolLatencyTotalMs
    );

    const toolNames = [...new Set(this.toolSpans.map((s) => s.toolName))];

    // ── Extended metadata computation ─────────────────────────────────
    const requestShape = {
      historyMessageCount: this.historyMessageCount,
      userMessageChars: this.queryText.length,
      userMessageTokensEstimate: Math.ceil(this.queryText.length / 4)
    };

    // Tool data volume
    const perToolVolume: {
      toolName: string;
      outputBytes: number;
      outputRows: number;
    }[] = [];
    let toolOutputBytesTotal = 0;
    let toolOutputRowsTotal = 0;

    for (const span of this.toolSpans) {
      const outputStr = span.toolOutput ? JSON.stringify(span.toolOutput) : '';
      const bytes = outputStr.length;
      const rows = this.estimateRowCount(span.toolOutput);

      perToolVolume.push({
        toolName: span.toolName,
        outputBytes: bytes,
        outputRows: rows
      });
      toolOutputBytesTotal += bytes;
      toolOutputRowsTotal += rows;
    }

    // Provider metadata (detect market tools)
    const marketToolNames = new Set([
      'getQuote',
      'getHistory',
      'getFundamentals',
      'getNews'
    ]);
    const hasMarketTools = toolNames.some((t) => marketToolNames.has(t));
    const providerErrors: string[] = [];
    let rateLimited = false;

    for (const span of this.toolSpans) {
      if (marketToolNames.has(span.toolName) && span.status === 'error') {
        providerErrors.push(`${span.toolName}: ${span.error ?? 'unknown'}`);
      }

      if (span.toolOutput && (span.toolOutput as any)?.meta?.rateLimited) {
        rateLimited = true;
      }
    }

    // Answer quality signals
    const lowerResp = this.responseText.toLowerCase();
    const numericClaimsCount = (
      this.responseText.match(/\d+[.,]?\d*\s*%|\$\s*\d+[.,]?\d*/g) ?? []
    ).length;

    const answerQualitySignals = {
      refused:
        lowerResp.includes('cannot predict') ||
        lowerResp.includes('cannot recommend') ||
        lowerResp.includes('not financial advice'),
      disclaimerShown:
        lowerResp.includes('disclaimer') ||
        lowerResp.includes('not investment advice') ||
        lowerResp.includes('not financial advice') ||
        lowerResp.includes('not trade advice'),
      numericClaimsCount,
      toolBackedNumericClaimsCount:
        this.toolSpans.length > 0 ? numericClaimsCount : null
    };

    const trace: TraceLevelSummary = {
      traceId: this.traceId,
      sessionId: this.sessionId,
      userId: this.userId,
      queryText: this.queryText,
      queryCategory: this.queryCategory,
      responseText: this.responseText,
      totalLatencyMs,
      llmLatencyMs,
      toolLatencyTotalMs,
      overheadLatencyMs,
      inputTokenCount: this.inputTokens,
      outputTokenCount: this.outputTokens,
      totalTokenCount: this.inputTokens + this.outputTokens,
      estimatedCostUsd: this.estimatedCostUsd,
      usedTools: this.toolSpans.length > 0,
      toolNames,
      toolCallCount: this.toolSpans.length,
      iterationCount: this.iterationCount,
      guardrailsTriggered: this.guardrailsTriggered,
      success: this.success,
      error: this.error,
      aborted: this.aborted,
      model: this.model,
      timestamp: new Date(endTime).toISOString(),
      requestShape,
      toolDataVolume: {
        toolOutputBytesTotal,
        toolOutputRowsTotal,
        perTool: perToolVolume
      },
      providerMeta: hasMarketTools
        ? {
            marketProviderName: process.env.MARKET_DATA_PROVIDER || 'yahoo',
            rateLimited,
            providerErrors
          }
        : undefined,
      cachingMeta: getMarketDataCacheStats(),
      answerQualitySignals
    };

    // Compute derived metrics
    const toolSuccessRates: Record<string, number> = {};

    for (const name of toolNames) {
      const spans = this.toolSpans.filter((s) => s.toolName === name);
      const successes = spans.filter((s) => s.status === 'success').length;

      toolSuccessRates[name] = spans.length > 0 ? successes / spans.length : 0;
    }

    const derived: DerivedMetrics = {
      toolOverheadRatio:
        totalLatencyMs > 0 ? toolLatencyTotalMs / totalLatencyMs : 0,
      costPerToolCall:
        this.toolSpans.length > 0
          ? this.estimatedCostUsd / this.toolSpans.length
          : 0,
      latencyPerIteration:
        this.iterationCount > 0 ? totalLatencyMs / this.iterationCount : 0,
      toolSuccessRates,
      failedToolCount: this.toolSpans.filter((s) => s.status === 'error').length
    };

    // Reset per-query cache hit counter after capturing the snapshot
    resetMarketDataCacheHits();

    // ── Compute toolPolicyDecision ───────────────────────────────────
    let toolPolicyDecision: ToolPolicyDecision = 'unknown';

    if (this.toolSpans.length === 0) {
      if (
        this.guardrailsTriggered.includes('cost_limit') ||
        this.guardrailsTriggered.includes('tool_failure_backoff')
      ) {
        toolPolicyDecision = 'tool_skipped_cost';
      } else if (this.guardrailsTriggered.includes('timeout')) {
        toolPolicyDecision = 'tool_skipped_timeout';
      } else {
        toolPolicyDecision = 'no_tool_needed';
      }
    } else {
      const allFailed = this.toolSpans.every((s) => s.status === 'error');
      const allSucceeded = this.toolSpans.every(
        (s) => s.status === 'success'
      );

      if (allFailed) {
        toolPolicyDecision = 'tool_failed';
      } else if (allSucceeded) {
        toolPolicyDecision = 'tool_selected';
      } else {
        toolPolicyDecision = 'tool_mixed';
      }
    }

    // ── Compute groundednessMode ─────────────────────────────────────
    let groundednessMode: GroundednessMode = 'no_tools_default';

    if (this.toolSpans.length > 0) {
      groundednessMode = 'computed';
    }

    if (
      this.verification.domainViolations.some((v) =>
        v.includes('Verification gate BLOCKED')
      )
    ) {
      groundednessMode = 'verification_blocked';
    }

    // ── Epoch timestamps for accurate Braintrust span timing ─────────
    const timing = {
      startEpochS: this.startTime / 1000,
      endEpochS: endTime / 1000,
      llmStartEpochS: this.llmStartTime > 0 ? this.llmStartTime / 1000 : 0,
      llmEndEpochS: this.llmEndTime > 0 ? this.llmEndTime / 1000 : 0
    };

    return {
      trace,
      toolSpans: this.toolSpans,
      verification: this.verification,
      reactIterations: this.reactIterations,
      derived,
      toolPolicyDecision,
      groundednessMode,
      timing,
      versions: {
        systemPromptVersion: SYSTEM_PROMPT_VERSION,
        toolSchemaVersion: TOOL_SCHEMA_VERSION,
        reactEnabled: true,
        verificationEnabled: true
      }
    };
  }
}

// ===========================================================================
// ToolSpanBuilder — records a single tool call's lifecycle
// ===========================================================================

export class ToolSpanBuilder {
  private readonly spanId: string;
  private readonly traceId: string;
  private readonly toolName: string;
  private readonly toolInput: Record<string, unknown>;
  private readonly iterationIndex: number;
  private readonly startedAt: string;
  private readonly startMs: number;
  private retryCount = 0;

  public constructor(
    traceId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    iterationIndex: number
  ) {
    this.spanId = randomUUID();
    this.traceId = traceId;
    this.toolName = toolName;
    this.toolInput = toolInput;
    this.iterationIndex = iterationIndex;
    this.startedAt = new Date().toISOString();
    this.startMs = Date.now();
  }

  public setRetryCount(count: number): void {
    this.retryCount = count;
  }

  public end(params: {
    status: 'success' | 'error' | 'timeout';
    toolOutput: Record<string, unknown> | null;
    error?: string;
    wasCorrectTool?: boolean;
  }): ToolSpan {
    const endedAt = new Date().toISOString();

    return {
      spanId: this.spanId,
      traceId: this.traceId,
      toolName: this.toolName,
      toolInput: this.toolInput,
      toolOutput: params.toolOutput,
      latencyMs: Date.now() - this.startMs,
      status: params.status,
      error: params.error ?? null,
      retryCount: this.retryCount,
      iterationIndex: this.iterationIndex,
      wasCorrectTool: params.wasCorrectTool ?? null,
      startedAt: this.startedAt,
      endedAt
    };
  }
}
