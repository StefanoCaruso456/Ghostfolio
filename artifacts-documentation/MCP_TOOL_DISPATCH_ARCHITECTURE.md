# MCP Tool Dispatch Architecture

## 1. Executive Summary

### Purpose

The MCP Tool Dispatch system routes Ghostfolio AI tool execution through either
local in-process functions or an external MCP (Model Context Protocol) server.
This enables externalizing tool logic without changing the AI agent's ReAct loop,
schema contracts, or telemetry pipeline.

### Scope

- Routes 13 AI tools (`getQuote`, `getPortfolioSummary`, `getHoldingDetail`, etc.) through a
  configurable dispatch layer
- Validates MCP results against the same Zod schemas used for local execution
- Wraps MCP results with the same verification contract as local results
- Logs dispatch metadata (`executor`, `mcpRequestId`, `mcpLatencyMs`) to
  Braintrust telemetry

### Design Principles

1. **Zero-change default** -- `TOOLS_DISPATCH_MODE=local` (default) preserves
   identical behavior. No code path changes unless the flag is set.
2. **Same contract everywhere** -- MCP results must pass the same Zod output
   schema and carry the same verification object as local results.
3. **Incremental rollout** -- Hybrid mode lets you route one tool at a time.
   Start with `getQuote`, prove it works, expand.
4. **Observable** -- Every tool span records which executor ran it. You can prove
   MCP executed by filtering `executor=mcp` in Braintrust.
5. **Instant rollback** -- Set `TOOLS_DISPATCH_MODE=local`, restart. No schema
   or code changes required.

### Current Status

| Item                  | Status                                     |
| --------------------- | ------------------------------------------ |
| ToolDispatcherService | Implemented, tested (15 tests)             |
| McpClientService      | `callTool()` method added                  |
| mcp-tool-map.ts       | All 13 tools mapped                        |
| Hybrid allowlist      | `getQuote` only                            |
| Telemetry fields      | `executor`, `mcpRequestId`, `mcpLatencyMs` |
| Integration tests     | 15 unit + 20 telemetry (35 total passing)  |

### Non-Goals

- Does **not** change the Vercel AI SDK `generateText()` call or ReAct loop
- Does **not** modify tool Zod input/output schemas
- Does **not** add retry logic (failures propagate as-is)
- Does **not** change the SSE reasoning trace pipeline
- Does **not** require MCP server changes (same `/rpc` endpoint)

---

## 2. Architecture Overview

### High-Level Flow

```
User Message
    |
    v
AiService.chat()
    |
    v
generateText() + ReAct loop
    |
    v (LLM selects tool)
executeWithGuardrails(toolName, args, localFn)
    |
    +-- Circuit Breaker check
    +-- Cost Limiter check
    +-- Failure Tracker check
    |
    v
ToolDispatcherService.dispatch(toolName, args, localFn, {outputSchema})
    |
    +-- resolveExecutor(toolName)
    |       |
    |       +-- mode=local  --> always 'local'
    |       +-- mode=mcp    --> always 'mcp'
    |       +-- mode=hybrid --> isOnMcpAllowlist(toolName) ? 'mcp' : 'local'
    |
    +-- executor='local':
    |       |
    |       v
    |   localFn()  -->  result
    |
    +-- executor='mcp':
    |       |
    |       v
    |   getMcpMethodName(toolName)  -->  mcpMethodName
    |       |
    |       v
    |   McpClientService.callTool(mcpMethodName, args, {timeoutMs})
    |       |    HTTP POST /rpc
    |       |    x-mcp-api-key header
    |       |    AbortController timeout
    |       |
    |       v
    |   { result, mcpRequestId, mcpLatencyMs }
    |       |
    |       v
    |   Zod output schema validation (OUTPUT_SCHEMA_REGISTRY[toolName])
    |       |
    |       +-- validation fails --> error-shaped result
    |       +-- validation passes --> continue
    |       |
    |       v
    |   Verification wrapper (add verification object if missing)
    |
    v
DispatchResult<T> { result, executor, mcpRequestId?, mcpLatencyMs? }
    |
    v
Back in executeWithGuardrails():
    |
    +-- Local-path Zod validation (double-check for executor=local)
    +-- Failure tracker recording
    +-- Verification gate enforcement
    +-- ToolSpan recording (executor, mcpRequestId, mcpLatencyMs)
    +-- Reasoning step completion
    |
    v
Result returned to LLM for next ReAct iteration
```

