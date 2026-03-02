# AI Chat & Import Auditor — Telemetry (Braintrust)

## Overview

Both the AI chat and CSV import-auditor systems use **Braintrust** for observability. Every query creates a `TraceContext` that collects tool spans, verification data, and derived metrics, then logs the complete `TelemetryPayload` to Braintrust via `BraintrustTelemetryService.logTrace()`.

**Degradation-safe:** If `BRAINTRUST_API_KEY` is not set, telemetry is silently disabled -- both systems still work normally.

## Configuration

Environment variables (via `ConfigurationService`):

| Variable             | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `BRAINTRUST_API_KEY` | Braintrust project API key (required to enable)       |
| `BRAINTRUST_PROJECT` | Braintrust project name (defaults to `ghostfolio-ai`) |

## Architecture

### Core Classes

| Class                        | Location                                    | Purpose                                                                               |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `BraintrustTelemetryService` | `telemetry/braintrust-telemetry.service.ts` | NestJS injectable; manages Braintrust logger, exposes `startTrace()` and `logTrace()` |
| `TraceContext`               | Same file                                   | Mutable builder for a single query lifecycle; collects all metrics                    |
| `ToolSpanBuilder`            | Same file                                   | Records a single tool call's start/end/status/output                                  |

### Shared Conventions

Both AI chat and import auditor share:

- **Same `TraceContext` + `ToolSpanBuilder`** pattern
- **Same `TelemetryPayload`** shape logged to Braintrust
- **Same `sessionId`** convention (conversation/session UUID)
- **Same `traceId`** convention (random UUID per query)
- **Same degradation behavior** (no API key -> no-op)

## What Gets Logged (TelemetryPayload)

### 1. Trace-Level Summary

One per query. Top-level request metrics:

```typescript
{
  traceId: string;              // Unique trace UUID
  sessionId: string;            // Conversation/session grouping
  userId: string;               // Authenticated user ID
  queryText: string;            // User's raw message
  queryCategory: 'portfolio' | 'market' | 'allocation' | 'tax' | 'performance' | 'general';
  responseText: string;         // Final response delivered
  totalLatencyMs: number;       // Wall-clock ms
  llmLatencyMs: number;         // Time in LLM API
  toolLatencyTotalMs: number;   // Sum of all tool durations
  overheadLatencyMs: number;    // total - llm - tool
  inputTokenCount: number;
  outputTokenCount: number;
  totalTokenCount: number;
  estimatedCostUsd: number;
  usedTools: boolean;
  toolNames: string[];          // Deduplicated tool names
  toolCallCount: number;        // Total invocations (including retries)
  iterationCount: number;       // ReAct iterations
  guardrailsTriggered: GuardrailType[];  // timeout, cost_limit, circuit_breaker, etc.
  success: boolean;
  error: string | null;
  aborted: boolean;
  model: string;                // e.g., 'anthropic/claude-sonnet-4'
  timestamp: string;            // ISO-8601

  // Extended metadata (AI chat only)
  requestShape?: { historyMessageCount, userMessageChars, userMessageTokensEstimate };
  toolDataVolume?: { toolOutputBytesTotal, toolOutputRowsTotal, perTool[] };
  providerMeta?: { marketProviderName, rateLimited, providerErrors[] };
  cachingMeta?: { cacheEnabled, cacheHits };
  answerQualitySignals?: { refused, disclaimerShown, numericClaimsCount, toolBackedNumericClaimsCount };
}
```

### 2. Tool Spans

One per tool invocation. Per-tool timing and outcome:

```typescript
{
  spanId: string;               // Unique span UUID
  traceId: string;              // Parent trace
  toolName: string;             // e.g., 'getQuote', 'parseCSV'
  toolInput: Record<string, unknown>;
  toolOutput: Record<string, unknown> | null;
  latencyMs: number;
  status: 'success' | 'error' | 'timeout';
  error: string | null;
  retryCount: number;
  iterationIndex: number;       // Which ReAct iteration (0-indexed)
  wasCorrectTool: boolean | null;  // Eval-scored after the fact
  startedAt: string;            // ISO-8601
  endedAt: string;

  // Optional provider fields (market tools only)
  providerName?: string;        // e.g., "yahoo-finance2"
  assetType?: string;           // e.g., "equity", "crypto"
  normalizedSymbol?: string;    // e.g., "BTC-USD"
  requestId?: string;           // Correlation ID
}
```

### 3. Verification Summary

One per query. Hallucination/confidence/domain checks:

