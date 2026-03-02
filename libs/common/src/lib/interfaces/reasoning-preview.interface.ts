/**
 * Reasoning Preview — shared types for the explainability trace
 * that the frontend renders as a step tree / timeline.
 *
 * IMPORTANT: No raw chain-of-thought is ever included.
 * All tool payloads are redacted + truncated before reaching the client.
 */

export type ReasoningStepStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'skipped';

export type ReasoningStepKind =
  | 'plan'
  | 'analysis'
  | 'tool_call'
  | 'tool_result'
  | 'answer';

export interface ReasoningStep {
  /** Unique id within this trace */
  id: string;

  /** Human-readable title, e.g. "Fetching portfolio summary" */
  title: string;

  /** Step category */
  kind: ReasoningStepKind;

  /** Current status */
  status: ReasoningStepStatus;

  /** ISO-8601 timestamp when the step started */
  startedAt: string;

  /** ISO-8601 timestamp when the step completed (null while running) */
  completedAt: string | null;

  /** Duration in milliseconds (null while running) */
  durationMs: number | null;

  /** Expandable detail — always redacted, max 5 KB */
  detail: string | null;

  /** Whether redaction was applied to the detail */
  redactionApplied: boolean;

  /** Optional child steps (e.g. tool_call → tool_result) */
  children: ReasoningStep[];
}

export interface ReasoningPreview {
  /** Unique trace identifier */
  traceId: string;

  /** The tree of reasoning steps */
  steps: ReasoningStep[];

  /** ISO-8601 timestamp when the trace started */
  startedAt: string;

  /** ISO-8601 timestamp when the trace completed */
  completedAt: string | null;

  /** Total duration in milliseconds */
  totalDurationMs: number | null;
}

/**
 * Server-Sent Event payload for live reasoning updates.
 */
export type ReasoningEventType =
  | 'trace.started'
  | 'step.added'
  | 'step.updated'
  | 'trace.completed';

export interface ReasoningEvent {
  type: ReasoningEventType;
  traceId: string;
  timestamp: string;
  step?: ReasoningStep;
  preview?: ReasoningPreview;
}
