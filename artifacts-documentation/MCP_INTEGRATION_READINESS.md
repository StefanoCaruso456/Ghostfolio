# MCP Integration Readiness Audit

## 1. Full `generateText()` Call Block

**File:** `apps/api/src/app/endpoints/ai/ai.service.ts` (lines 639–870)

```typescript
const generatePromise = generateText({
  abortSignal: abortController.signal,
  maxSteps: MAX_ITERATIONS,              // 10
  model: openRouterService.chat(modelId),
  messages,
  tools: {
    getPortfolioSummary: tool({ ... }),
    listActivities:      tool({ ... }),
    getAllocations:       tool({ ... }),
    getPerformance:      tool({ ... }),
    getQuote:            tool({ ... }),
    getHistory:          tool({ ... }),
    getFundamentals:     tool({ ... }),
    getNews:             tool({ ... }),
    computeRebalance:    tool({ ... }),
    scenarioImpact:      tool({ ... }),
  }
});

const result = await Promise.race([generatePromise, timeoutPromise]);
```

**Key details:**

- `generateText` from `ai` (Vercel AI SDK)
- `tool` from `ai` (Vercel AI SDK)
- Provider: `createOpenRouter` from `@openrouter/ai-sdk-provider`
- Model resolved from `PROPERTY_OPENROUTER_MODEL` (admin-configurable)
- `maxSteps: 10` controls the ReAct loop iteration cap
- Timeout is enforced via `Promise.race` with an AbortController

---

## 2. Tools Object Construction — All 10 Tools

Every tool follows the **exact same pattern**:

```typescript
toolName: tool({
  description: '...',
  parameters: ZodInputSchema,
  execute: async (args) => {
    return executeWithGuardrails(
      'toolName',
      args as unknown as Record<string, unknown>,
      async () => {
        // actual execution logic
        return result as ToolOutput<...>;
      }
    );
  }
})
```

### Complete Tool Registry

| #   | Tool Name             | Category  | Input Schema                     | Data Source                            |
| --- | --------------------- | --------- | -------------------------------- | -------------------------------------- |
| 1   | `getPortfolioSummary` | Portfolio | `GetPortfolioSummaryInputSchema` | `portfolioService.getDetails()`        |
| 2   | `listActivities`      | Portfolio | `ListActivitiesInputSchema`      | `orderService.getOrders()`             |
| 3   | `getAllocations`      | Portfolio | `GetPortfolioSummaryInputSchema` | `portfolioService.getDetails()`        |
| 4   | `getPerformance`      | Portfolio | `GetPerformanceInputSchema`      | `portfolioService.getPerformance()`    |
| 5   | `getQuote`            | Market    | `GetQuoteInputSchema`            | yahoo-finance2 v3                      |
| 6   | `getHistory`          | Market    | `GetHistoryInputSchema`          | yahoo-finance2 v3                      |
| 7   | `getFundamentals`     | Market    | `GetFundamentalsInputSchema`     | yahoo-finance2 v3                      |
| 8   | `getNews`             | Market    | `GetNewsInputSchema`             | yahoo-finance2 v3                      |
| 9   | `computeRebalance`    | Decision  | `ComputeRebalanceInputSchema`    | `portfolioService.getDetails()` + math |
| 10  | `scenarioImpact`      | Decision  | `ScenarioImpactInputSchema`      | `portfolioService.getDetails()` + math |

### Tool `execute` Signature

```typescript
// Vercel AI SDK tool() type:
tool<TInput extends ZodType, TOutput>({
  description: string,
  parameters: TInput,         // Zod schema (auto-converted to JSON Schema for the LLM)
  execute: (args: z.infer<TInput>) => Promise<TOutput>
})
```

### Tool Output Shape (All tools return this)

```typescript
interface ToolOutput {
  status: 'success' | 'error';
  data?: unknown;
  message: string;
  verification: {
    passed: boolean;
    confidence: number; // 0–1
    warnings: string[];
    errors: string[];
    sources: string[];
    verificationType:
      | 'fact_check'
      | 'hallucination_detection'
      | 'confidence_scoring'
      | 'domain_constraint'
      | 'human_in_the_loop'
      | 'composite';
    factCheckPassed?: boolean;
    hallucinationFlags?: string[];
    domainRulesChecked?: string[];
    domainRulesFailed?: string[];
    requiresHumanReview?: boolean;
    escalationReason?: string;
  };
  meta?: {
    schemaVersion: string; // '1.0'
    source: string;
    providerLatencyMs?: number;
    cacheHit?: boolean;
  };
}
```

---

## 3. Full `executeWithGuardrails()` Function

**File:** `apps/api/src/app/endpoints/ai/ai.service.ts` (lines 468–613)