### Key Decision Points

| Point                     | Location                                          | Logic                                                             |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| **Dispatch decision**     | `ToolDispatcherService.resolveExecutor()`         | Reads `mode` (set at construction from `TOOLS_DISPATCH_MODE` env) |
| **Name mapping**          | `getMcpMethodName()` in `mcp-tool-map.ts`         | Looks up canonical name in `MCP_TOOL_MAP`                         |
| **Timeout coordination**  | `McpClientService.callTool()`                     | Uses `options.timeoutMs` or default 30s                           |
| **Zod validation**        | `ToolDispatcherService.dispatchMcp()`             | Validates MCP result against `outputSchema` if provided           |
| **Verification contract** | `ToolDispatcherService.dispatchMcp()`             | Adds `createVerificationResult()` if MCP result lacks one         |
| **Telemetry logging**     | `executeWithGuardrails()` via `spanBuilder.end()` | Passes `executor`, `mcpRequestId`, `mcpLatencyMs`                 |

### File Map

```
apps/api/src/app/endpoints/ai/
  mcp/
    mcp-tool-map.ts           <-- Canonical <-> MCP name mapping + allowlist
    tool-dispatcher.service.ts <-- Dispatch routing + schema validation + verification
    mcp-client.service.ts      <-- HTTP transport (callTool + rpc)
    __tests__/
      tool-dispatcher.spec.ts  <-- 15 integration tests
  ai.service.ts                <-- executeWithGuardrails() consumes ToolDispatcher
  ai.module.ts                 <-- DI registration
  telemetry/
    telemetry.interfaces.ts    <-- ToolSpan with executor/mcp fields
    braintrust-telemetry.service.ts <-- ToolSpanBuilder.end() + logToolSpan()
```

---

## 3. Dispatch Modes

### Environment Variable

```
TOOLS_DISPATCH_MODE=local|mcp|hybrid    # default: local
```

Set in Railway Variables tab. Requires service restart to take effect (read at
module construction time via `ConfigurationService.get()`).

### Mode Behavior

| Mode     | Behavior                                   | Use Case                      |
| -------- | ------------------------------------------ | ----------------------------- |
| `local`  | All 10 tools execute in-process            | Default. Production fallback. |
| `hybrid` | Allowlisted tools route to MCP, rest local | Safe incremental rollout      |
| `mcp`    | All 10 tools forwarded to MCP server       | Full externalization (future) |

### Hybrid Allowlist

Defined in `mcp-tool-map.ts`:

```typescript
export const MCP_HYBRID_ALLOWLIST = new Set<string>(['getQuote']);
```

Currently contains only `getQuote`. To add more tools, add entries to this set
and follow the runbook in Section 8.

### Invalid Mode Handling

If `TOOLS_DISPATCH_MODE` is set to an unrecognized value, the dispatcher
defaults to `local` silently. No error is thrown.

---

## 4. Tool Execution Contract

### Input Contract

1. **Tool name**: Must be one of the 10 camelCase names registered in
   `OUTPUT_SCHEMA_REGISTRY`:
   `getPortfolioSummary`, `listActivities`, `getAllocations`, `getPerformance`,
   `getQuote`, `getHistory`, `getFundamentals`, `getNews`, `computeRebalance`,
   `scenarioImpact`

2. **Tool name mapping**: The canonical name is looked up in `MCP_TOOL_MAP` to
   get the MCP method name. Today both sides use identical names. If the MCP
   server renames a method, update the value in the map.

3. **Input validation**: Zod input schemas (e.g., `GetQuoteInputSchema`) are
   enforced by the Vercel AI SDK `tool()` wrapper _before_ `executeWithGuardrails`
   is called. Both local and MCP paths receive pre-validated args.

### Output Contract

Every tool result -- local or MCP -- must conform to this shape:

```typescript
{
  status: 'success' | 'error';
  data?: { ... };                    // Tool-specific payload
  message: string;                   // Human-readable summary
  verification: {                    // AgentForge verification object
    passed: boolean;
    confidence: number;              // 0.0 - 1.0
    warnings: string[];
    errors: string[];
    sources: string[];
    verificationType: string;
    requiresHumanReview: boolean;
    // ... additional optional fields
  };
  meta?: {                           // Optional metadata
    schemaVersion: string;
    source: string;
  };
}
```

### MCP Output Handling

1. **Zod validation**: MCP result is validated against `OUTPUT_SCHEMA_REGISTRY[toolName]`.
   If validation fails, an error-shaped result is returned with
   `status: 'error'` and a descriptive message.

