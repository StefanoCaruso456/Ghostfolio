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

  /** How the message was triggered (e.g. 'manual', 'suggested_prompt') */
  triggerSource?: string;

  // ── Extended Metadata (Telemetry Additions) ────────────────────────

  /** Shape of the user request */
  requestShape?: {
    historyMessageCount: number;
    userMessageChars: number;
    userMessageTokensEstimate: number;
  };

  /** Volume of data returned by tools */
  toolDataVolume?: {
    toolOutputBytesTotal: number;
    toolOutputRowsTotal: number;
    perTool: {
      toolName: string;
      outputBytes: number;
      outputRows: number;
    }[];
  };

  /** Market data provider metadata */
  providerMeta?: {
    marketProviderName: string;
    rateLimited: boolean;
    providerErrors: string[];
  };

  /** Caching metadata (placeholder for future caching layer) */
  cachingMeta?: {
    cacheEnabled: boolean;
    cacheHits: number;
  };

  /** Answer quality signals for evaluation */
  answerQualitySignals?: {
    refused: boolean;
    disclaimerShown: boolean;
    numericClaimsCount: number;
    toolBackedNumericClaimsCount: number | null;
  };
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

  // Optional provider-level fields (additive — populated when known)
  /** Name of the upstream data provider (e.g. "yahoo-finance") */
  providerName?: string | null;
  /** Asset type classification (e.g. "equity", "crypto", "etf") */
  assetType?: string | null;
  /** Normalized symbol sent to the provider (e.g. "BTC-USD") */
  normalizedSymbol?: string | null;
  /** Correlation ID for cross-referencing provider logs */
  requestId?: string | null;

  // Dispatch routing fields (MCP integration)
  /** Which executor ran this tool: local or mcp */
  executor?: 'local' | 'mcp';
  /** MCP request correlation ID (only when executor=mcp) */
  mcpRequestId?: string | null;
  /** MCP round-trip latency in ms (only when executor=mcp) */
  mcpLatencyMs?: number | null;
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
// 5. Tool Policy & Groundedness Decisions
// ---------------------------------------------------------------------------

/** Why tools were or were not used in this query */
export type ToolPolicyDecision =
  | 'no_tool_needed' // Model decided no tools required
  | 'tool_selected' // Tools were called successfully
  | 'tool_failed' // Tools were called but all failed
  | 'tool_skipped_cost' // Skipped due to cost limit
  | 'tool_skipped_timeout' // Skipped due to timeout
  | 'tool_mixed' // Some succeeded, some failed
  | 'unknown'; // Not yet determined

/** How groundedness was assessed */
export type GroundednessMode =
  | 'computed' // Tools were called, groundedness was evaluated
  | 'no_tools_default' // No tools used, default score applied
  | 'verification_blocked'; // Verification gate blocked the response

// ---------------------------------------------------------------------------
// 6. Derived / Computed Metrics (for Braintrust dashboard filters)
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

  /** Count of tool spans with status === 'error'. Enables quick Braintrust filtering. */
  failedToolCount: number;
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

  /** Why tools were or were not used */
  toolPolicyDecision: ToolPolicyDecision;

  /** How groundedness was assessed */
  groundednessMode: GroundednessMode;

  /** Epoch timestamps (seconds) for accurate Braintrust span timing */
  timing: {
    startEpochS: number; // request start
    endEpochS: number; // response complete
    llmStartEpochS: number;
    llmEndEpochS: number;
    /** Verification phase start (0 = not tracked) */
    verificationStartEpochS?: number;
    /** Verification phase end (0 = not tracked) */
    verificationEndEpochS?: number;
    /** Final response formatting start (0 = not tracked) */
    responseStartEpochS?: number;
    /** Final response formatting end (0 = not tracked) */
    responseEndEpochS?: number;
  };

  /** Config versioning for debugging regressions */
  versions: {
    systemPromptVersion: string;
    toolSchemaVersion: string;
    reactEnabled: boolean;
    verificationEnabled: boolean;
  };
}
