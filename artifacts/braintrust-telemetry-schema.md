# Braintrust Telemetry Schema

> Comprehensive observability for the Ghostfolio AI Chat Sidebar.
> Every AI query logs three core layers to Braintrust for analysis and eval.

---

## 1. Trace-Level Summary

Logged as the **top-level Braintrust row** per user query. This is the primary view in the Braintrust dashboard.

| Field           | Type                | Purpose                                                                              |
| --------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `traceId`       | `string (uuid)`     | Unique trace ID (maps to Braintrust experiment row)                                  |
| `sessionId`     | `string`            | Chat session grouping (conversationId)                                               |
| `userId`        | `string`            | Anonymized user identifier                                                           |
| `queryText`     | `string`            | The user's raw question                                                              |
| `queryCategory` | `string`            | Classification: `portfolio`, `market`, `allocation`, `tax`, `performance`, `general` |
| `responseText`  | `string`            | Final response delivered to the user                                                 |
| `model`         | `string`            | LLM model used (e.g. `openai/gpt-4o`)                                                |
| `timestamp`     | `string (ISO-8601)` | When the trace completed                                                             |

### Latency Breakdown

| Field                | Type     | Purpose                                                   |
| -------------------- | -------- | --------------------------------------------------------- |
| `totalLatencyMs`     | `number` | Wall-clock ms from user submit to response rendered       |
| `llmLatencyMs`       | `number` | Time spent waiting on the LLM API only                    |
| `toolLatencyTotalMs` | `number` | Sum of all tool execution durations                       |
| `overheadLatencyMs`  | `number` | `total - llm - tool` (our code / network / serialization) |

### Token & Cost

| Field              | Type     | Purpose                              |
| ------------------ | -------- | ------------------------------------ |
| `inputTokenCount`  | `number` | Prompt tokens sent to LLM            |
| `outputTokenCount` | `number` | Completion tokens received           |
| `totalTokenCount`  | `number` | Combined token count                 |
| `estimatedCostUsd` | `number` | USD cost estimate for the full query |

### Tool Usage

| Field           | Type       | Purpose                                    |
| --------------- | ---------- | ------------------------------------------ |
| `usedTools`     | `boolean`  | Did this query invoke any tools?           |
| `toolNames`     | `string[]` | Names of tools invoked (deduped)           |
| `toolCallCount` | `number`   | Total tool invocations (including retries) |

### ReAct Loop

| Field                 | Type              | Purpose                                        |
| --------------------- | ----------------- | ---------------------------------------------- |
| `iterationCount`      | `number`          | Number of ReAct iterations before final answer |
| `guardrailsTriggered` | `GuardrailType[]` | Which guardrails fired (empty = none)          |

### Outcome

| Field     | Type             | Purpose                                 |
| --------- | ---------------- | --------------------------------------- |
| `success` | `boolean`        | Did the query complete without error?   |
| `error`   | `string \| null` | Error message if the query failed       |
| `aborted` | `boolean`        | Was the response cancelled by the user? |

### Guardrail Types

```
timeout | max_iterations | cost_limit | circuit_breaker | tool_failure_backoff | payload_limit
```

---

## 2. Tool Spans

Logged **per tool invocation** within a trace. Each tool call gets its own span with full timing and I/O.

| Field            | Type                | Purpose                                                                 |
| ---------------- | ------------------- | ----------------------------------------------------------------------- |
| `spanId`         | `string (uuid)`     | Unique ID for this tool invocation                                      |
| `traceId`        | `string`            | Parent trace ID                                                         |
| `toolName`       | `string`            | Which tool was called (e.g. `get_portfolio_context`, `get_market_data`) |
| `toolInput`      | `object`            | Parameters passed to the tool                                           |
| `toolOutput`     | `object \| null`    | Raw result from the tool                                                |
| `latencyMs`      | `number`            | Execution time in ms for this single call                               |
| `status`         | `string`            | `success`, `error`, or `timeout`                                        |
| `error`          | `string \| null`    | Error detail if the tool failed                                         |
| `retryCount`     | `number`            | How many retries before this result                                     |
| `iterationIndex` | `number`            | Which ReAct iteration triggered this call (1-indexed)                   |
| `wasCorrectTool` | `boolean \| null`   | Eval-scored after the fact: was this the right tool?                    |
| `startedAt`      | `string (ISO-8601)` | Span start timestamp                                                    |
| `endedAt`        | `string (ISO-8601)` | Span end timestamp                                                      |

---

## 3. Verification Summary

Logged **once per trace**. Captures fact-checking, hallucination detection, confidence, and escalation.

| Field                 | Type             | Purpose                                                                 |
| --------------------- | ---------------- | ----------------------------------------------------------------------- |
| `traceId`             | `string`         | Parent trace ID                                                         |
| `passed`              | `boolean`        | Did the response pass all verification checks?                          |
| `confidenceScore`     | `number (0-1)`   | Model's self-assessed confidence                                        |
| `hallucinationFlags`  | `string[]`       | Claims that could not be grounded in portfolio/market data              |
| `factCheckSources`    | `string[]`       | Data sources used to verify response claims                             |
| `domainViolations`    | `string[]`       | Domain constraint violations (invalid ticker, fabricated holding, etc.) |
| `warnings`            | `string[]`       | Non-blocking issues surfaced to user                                    |
| `errors`              | `string[]`       | Blocking errors that prevented a valid response                         |
| `escalationTriggered` | `boolean`        | Was this flagged for human review?                                      |
| `escalationReason`    | `string \| null` | Reason for escalation, if triggered                                     |