```typescript
const executeWithGuardrails = <
  T extends { status: string; verification: VerificationResult }
>(
  toolName: string,
  args: Record<string, unknown>,
  executeFn: () => T | Promise<T>
): Promise<T & { schemaVersion: string }> => {
  return (async () => {
    // 1. Circuit breaker check
    if (circuitBreaker.recordAction(toolName, args)) {
      const reason = circuitBreaker.getTripReason();
      trace.addGuardrail('circuit_breaker');
      throw new Error(`Guardrail: ${reason}`);
    }

    // 2. Cost limit check
    if (costLimiter.isExceeded()) {
      trace.addGuardrail('cost_limit');
      throw new Error(
        `Guardrail: Cost limit exceeded ($${costLimiter.getAccumulatedCost().toFixed(4)})`
      );
    }

    // 3. Tool failure backoff check
    if (failureTracker.isAborted()) {
      trace.addGuardrail('tool_failure_backoff');
      throw new Error(`Guardrail: ${failureTracker.getAbortReason()}`);
    }

    iterationCount++;

    // 4. Emit reasoning trace events
    reasoningCtx.addAnalysisSummary(`Retrieving data using ${toolName} tool`);
    const reasoningStep = reasoningCtx.startToolCall(toolName, args);
    const spanBuilder = trace.startToolSpan(toolName, args, iterationCount);
    const start = Date.now();

    // 5. Execute the tool
    let result = await executeFn();
    const durationMs = Date.now() - start;

    // 6. Runtime Zod output schema validation
    const outputSchema = OUTPUT_SCHEMA_REGISTRY[toolName];
    if (outputSchema) {
      const validation = outputSchema.safeParse(result);
      if (!validation.success) {
        result = {
          status: 'error',
          data: (result as Record<string, unknown>).data,
          message: `Output schema validation failed: ${zodErrors}`,
          verification: createVerificationResult({ passed: false, confidence: 0, ... })
        } as unknown as T;
      }
    }

    // 7. Track failures
    if (result.status === 'error') {
      if (failureTracker.recordFailure(toolName)) {
        throw new Error(`Guardrail: ${failureTracker.getAbortReason()}`);
      }
    }

    // 8. Verification gate enforcement
    const gate = enforceVerificationGate(result.verification, {
      highStakes: false,
      minConfidence: 0.5
    });
    // gate.decision: 'allow' | 'block' | 'human_review'

    // 9. Record telemetry span
    trace.addToolSpan(spanBuilder.end({
      status: result.status === 'error' ? 'error' : 'success',
      toolOutput: { status, message, confidence },
      error: spanError
    }));

    // 10. Record for response metadata
    toolCallRecords.push({ tool: toolName, args, status, verification, durationMs });

    // 11. Complete reasoning trace step
    reasoningCtx.completeToolCall(reasoningStep.id, { ... }, status, durationMs);

    return { ...result, schemaVersion: TOOL_RESULT_SCHEMA_VERSION };
  })();
};
```

### Error surfacing to the LLM

Errors are surfaced as **thrown exceptions**. The Vercel AI SDK catches these and feeds them back to the model as tool error results, which the model sees and can react to.

Guardrail errors throw `new Error('Guardrail: ...')` — the LLM sees this as a tool failure and adjusts behavior.

---

## 4. Current Timeout / Retry Policy

### Timeouts

| Scope           | Value                           | Implementation                        |
| --------------- | ------------------------------- | ------------------------------------- |
| Overall request | 45s (base), 90s (multimodal)    | `Promise.race` + `AbortController`    |
| MCP RPC calls   | 30s                             | `AbortController` in McpClientService |
| Per-tool        | None (inherits request timeout) | Tools don't have individual timeouts  |

### Retry Policy

**There is NO retry logic.** Tool failures are:

1. Tracked by `ToolFailureTracker`
2. After repeated failures → abort via guardrail
3. Error surfaced to LLM, which may choose a different tool

### Circuit Breaker

```typescript
const CIRCUIT_BREAKER_MAX_REPETITIONS = 3;
```

- Normalizes args (trim strings, round numbers, bucket arrays)
- Creates SHA-256 signature of `toolName:normalizedArgs`
- Trips after 3 identical calls → throws `Guardrail: Tool X called N times with similar args`

### Cost Limiter

```typescript
const COST_LIMIT_USD = 1.0;
```

- Accumulates estimated cost per tool call
- Warns at 80% ($0.80)
- Blocks at 100% ($1.00) → throws `Guardrail: Cost limit exceeded`

---

## 5. McpClientService Internals

**File:** `apps/api/src/app/endpoints/ai/mcp/mcp-client.service.ts`

### Transport: HTTP POST with JSON-RPC

```typescript
// Request shape
POST {MCP_SERVER_URL}/rpc
Content-Type: application/json
x-mcp-api-key: {MCP_API_KEY}  // optional

{
  "method": "getDashboardConfig",
  "params": { "userId": "uuid-string" }
}

// Response: raw JSON (no wrapper), decoded as-is
```

### Configuration

```
# .env.example
MCP_SERVER_URL=   # URL of the ghostfolio-mcp-server (e.g. http://localhost:3001)
MCP_API_KEY=      # API key for authenticating with the MCP server
```

### Error Handling

