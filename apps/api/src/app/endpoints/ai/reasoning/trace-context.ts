/**
 * TraceContext — creates a traceId per request and manages the reasoning
 * step tree. Emits structured ReasoningEvents via a callback for SSE streaming.
 *
 * Usage:
 *   const ctx = new TraceContext(traceId, emitFn);
 *   ctx.addPlanStep("Analyzing user question");
 *   const toolStep = ctx.startToolCall("getPortfolioSummary", args);
 *   ctx.completeToolCall(toolStep.id, result, "success");
 *   ctx.addAnalysisSummary("Looking at your portfolio allocation");
 *   ctx.complete();
 */
import type {
  ReasoningEvent,
  ReasoningPreview,
  ReasoningStep,
  ReasoningStepKind,
  ReasoningStepStatus
} from '@ghostfolio/common/interfaces';

import { randomUUID } from 'node:crypto';

import { redact, redactRecord } from './redaction';

export type TraceEventEmitter = (event: ReasoningEvent) => void;

export class TraceContext {
  public readonly traceId: string;
  private readonly steps: ReasoningStep[] = [];
  private readonly startedAt: string;
  private completedAt: string | null = null;
  private readonly emit: TraceEventEmitter;

  /** Map of step id → step reference for fast lookup */
  private readonly stepMap = new Map<string, ReasoningStep>();

  public constructor(traceId: string, emit: TraceEventEmitter) {
    this.traceId = traceId;
    this.startedAt = new Date().toISOString();
    this.emit = emit;

    this.emit({
      type: 'trace.started',
      traceId: this.traceId,
      timestamp: this.startedAt,
      preview: this.getPreview()
    });
  }

  /**
   * Add a plan step (the initial "thinking" node).
   */
  public addPlanStep(title: string): ReasoningStep {
    return this.addStep({
      title,
      kind: 'plan',
      status: 'success',
      detail: null,
      redactionApplied: false
    });
  }

  /**
   * Add a high-level analysis summary step.
   * These are user-facing explanations generated with an explicit prompt.
   */
  public addAnalysisSummary(summary: string): ReasoningStep {
    const { text, redactionApplied } = redact(summary);

    return this.addStep({
      title: text,
      kind: 'analysis',
      status: 'success',
      detail: null,
      redactionApplied
    });
  }

  /**
   * Start a tool call step (status = running).
   * Returns the step so the caller can later complete it.
   */
  public startToolCall(
    toolName: string,
    args: Record<string, unknown> | undefined
  ): ReasoningStep {
    const { data: redactedArgs, redactionApplied } = redactRecord(args);
    const detail =
      Object.keys(redactedArgs).length > 0
        ? JSON.stringify(redactedArgs, null, 2)
        : null;

    return this.addStep({
      title: `Calling ${toolName}`,
      kind: 'tool_call',
      status: 'running',
      detail,
      redactionApplied
    });
  }

  /**
   * Complete a running tool call with its result.
   */
  public completeToolCall(
    stepId: string,
    result: unknown,
    status: 'success' | 'error',
    durationMs: number
  ): void {
    const step = this.stepMap.get(stepId);

    if (!step) {
      return;
    }

    const now = new Date().toISOString();
    step.status = status;
    step.completedAt = now;
    step.durationMs = durationMs;

    // Add a child tool_result step
    const { text: redactedResult, redactionApplied } = redact(result);
    const resultStep: ReasoningStep = {
      id: randomUUID(),
      title: status === 'success' ? 'Result received' : 'Tool error',
      kind: 'tool_result',
      status,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      detail: redactedResult || null,
      redactionApplied,
      children: []
    };

    step.children.push(resultStep);
    this.stepMap.set(resultStep.id, resultStep);

    this.emit({
      type: 'step.updated',
      traceId: this.traceId,
      timestamp: now,
      step
    });
  }

  /**
   * Add the final answer step.
   */
  public addAnswerStep(): ReasoningStep {
    return this.addStep({
      title: 'Composing final answer',
      kind: 'answer',
      status: 'success',
      detail: null,
      redactionApplied: false
    });
  }

  /**
   * Mark the trace as complete.
   */
  public complete(): ReasoningPreview {
    this.completedAt = new Date().toISOString();

    const preview = this.getPreview();

    this.emit({
      type: 'trace.completed',
      traceId: this.traceId,
      timestamp: this.completedAt,
      preview
    });

    return preview;
  }

  /**
   * Get the current preview snapshot.
   */
  public getPreview(): ReasoningPreview {
    const startMs = new Date(this.startedAt).getTime();
    const endMs = this.completedAt
      ? new Date(this.completedAt).getTime()
      : null;

    return {
      traceId: this.traceId,
      steps: [...this.steps],
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      totalDurationMs: endMs ? endMs - startMs : null
    };
  }

  /**
   * Get all steps (for server-side persistence — unredacted detail is never stored here
   * because redaction happens at emission time).
   */
  public getSteps(): ReasoningStep[] {
    return [...this.steps];
  }

  // ────────────────────────────────────────────────────────────────────

  private addStep(params: {
    title: string;
    kind: ReasoningStepKind;
    status: ReasoningStepStatus;
    detail: string | null;
    redactionApplied: boolean;
  }): ReasoningStep {
    const now = new Date().toISOString();
    const isComplete =
      params.status !== 'running' && params.status !== 'pending';

    const step: ReasoningStep = {
      id: randomUUID(),
      title: params.title,
      kind: params.kind,
      status: params.status,
      startedAt: now,
      completedAt: isComplete ? now : null,
      durationMs: isComplete ? 0 : null,
      detail: params.detail,
      redactionApplied: params.redactionApplied,
      children: []
    };

    this.steps.push(step);
    this.stepMap.set(step.id, step);

    this.emit({
      type: 'step.added',
      traceId: this.traceId,
      timestamp: now,
      step
    });

    return step;
  }
}