---

## 4. ReAct Iteration Trace

Logged **per iteration** of the ReAct loop. Captures the full thought chain for debugging tool selection.

| Field            | Type     | Purpose                                      |
| ---------------- | -------- | -------------------------------------------- |
| `traceId`        | `string` | Parent trace ID                              |
| `iterationIndex` | `number` | Step number in the loop (1-indexed)          |
| `thought`        | `string` | The model's reasoning at this step           |
| `action`         | `string` | What it decided to do                        |
| `observation`    | `string` | What came back from the action               |
| `decision`       | `string` | `continue_loop`, `return_answer`, or `abort` |
| `latencyMs`      | `number` | Time for this single loop step in ms         |

---

## 5. Derived / Computed Metrics

Calculated at finalization time from the raw data above. Used for **Braintrust dashboard filters and comparisons**.

| Metric                | Formula                               | Insight                           |
| --------------------- | ------------------------------------- | --------------------------------- |
| `toolOverheadRatio`   | `toolLatencyTotalMs / totalLatencyMs` | What % of time is spent in tools? |
| `costPerToolCall`     | `estimatedCostUsd / toolCallCount`    | Which tools are expensive?        |
| `latencyPerIteration` | `totalLatencyMs / iterationCount`     | Are later iterations slower?      |
| `toolSuccessRates`    | `successCount / totalCount` per tool  | Which tools are unreliable?       |

### Key Comparison: Tool vs No-Tool Queries

Filter by `usedTools = true` vs `usedTools = false` to compare:

- Average `totalLatencyMs` (are tool calls worth the latency cost?)
- Average `estimatedCostUsd` (cost impact of tool usage)
- Average `confidenceScore` (does tool grounding improve confidence?)

---

## 6. Eval Scoring Functions

Scores are logged inline with every Braintrust trace for dashboard filtering. Target: **>80% good, >90% excellent**.

| Scorer          | What It Measures             | Scale | Thresholds                                                               |
| --------------- | ---------------------------- | ----- | ------------------------------------------------------------------------ |
| `latency`       | Response time                | 0-1   | 1.0 = <2s, 0.75 = <3s, 0.5 = <5s, 0.25 = <10s, 0.0 = >=10s               |
| `cost`          | USD spend per query          | 0-1   | 1.0 = <$0.05, 0.75 = <$0.10, 0.5 = <$0.50, 0.25 = <$1.00, 0.0 = >=$1.00  |
| `safety`        | No harmful financial advice  | 0-1   | 1.0 = clean, 0.75 = warnings, 0.25 = domain violations, 0.0 = escalation |
| `groundedness`  | Claims backed by tool output | 0-1   | Ratio of `factCheckSources / (factCheckSources + hallucinationFlags)`    |
| `toolSelection` | Picked the right tool(s)     | 0-1   | Proportion of tool calls marked `wasCorrectTool = true`                  |
| `toolExecution` | Tools returned valid data    | 0-1   | Proportion of tool calls with `status = success`                         |
| `correctness`   | Factual accuracy             | 0-1   | Proxy: `confidenceScore` (until human/LLM grading)                       |
| `relevance`     | Answers the question         | 0-1   | Proxy: `confidenceScore` (until human/LLM grading)                       |

---

## 7. Complete Payload Structure

What gets sent to Braintrust per query via `logTrace()`:

```typescript
{
  trace:           TraceLevelSummary,   // Section 1
  toolSpans:       ToolSpan[],          // Section 2
  verification:    VerificationSummary, // Section 3
  reactIterations: ReactIteration[],    // Section 4
  derived:         DerivedMetrics       // Section 5
}
```

---

## 8. Environment Variables

| Variable             | Location          | Default                              |
| -------------------- | ----------------- | ------------------------------------ |
| `BRAINTRUST_API_KEY` | Railway Variables | `''` (telemetry disabled when empty) |
| `BRAINTRUST_PROJECT` | Railway Variables | `ghostfolio-ai`                      |

---

## 9. Implementation Files

| File                                                                             | Purpose                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/api/src/app/endpoints/ai/telemetry/telemetry.interfaces.ts`                | All TypeScript interfaces (Sections 1-6)                |
| `apps/api/src/app/endpoints/ai/telemetry/braintrust-telemetry.service.ts`        | NestJS service + TraceContext builder + ToolSpanBuilder |
| `apps/api/src/app/endpoints/ai/telemetry/eval-scorers.ts`                        | 8 scoring functions + threshold checks                  |
| `apps/api/src/app/endpoints/ai/telemetry/index.ts`                               | Barrel export                                           |
| `apps/api/src/app/endpoints/ai/telemetry/__tests__/braintrust-telemetry.spec.ts` | 38 unit tests                                           |
| `apps/api/src/app/endpoints/ai/ai.service.ts`                                    | Integration point (chat method)                         |
| `apps/api/src/app/endpoints/ai/ai.module.ts`                                     | DI registration                                         |
| `apps/api/src/services/configuration/configuration.service.ts`                   | Env var loading                                         |
| `apps/api/src/services/interfaces/environment.interface.ts`                      | Env type definitions                                    |
