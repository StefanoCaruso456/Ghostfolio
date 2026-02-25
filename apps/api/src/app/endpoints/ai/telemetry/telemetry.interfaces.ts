/**
 * Braintrust Telemetry Interfaces
 *
 * Three core layers logged per AI query:
 *   1. Trace-Level Summary  — top-level metrics for the full request
 *   2. Tool Spans           — per-tool-call timing and outcome
 *   3. Verification Summary — fact-check / hallucination / confidence results
 */

// ---------------------------------------------------------------------------
// 1. Trace-Level Summary
// ---------------------------------------------------------------------------

export interface TraceLevelSummary {
  /** Unique trace ID (maps to Braintrust experiment row) */
  traceId: string;

  /** Chat session grouping */
  sessionId: string;

  /** Anonymized user identifier */
  userId: string;

  /** The user's raw question */
  queryText: string;

  /** Classification of the query intent */
  queryCategory:
    | 'portfolio'
    | 'market'
    | 'allocation'
    | 'tax'
    | 'performance'
    | 'general';

  /** Final response delivered to the user */
  responseText: string;

  // ── Latency Breakdown ──────────────────────────────────────────────

  /** Wall-clock ms from user submit → response rendered */
  totalLatencyMs: number;

  /** Time spent waiting on the LLM API */
  llmLatencyMs: number;

  /** Sum of all tool execution durations */
  toolLatencyTotalMs: number;

  /** totalLatency - llmLatency - toolLatency (our code / network) */
  overheadLatencyMs: number;

  // ── Token & Cost ───────────────────────────────────────────────────

  inputTokenCount: number;
  outputTokenCount: number;
  totalTokenCount: number;

  /** USD cost estimate for the full query */
  estimatedCostUsd: number;

  // ── Tool Usage ─────────────────────────────────────────────────────

  /** Did this query invoke any tools? */
  usedTools: boolean;

  /** Names of tools invoked (deduped) */
  toolNames: string[];

  /** Count of total tool invocations (including retries) */
  toolCallCount: number;

  // ── ReAct Loop ─────────────────────────────────────────────────────

  /** Number of ReAct iterations before final answer */
  iterationCount: number;

  /** Which guardrails fired (empty array = none) */
  guardrailsTriggered: GuardrailType[];

  // ── Outcome ────────────────────────────────────────────────────────

  /** Did the query complete without error? */
  success: boolean;

  /** Error message if the query failed */
  error: string | null;

  /** Was the response aborted by the user? */
  aborted: boolean;

  /** LLM model used (e.g. 'anthropic/claude-sonnet-4') */
  model: string;

  /** ISO-8601 timestamp */
  timestamp: string;
}

export type GuardrailType =
  | 'timeout'
  | 'max_iterations'
  | 'cost_limit'
  | 'circuit_breaker'
  | 'tool_failure_backoff'
  | 'payload_limit';

// ---------------------------------------------------------------------------
// 2. Tool Spans
// ---------------------------------------------------------------------------

export interface ToolSpan {
  /** Unique ID for this tool invocation */
  spanId: string;

  /** Parent trace ID */
  traceId: string;

  /** Which tool was called */
  toolName: string;

  /** Parameters passed to the tool */
  toolInput: Record<string, unknown>;

  /** Raw result from the tool */
  toolOutput: Record<string, unknown> | null;

  /** Execution time in ms for this single call */
  latencyMs: number;

  /** Outcome of the tool call */
  status: 'success' | 'error' | 'timeout';

  /** Error detail if the tool failed */
  error: string | null;

  /** How many retries before this result */
  retryCount: number;

  /** Which ReAct iteration triggered this call (1-indexed) */
  iterationIndex: number;

  /** Eval-scored after the fact: was this the right tool? */
  wasCorrectTool: boolean | null;

  /** ISO-8601 span start */
  startedAt: string;

  /** ISO-8601 span end */
  endedAt: string;
}

// ---------------------------------------------------------------------------
// 3. Verification Summary
// ---------------------------------------------------------------------------

export interface VerificationSummary {
  /** Parent trace ID */
  traceId: string;

  /** Did the response pass all verification checks? */
  passed: boolean;

  /** Model's self-assessed confidence (0–1) */
  confidenceScore: number;

  /** Claims that could not be grounded in portfolio/market data */
  hallucinationFlags: string[];

  /** Data sources used to verify response claims */
  factCheckSources: string[];

  /** Domain constraint violations (invalid ticker, fabricated holding, etc.) */
  domainViolations: string[];

  /** Non-blocking issues surfaced to user */
  warnings: string[];

  /** Blocking errors that prevented a valid response */
  errors: string[];

  /** Was this flagged for human review (high-risk financial advice)? */
  escalationTriggered: boolean;

  /** Reason for escalation, if triggered */
  escalationReason: string | null;
}

// ---------------------------------------------------------------------------
// 4. ReAct Iteration (for detailed thought-chain logging)
// ---------------------------------------------------------------------------

export interface ReactIteration {
  /** Parent trace ID */
  traceId: string;

  /** Step number in the loop (1-indexed) */
  iterationIndex: number;

  /** The model's reasoning at this step */
  thought: string;

  /** What it decided to do */
  action: string;

  /** What came back from the action */
  observation: string;

  /** Outcome of this iteration */
  decision: 'continue_loop' | 'return_answer' | 'abort';

  /** Time for this single loop step in ms */
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// 5. Derived / Computed Metrics (for Braintrust dashboard filters)
// ---------------------------------------------------------------------------

export interface DerivedMetrics {
  /** tool_latency_total / total_latency */
  toolOverheadRatio: number;

  /** estimated_cost_usd / tool_call_count */
  costPerToolCall: number;

  /** total_latency / iteration_count */
  latencyPerIteration: number;

  /** success_count / total_count per tool (computed across multiple traces) */
  toolSuccessRates: Record<string, number>;
}

// ---------------------------------------------------------------------------
// 6. Complete Telemetry Payload (what gets sent to Braintrust per query)
// ---------------------------------------------------------------------------

export interface TelemetryPayload {
  trace: TraceLevelSummary;
  toolSpans: ToolSpan[];
  verification: VerificationSummary;
  reactIterations: ReactIteration[];
  derived: DerivedMetrics;
}