```typescript
if (!response.ok) {
  throw new Error(`MCP server returned ${response.status}: ${errorText}`);
}

// AbortError on timeout (30s)
if (error?.name === 'AbortError') {
  throw new Error(`MCP server request timed out after 30000ms`);
}
```

### Discovery / Handshake

**None.** There is no `tools/list` handshake. Tools are statically defined in `ai.service.ts`. MCP is currently used only for `getDashboardConfig` — a single RPC call, not tool execution.

### Tool Name Mapping

- **Local tools:** camelCase (`getPortfolioSummary`, `listActivities`, etc.)
- **MCP methods:** camelCase (`getDashboardConfig`)
- **No mapping layer exists** — local and MCP names must match exactly

---

## 6. Existing Trace/Log Format for Tool Calls

### ToolSpan Interface

```typescript
interface ToolSpan {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: Record<string, unknown>;
  status: 'success' | 'error' | 'timeout';
  latencyMs: number;
  iterationIndex: number;
  error?: string;
  wasCorrectTool: boolean | null; // Human-annotated post-hoc
  // Provider metadata (optional)
  providerName?: string | null;
  assetType?: string | null;
  normalizedSymbol?: string | null;
  requestId?: string | null;
}
```

### Braintrust Logging Hierarchy

```
Root span (request-level: timing, cost, confidence, safety)
  └─ LLM span (generateText call: model, tokens, latency)
  └─ Tool span × N (per-tool: name, input, output, status, latency)
  └─ Verification span (groundedness, hallucination flags)
```

---

## 7. Scoring Functions & MCP Impact

### 8 Eval Scorers (`eval-scorers.ts`)

| Scorer               | What it measures         | Ground truth                   | MCP-safe? |
| -------------------- | ------------------------ | ------------------------------ | --------- |
| `scoreToolSelection` | Right tool chosen?       | `wasCorrectTool` (human label) | YES       |
| `scoreToolExecution` | Tool succeeded?          | `ToolSpan.status` field        | YES       |
| `scoreGroundedness`  | Response uses tool data? | Deterministic regex            | YES       |
| `scoreSafety`        | No escalation triggered? | Escalation flag                | YES       |
| `scoreLatency`       | Response time bands      | `totalLatencyMs`               | YES\*     |
| `scoreCost`          | Cost bands               | `estimatedCostUsd`             | YES\*     |
| `scoreCorrectness`   | Proxy via confidence     | `confidenceScore`              | YES       |
| `scoreRelevance`     | Proxy via confidence     | `confidenceScore`              | YES       |

**\*Latency and cost may shift** with MCP network overhead but scorers themselves won't break.

### Golden Set (54 test cases)

Tool selection checked via:

```typescript
const toolSelectionPassed = testCase.expectedTools.every((t) =>
  toolsUsedSet.has(t)
);
```

- Uses **tool names** (`getQuote`, `getPortfolioSummary`, etc.)
- MCP tool names must match these exactly or golden tests will fail

---

## 8. Critical Integration Risks

### Risk 1: Tool Name Mismatch

**Current:** 10 local tools with camelCase names (`getPortfolioSummary`, etc.)
**MCP needs:** Tool names on the MCP server must match EXACTLY, or:

- LLM won't find the tool
- Golden set tests will fail (`expectedTools` comparison)
- Braintrust spans will show wrong tool names

### Risk 2: Output Schema Enforcement

**Current:** `OUTPUT_SCHEMA_REGISTRY` validates every tool result with Zod
**MCP needs:** MCP tool results must conform to the same Zod output schemas, or `executeWithGuardrails` will mark them as errors

### Risk 3: Verification Contract

**Current:** Every tool result includes `verification: { passed, confidence, warnings, errors, sources }`
**MCP needs:** MCP must return this exact shape or the verification gate will throw

### Risk 4: No Retry Logic

**Current:** No retries. Failure → ToolFailureTracker → eventual abort
**MCP impact:** Network failures will be treated identically to data errors. Consider adding transport-level retries before they reach the failure tracker.

### Risk 5: Timeout Stacking

**Current:** 45s overall + 30s MCP timeout
**MCP impact:** If a tool is routed through MCP (30s timeout) and the overall request is at 44s, the MCP timeout won't save you — the request timeout fires first. Need coordinated timeouts.

### Risk 6: SSE Streaming Delay

MCP round-trip latency will delay reasoning trace events. The `ReplaySubject(50)` buffer handles this, but step animations may appear in bursts rather than progressively.

---

## 9. Recommended MCP Integration Strategy

1. **Preserve `executeWithGuardrails` as the single dispatch point** — don't bypass it
2. **Add a transport layer** inside `executeWithGuardrails` that decides local vs MCP per tool
3. **MCP tool results must be normalized** to match `ToolOutput` shape before Zod validation
4. **Add transport-level retries (1–2)** for MCP calls only (not local tools)
5. **Coordinate timeouts**: `mcpTimeout = min(MCP_TIMEOUT, remainingRequestTimeout - 2s)`
6. **Golden set tool names are the canonical registry** — MCP server must use identical names