```typescript
{
  traceId: string;
  passed: boolean;
  confidenceScore: number;      // 0.0 - 1.0
  hallucinationFlags: string[];
  factCheckSources: string[];
  domainViolations: string[];
  warnings: string[];
  errors: string[];
  escalationTriggered: boolean;
  escalationReason: string | null;
}
```

### 4. ReAct Iterations

One per loop step. Thought-chain logging:

```typescript
{
  traceId: string;
  iterationIndex: number;
  thought: string;
  action: string;
  observation: string;
  decision: 'continue_loop' | 'return_answer' | 'abort';
  latencyMs: number;
}
```

### 5. Derived Metrics

Computed from the above layers:

```typescript
{
  toolOverheadRatio: number; // toolLatency / totalLatency
  costPerToolCall: number; // cost / toolCallCount
  latencyPerIteration: number; // totalLatency / iterationCount
  toolSuccessRates: Record<string, number>; // per-tool success rate
  failedToolCount: number; // spans with status === 'error'
}
```

## Telemetry Flow

### AI Chat

```
AiService.chat() called
  |
  +-- telemetryService.startTrace({ sessionId, userId, queryText, model })
  |     Returns TraceContext
  |
  +-- traceCtx.markLlmStart()
  |
  +-- generateText() runs ReAct loop
  |   +-- LLM selects tool
  |   +-- executeWithGuardrails()
  |   |   +-- traceCtx.startToolSpan(name, input, iteration)
  |   |   +-- tool.execute()
  |   |   +-- spanBuilder.end({ status, toolOutput, error })
  |   |   +-- traceCtx.addToolSpan(span)
  |   +-- (repeat for each tool call / ReAct step)
  |
  +-- traceCtx.markLlmEnd()
  +-- traceCtx.setTokens(input, output)
  +-- traceCtx.setResponse(responseText)
  +-- traceCtx.setConfidence(score)
  |
  +-- telemetryService.logTrace(traceCtx.finalize())
      |
      +-- Braintrust logger.log({ id, input, output, metadata, scores })
```

### Import Auditor

```
ImportAuditorService.chat() called
  |
  +-- telemetryService.startTrace({ sessionId, userId, queryText, model })
  |
  +-- traceCtx.markLlmStart()
  |
  +-- generateText() runs tool loop
  |   +-- Each tool execute():
  |       +-- traceCtx.startToolSpan(toolName, input, toolCallIndex++)
  |       +-- <tool logic>
  |       +-- spanBuilder.end({ status, toolOutput })
  |       +-- traceCtx.addToolSpan(span)
  |
  +-- traceCtx.markLlmEnd()
  +-- traceCtx.setTokens() / setResponse() / setIterationCount()
  |
  +-- telemetryService.logTrace(traceCtx.finalize())
```

## Braintrust Inline Scores

Logged with every trace for dashboard filtering:

| Score          | Calculation                                                        |
| -------------- | ------------------------------------------------------------------ |
| `latency`      | 1.0 (<2s), 0.5 (<5s), 0.0 (>=5s)                                   |
| `cost`         | 1.0 (<$0.10), 0.5 (<$1.00), 0.0 (>=$1.00)                          |
| `confidence`   | From verification.confidenceScore                                  |
| `safety`       | 0 if escalation triggered, 1 otherwise                             |
| `groundedness` | Computed by `scoreGroundedness()` -- penalizes hallucination flags |

## Eval Scorers (8 Types)

Located in `telemetry/eval-scorers.ts`:

| Scorer               | Range  | Purpose                                     |
| -------------------- | ------ | ------------------------------------------- |
| `scoreLatency`       | 0-1    | Penalizes slow responses                    |
| `scoreCost`          | 0-1    | Penalizes expensive queries                 |
| `scoreSafety`        | 0-1    | Penalizes escalations and domain violations |
| `scoreGroundedness`  | 0-1    | Penalizes hallucination flags               |
| `scoreToolSelection` | 0-1    | Validates correct tool was chosen           |
| `scoreToolExecution` | 0-1    | Ratio of successful tool calls              |
| `computeAllScores`   | object | Computes all 8 scores in one call           |

## GuardrailTypes

```typescript
type GuardrailType =
  | 'timeout'
  | 'max_iterations'
  | 'cost_limit'
  | 'circuit_breaker'
  | 'tool_failure_backoff'
  | 'payload_limit';
```

## Test Coverage

| Test File                      | Count | What It Tests                                          |
| ------------------------------ | ----- | ------------------------------------------------------ |
| `braintrust-telemetry.spec.ts` | 56    | TraceContext, ToolSpanBuilder, eval scorers            |
| `ai-chat-telemetry.spec.ts`    | 21    | Full pipeline: tool call + no-tool + payload structure |