2. **Verification wrapper**: If the MCP server returns a result without a
   `verification` object, Ghostfolio adds one:

```typescript
{
  passed: result.status === 'success',
  confidence: result.status === 'success' ? 0.85 : 0.1,
  sources: ['mcp-server'],
  warnings: ['Verification added by Ghostfolio (MCP result)']
}
```

3. **Downstream consistency**: After dispatch, `executeWithGuardrails()` applies
   the same verification gate, failure tracking, and span recording regardless
   of executor.

### Example: getQuote via MCP

**MCP server returns:**

```json
{
  "status": "success",
  "data": {
    "quotes": [
      {
        "symbol": "AAPL",
        "name": "Apple Inc.",
        "price": 185.5,
        "currency": "USD",
        "dayChangeAbs": 2.3,
        "dayChangePct": 1.25,
        "asOf": "2026-02-28T16:00:00Z",
        "source": "yahoo-finance2"
      }
    ],
    "errors": [],
    "requestedCount": 1,
    "returnedCount": 1
  },
  "message": "Fetched 1 of 1 quotes."
}
```

**Ghostfolio adds verification (since MCP didn't include one):**

```json
{
  "verification": {
    "passed": true,
    "confidence": 0.85,
    "warnings": ["Verification added by Ghostfolio (MCP result)"],
    "errors": [],
    "sources": ["mcp-server"],
    "verificationType": "composite",
    "requiresHumanReview": false
  }
}
```

**Result passes `GetQuoteOutputSchema` Zod validation, then enters the same
guardrail pipeline as local results.**

---

## 5. Timeout & Error Handling Model

### Timeout Hierarchy

| Layer                    | Timeout                   | Source                                                    |
| ------------------------ | ------------------------- | --------------------------------------------------------- |
| `generateText()` overall | 45s base / 90s multimodal | `TIMEOUT_MS` / `TIMEOUT_MULTIMODAL_MS` in `ai.service.ts` |
| MCP `callTool()` default | 30s                       | `McpClientService.TIMEOUT_MS`                             |
| MCP `callTool()` custom  | Configurable              | `options.timeoutMs` parameter                             |

### Timeout Coordination

The MCP timeout (30s) must complete within the overall `generateText()` timeout
(45s). Currently there is no dynamic remaining-time calculation. The recommended
formula for future optimization:

```
mcpTimeout = min(30_000, remainingMs - 2_000)
```

Where `remainingMs = effectiveTimeoutMs - (Date.now() - requestStartMs)`.

### Error Propagation

```
MCP server error (HTTP 4xx/5xx)
    |
    v
McpClientService throws Error
    |
    v
ToolDispatcherService propagates to executeWithGuardrails()
    |
    v
executeWithGuardrails() catches and:
    +-- Records error in ToolSpan (status: 'error')
    +-- Records in ToolFailureTracker
    +-- If tracker trips --> throws Guardrail error --> ReAct loop aborts
    +-- If tracker doesn't trip --> error result returned to LLM
    |
    v
LLM decides next action (may retry different tool or compose error response)
```

### No Retry Policy

There is **no** transport-level retry for MCP calls. A failed MCP call is
treated identically to a failed local call:

- Recorded as `status: 'error'` in ToolSpan
- Counted by `ToolFailureTracker`
- After 3 consecutive failures of the same tool, the circuit breaker trips

### Circuit Breaker Interaction

The circuit breaker (`CircuitBreaker` class) fires _before_ dispatch:

1. `circuitBreaker.recordAction(toolName, args)` -- checks for repetitive calls
2. If tripped, throws `Guardrail: Circuit breaker tripped` immediately
3. The tool is never dispatched (neither local nor MCP)

This means MCP network failures count toward the same circuit breaker threshold
as local failures. Three consecutive MCP timeouts for the same tool will trip
the breaker.

---

## 6. Telemetry & Observability

### ToolSpan Fields

Every tool invocation records a `ToolSpan` object with these dispatch-relevant
fields:

| Field          | Type                   | Description                                        |
| -------------- | ---------------------- | -------------------------------------------------- |
| `toolName`     | `string`               | Canonical tool name (e.g., `getQuote`)             |
| `executor`     | `'local' \| 'mcp'`     | Which execution path ran                           |
| `mcpRequestId` | `string \| null`       | MCP correlation ID (e.g., `mcp-1709123456-a3f2k1`) |
| `mcpLatencyMs` | `number \| null`       | MCP round-trip time in ms                          |
| `latencyMs`    | `number`               | Total execution time (includes MCP latency)        |
| `status`       | `'success' \| 'error'` | Outcome                                            |

### How to Prove MCP Executed

In Braintrust dashboard:

1. Filter by tag `tools_used`
2. Expand a trace's tool spans
3. Check `metadata.executor` field:
   - `"local"` = ran in-process
   - `"mcp"` = ran via MCP server
4. Check `metadata.mcpRequestId` for correlation
5. Check `metrics.mcp_latency_ms` for MCP round-trip time

### Braintrust Span Structure

```
Root span (ai-chat)
  +-- LLM span (llm_generation)
  +-- ReAct iteration span (react_iteration_1)
  |     +-- Tool span (tool:getQuote)
  |           metadata: {
  |             toolName: "getQuote",
  |             executor: "mcp",
  |             mcpRequestId: "mcp-1709123456-a3f2k1",
  |             mcpLatencyMs: 120,
  |             status: "success"
  |           }
  |           metrics: {
  |             latency_ms: 125,
  |             mcp_latency_ms: 120
  |           }
  +-- Verification span
```

### Debugging MCP Failures

1. **Check logs**: `McpClientService` logs at DEBUG level:

   ```
   MCP callTool -> getQuote (timeout=30000ms, reqId=mcp-xxx)
   MCP callTool <- getQuote OK (120ms, reqId=mcp-xxx)
   ```

2. **Check ToolSpan**: If `executor=mcp` and `status=error`, the `error` field
   contains the failure reason.

3. **Check mcpRequestId**: Use this ID to correlate with MCP server logs.

4. **Check schema validation**: If `ToolDispatcherService` logs a WARN like
   `MCP output schema validation failed for getQuote: ...`, the MCP server
   returned data that doesn't match the expected Zod schema.

---

## 7. Integration Risks & Mitigations

### Risk 1: Tool Name Mismatch

| Aspect         | Detail                                                                                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Risk**       | MCP server renames a tool method but Ghostfolio still sends the old name                                                                                                                                                                                        |
| **Impact**     | MCP returns 404 or unknown method error; tool fails silently                                                                                                                                                                                                    |
| **Mitigation** | `mcp-tool-map.ts` is the single source of truth. Update the _value_ (MCP method name) without changing the _key_ (canonical name). The `getMcpMethodName()` function returns `undefined` for unmapped tools, which throws an explicit error in `dispatchMcp()`. |

### Risk 2: Output Schema Enforcement

| Aspect         | Detail                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Risk**       | MCP server returns data that doesn't match `OUTPUT_SCHEMA_REGISTRY` Zod schema                                                                                                                                                  |
| **Impact**     | Tool call reported as error; LLM receives error message instead of data                                                                                                                                                         |
| **Mitigation** | `ToolDispatcherService.dispatchMcp()` runs `outputSchema.safeParse()` on every MCP result. Schema failures produce a structured error result with clear message. Test with `tool-dispatcher.spec.ts` "schema validation" suite. |

### Risk 3: Verification Contract

| Aspect         | Detail                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Risk**       | MCP server returns results without `verification` object; downstream code assumes it exists                                                                                                                 |
| **Impact**     | Null reference errors in verification gate, telemetry, and groundedness check                                                                                                                               |
| **Mitigation** | Verification wrapper in `dispatchMcp()` adds a default `verification` object if missing. Confidence is set to 0.85 for success, 0.1 for error. The wrapper includes a warning so it's visible in telemetry. |

### Risk 4: No Retry Logic

| Aspect         | Detail                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Risk**       | Transient MCP network errors (DNS, TCP reset) fail the tool call permanently                                                                                                                          |
| **Impact**     | One flaky network request = one failed tool = degraded user response                                                                                                                                  |
| **Mitigation** | Currently accepted risk. MCP failures count toward `ToolFailureTracker` (3 failures = abort). For future improvement: add 1 transport-level retry with 2s delay inside `McpClientService.callTool()`. |

### Risk 5: Timeout Stacking

| Aspect         | Detail                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Risk**       | MCP 30s timeout + LLM processing can exceed the 45s overall timeout                                                                                                                               |
| **Impact**     | `Promise.race` fires the overall timeout, aborting the entire request                                                                                                                             |
| **Mitigation** | Currently, the 30s MCP timeout leaves 15s buffer for LLM + overhead. For multi-tool queries (2+ MCP calls), the risk increases. Future improvement: pass `remainingMs - 2000` as the MCP timeout. |

### Risk 6: SSE Streaming Delay

| Aspect         | Detail                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Risk**       | MCP network latency causes reasoning panel steps to appear in bursts rather than live-streaming                                                                                                        |
| **Impact**     | UX feels less responsive; steps animate all at once instead of progressively                                                                                                                           |
| **Mitigation** | The reasoning panel already uses stagger animation (80ms per step) with `ReplaySubject(50)` buffering. MCP latency manifests as a longer gap before the tool_result step appears, which is acceptable. |

---

## 8. How to Add a New MCP Tool (Runbook)

Follow these steps exactly when routing an additional tool to MCP.

### Step 1: Verify the tool exists in the registry

Confirm the tool is registered in `OUTPUT_SCHEMA_REGISTRY` in `ai.service.ts`
(all 10 tools are already there):

```typescript
const OUTPUT_SCHEMA_REGISTRY: Record<string, ZodType> = {
  getPortfolioSummary: GetPortfolioSummaryOutputSchema,
  // ...
  getNews: GetNewsOutputSchema // <-- your tool
};
```

### Step 2: Verify the Zod schema exists

Confirm the input and output schemas exist in
`apps/api/src/app/endpoints/ai/tools/schemas/`:

```
get-news.schema.ts   -->  GetNewsInputSchema, GetNewsOutputSchema
```

### Step 3: Verify `MCP_TOOL_MAP` entry

Confirm the tool is mapped in `mcp-tool-map.ts`:

```typescript
export const MCP_TOOL_MAP: Record<string, string> = {
  // ...
  getNews: 'getNews' // <-- canonical: MCP method name
};
```

All 10 tools are already mapped. If the MCP server uses a different method
name, update the value only.

### Step 4: Add to hybrid allowlist

Edit `mcp-tool-map.ts`:

```typescript
export const MCP_HYBRID_ALLOWLIST = new Set<string>([
  'getQuote',
  'getNews' // <-- add here
]);
```

### Step 5: Deploy with `TOOLS_DISPATCH_MODE=hybrid`

Set the env var in Railway and restart. Only allowlisted tools will route to
MCP; all others continue running locally.

### Step 6: Add integration test

Add a test case in `tool-dispatcher.spec.ts`:

```typescript
it('should route getNews (allowlisted) to MCP', async () => {
  const dispatcher = createDispatcher('hybrid');
  mockMcpClientService.callTool.mockResolvedValue({
    result: { status: 'success', data: { ... }, message: '...',
              verification: createVerificationResult({ ... }) },
    mcpRequestId: 'mcp-news-test',
    mcpLatencyMs: 100
  });

  const dispatched = await dispatcher.dispatch(
    'getNews', { symbol: 'AAPL' }, () => MOCK_LOCAL_RESULT
  );

  expect(dispatched.executor).toBe('mcp');
});
```

### Step 7: Verify telemetry

After deployment, check Braintrust:

1. Trigger a query that uses the new tool (e.g., "What's the latest news on AAPL?")
2. Find the trace in Braintrust
3. Expand the tool span for `getNews`
4. Confirm `metadata.executor === "mcp"`
5. Confirm `metrics.mcp_latency_ms` is populated
6. Confirm `metadata.mcpRequestId` is populated

### Step 8: Monitor for 24h

Watch for:

- Schema validation failures (WARN logs from ToolDispatcherService)
- Increased error rates for the tool
- Latency regression (compare `mcp_latency_ms` to historical local `latency_ms`)

---

## 9. Rollback Procedure

### Immediate Rollback (< 1 minute)

1. Set `TOOLS_DISPATCH_MODE=local` in Railway Variables
2. Restart the service
3. All tools immediately execute locally

**No code changes, no schema changes, no database migrations required.**

### Partial Rollback (hybrid mode)

1. Remove the problematic tool from `MCP_HYBRID_ALLOWLIST` in `mcp-tool-map.ts`
2. Deploy the code change
3. The removed tool falls back to local execution; other allowlisted tools
   continue via MCP

### Verification After Rollback

1. Check Braintrust for new traces
2. Confirm all tool spans show `executor: "local"`
3. Confirm no `mcpRequestId` or `mcpLatencyMs` values are populated
4. Confirm tool success rates return to baseline

---

## 10. Test Strategy

### Unit Tests (15 tests in `tool-dispatcher.spec.ts`)

| Suite                        | Tests | Verifies                                                  |
| ---------------------------- | ----- | --------------------------------------------------------- |
| mode=local                   | 3     | Local fn called, MCP never called, mode getter            |
| mode=hybrid                  | 3     | Allowlisted to MCP, non-allowlisted to local, mode getter |
| mode=mcp                     | 2     | All tools to MCP, error when MCP not configured           |
| MCP output schema validation | 2     | Valid result passes, invalid result returns error         |
| Verification wrapper         | 2     | Adds verification when missing, preserves existing        |
| ToolSpan metadata            | 2     | executor/mcpRequestId/mcpLatencyMs in dispatch result     |
| Invalid mode handling        | 1     | Unrecognized mode defaults to local                       |

### Telemetry Snapshot Tests (20 tests in `ai-chat-telemetry.spec.ts`)

These tests construct a full `AiService` with a mock `ToolDispatcherService`
(mode=local, pass-through dispatch) and verify:

- Tool spans include `executor: "local"`, `mcpRequestId: null`, `mcpLatencyMs: null`
- Snapshot matches after adding the new fields
- All existing telemetry behavior is preserved

### Manual Verification Steps

**Test 1: Local mode (default)**

```bash
# Ensure TOOLS_DISPATCH_MODE is unset or set to "local"
curl -X POST /api/v1/ai/chat \
  -d '{"message": "What is the price of AAPL?", ...}'
# Check Braintrust: executor should be "local" for getQuote span
```

**Test 2: Hybrid mode with getQuote**

```bash
export TOOLS_DISPATCH_MODE=hybrid
# Restart service
curl -X POST /api/v1/ai/chat \
  -d '{"message": "What is the price of AAPL?", ...}'
# Check Braintrust:
#   - getQuote span: executor="mcp", mcpRequestId="mcp-...", mcpLatencyMs=120
#   - Other tools (if called): executor="local"
```

### Example: Expected ToolSpan for getQuote via MCP

```json
{
  "spanId": "a1b2c3d4-...",
  "traceId": "e5f6g7h8-...",
  "toolName": "getQuote",
  "toolInput": { "symbols": ["AAPL"] },
  "toolOutput": {
    "status": "success",
    "message": "Fetched 1 of 1 quotes.",
    "confidence": 0.85
  },
  "latencyMs": 125,
  "status": "success",
  "error": null,
  "retryCount": 0,
  "iterationIndex": 1,
  "executor": "mcp",
  "mcpRequestId": "mcp-1709123456-a3f2k1",
  "mcpLatencyMs": 120,
  "startedAt": "2026-02-28T12:00:00.000Z",
  "endedAt": "2026-02-28T12:00:00.125Z"
}
```

---

## 11. Performance Considerations

### MCP Adds Network Latency

Local tool execution is in-process (0ms network overhead). MCP adds:

- DNS resolution (cached after first call)
- TCP connection (HTTP keep-alive mitigates)
- TLS handshake (if HTTPS)
- Serialization/deserialization (JSON)
- MCP server processing time

**Expected overhead**: 50-200ms per MCP call (p95), depending on network
topology. If MCP server is co-located (same Railway project), expect 10-50ms.

### Impact on User-Facing Latency

| Scenario         | Local p95 | MCP p95 (est.) | Delta  |
| ---------------- | --------- | -------------- | ------ |
| Single tool call | ~2s       | ~2.2s          | +200ms |
| Two tool calls   | ~3s       | ~3.4s          | +400ms |
| Three tool calls | ~4s       | ~4.6s          | +600ms |

These estimates assume sequential tool calls (ReAct loop). The LLM step
dominates total latency (typically 1-3s per iteration).

### SSE UX Mitigation

The reasoning panel streams steps via SSE. MCP latency manifests as a longer
gap between "Calling getQuote" (tool_call step) and "Result received"
(tool_result step). The stagger animation (80ms per step) smooths this.

### Monitoring Thresholds

| Metric               | Healthy | Warning   | Critical |
| -------------------- | ------- | --------- | -------- |
| `mcp_latency_ms` p95 | < 200ms | 200-500ms | > 500ms  |
| MCP error rate       | < 1%    | 1-5%      | > 5%     |
| Total latency delta  | < 500ms | 500ms-1s  | > 1s     |

Monitor these in Braintrust by filtering tool spans where `executor=mcp` and
comparing `mcp_latency_ms` distributions over time.
