# System Architecture: AI Tools & Agent System

> **Generated**: 2026-02-28 | **Status**: Read-only audit (no behavior changes)

---

## 1. Request Flow (Controller -> Service -> LLM -> Tool Executor)

```
HTTP POST /api/v1/ai/chat
   |
   v
AiController.chat()
   File: apps/api/src/app/endpoints/ai/ai.controller.ts
   Guards: AuthGuard('jwt'), HasPermissionGuard (readAiPrompt)
   Input: AiChatDto { message, history, conversationId, attachments }
   |
   v
AiService.chat()
   File: apps/api/src/app/endpoints/ai/ai.service.ts (1452 lines)
   Orchestrator — builds system prompt, initializes guardrails, runs ReAct loop
   |
   +--> buildReActSystemPrompt()          (lines 144-232)
   +--> CircuitBreaker.create()           (guardrails/circuit-breaker.ts)
   +--> CostLimiter.create($1.00 max)     (guardrails/cost-limiter.ts)
   +--> ToolFailureTracker.create()       (guardrails/tool-failure-tracker.ts)
   +--> TraceContext.create(traceId)      (reasoning/trace-context.ts)
   |
   v
generateText()   [Vercel AI SDK]
   Provider: OpenRouter (createOpenRouter)
   Model: configurable via PROPERTY_OPENROUTER_MODEL
   maxSteps: 10 (MAX_ITERATIONS)
   Timeout: 90s base / 180s multimodal
   |
   +-- LLM selects tool --> executeWithGuardrails(toolName, args, executeFn)
   |                           File: ai.service.ts lines 520-681
   |                           1. Circuit breaker check
   |                           2. Cost limit check
   |                           3. Tool failure backoff check
   |                           4. Execute tool function
   |                           5. Zod output schema validation
   |                           6. Failure tracking
   |                           7. Verification gate enforcement
   |                           8. Emit reasoning trace (SSE)
   |                           9. Record tool span (Braintrust)
   |
   +-- LLM outputs final text
   |
   v
Post-processing
   +--> checkGroundedness()               (lines 1171-1249)
   +--> BraintrustTelemetryService.logTrace()
   +--> AiConversationService.addMessages()
   +--> ReasoningTraceService.persistTrace()
   |
   v
Response: AiChatResponse { message, traceId, conversationId }
```

### NestJS Module Wiring

**File**: `apps/api/src/app/endpoints/ai/ai.module.ts`

| Layer         | Class                        | File                                        |
| ------------- | ---------------------------- | ------------------------------------------- |
| Controller    | `AiController`               | `ai.controller.ts`                          |
| Controller    | `AiConversationController`   | `conversation/conversation.controller.ts`   |
| Controller    | `AiMetricsController`        | `metrics/ai-metrics.controller.ts`          |
| Controller    | `ReasoningController`        | `reasoning/reasoning.controller.ts`         |
| Orchestrator  | `AiService`                  | `ai.service.ts`                             |
| Conversations | `AiConversationService`      | `conversation/conversation.service.ts`      |
| Telemetry     | `BraintrustTelemetryService` | `telemetry/braintrust-telemetry.service.ts` |
| Metrics       | `AiMetricsService`           | `metrics/ai-metrics.service.ts`             |
| SSE Streaming | `ReasoningTraceService`      | `reasoning/reasoning-trace.service.ts`      |
| MCP Client    | `McpClientService`           | `mcp/mcp-client.service.ts`                 |

---

## 2. TOOLS_INVENTORY

### Tool Registration

**Where tools are declared**: Each tool has a dedicated `*.tool.ts` file + a `*.schema.ts` file for Zod schemas.

**Where tools are registered**: `ai.service.ts` lines 100-111 (`OUTPUT_SCHEMA_REGISTRY`) + lines 777-1007 (inline `tool()` calls inside `generateText()`).

**Where tools are sent to the LLM**: `ai.service.ts` inside `generateText({ tools: { ... } })` — each tool is wrapped with Vercel AI SDK's `tool()` factory providing `description`, `parameters` (Zod), and `execute` callback.

**Where tools are executed**: `executeWithGuardrails()` wrapper at `ai.service.ts` lines 520-681, called from each tool's `execute` callback.

### Complete Tool Table

| #   | toolName              | Description (LLM sees)                                                                         | Input Schema (Zod)                                                                                                                                                           | Output Shape                                                                                                                                                                                 | Implementation File                   | Execution Layer                                      | Observability                                                 |
| --- | --------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| 1   | `getPortfolioSummary` | Holdings count, top holdings, accounts. Use for overview questions.                            | `{ userCurrency: string }`                                                                                                                                                   | `{ status, data: { holdingsCount, cashPct, investedPct, topHoldingsByAllocation[], accountsCount, baseCurrency }, message, verification, quoteMetadata }`                                    | `tools/get-portfolio-summary.tool.ts` | Direct service call → `PortfolioService`             | Braintrust span + SSE trace + Zod validation                  |
| 2   | `listActivities`      | Trades, dividends, fees with date/type filtering. Use for transaction history.                 | `{ startDate?: string, endDate?: string, types?: enum[], symbol?: string, limit?: number(max 100) }`                                                                         | `{ status, data: { activities[], totalCount, returnedCount, totalFees, totalDividends, dateRange }, message, verification }`                                                                 | `tools/list-activities.tool.ts`       | DB query → `OrderService`                            | Braintrust span + SSE trace + Zod validation                  |
| 3   | `getAllocations`      | Allocation by asset class, currency, sector. Use for diversification questions.                | `{ userCurrency: string }`                                                                                                                                                   | `{ status, data: { byAssetClass[], byAssetSubClass[], byCurrency[], bySector[], holdingsCount }, message, verification, quoteMetadata }`                                                     | `tools/get-allocations.tool.ts`       | Direct service call → `PortfolioService`             | Braintrust span + SSE trace + Zod validation                  |
| 4   | `getPerformance`      | Returns, net performance, investment totals. Use for performance questions.                    | `{ dateRange?: enum('1d','1w','1m','3m','6m','ytd','1y','3y','5y','max') }`                                                                                                  | `{ status, data: { currentNetWorth, currentValueInBaseCurrency, totalInvestment, netPerformance, netPerformancePct, annualizedPerformancePct, ... }, message, verification, quoteMetadata }` | `tools/get-performance.tool.ts`       | Direct service call → `PortfolioService`             | Braintrust span + SSE trace + Zod validation                  |
| 5   | `getQuote`            | Real-time quotes for 1-25 symbols. Use for current prices and daily changes.                   | `{ symbols: string[](1-25), assetType?: enum('stock','etf','crypto','fx'), quoteCurrency?: string }`                                                                         | `{ status, data: { quotes[], errors[], requestedCount, returnedCount }, message, verification, meta }`                                                                                       | `tools/get-quote.tool.ts`             | HTTP call → Market data providers (Yahoo, CoinGecko) | Braintrust span + SSE trace + Zod validation + cache tracking |
| 6   | `getHistory`          | Historical price data with optional returns/volatility/drawdown. Use for trend analysis.       | `{ symbol: string, range: enum('5d','1mo','3mo','6mo','1y','5y'), interval?: enum('1d','1wk'), includeReturns?: boolean }`                                                   | `{ status, data: { symbol, points[], pointCount, truncated, range, interval, returns? }, message, verification, meta }`                                                                      | `tools/get-history.tool.ts`           | HTTP call → Market data providers                    | Braintrust span + SSE trace + Zod validation                  |
| 7   | `getFundamentals`     | P/E, EPS, market cap, dividend yield, sector, industry. Use for fundamental analysis.          | `{ symbol: string }`                                                                                                                                                         | `{ status, data: { symbol, marketCap, pe, forwardPe, eps, dividendYield, sector, industry, updatedAt, source }, message, verification, meta }`                                               | `tools/get-fundamentals.tool.ts`      | HTTP call → Market data providers                    | Braintrust span + SSE trace + Zod validation                  |
| 8   | `getNews`             | Recent news items for a symbol. Use for market context.                                        | `{ symbol: string, limit?: number(1-10), recencyDays?: number(1-30) }`                                                                                                       | `{ status, data: { symbol, items[], returnedCount, recencyDays }, message, verification, meta }`                                                                                             | `tools/get-news.tool.ts`              | HTTP call → News providers                           | Braintrust span + SSE trace + Zod validation                  |
| 9   | `computeRebalance`    | Compare current vs target allocation and compute deltas. Use when user asks about rebalancing. | `{ baseCurrency?: string, targetAllocations: { assetClass?: Record, sector?: Record, symbols?: Record }, constraints?: { maxSingleNamePct?, minCashPct?, ignoreSymbols? } }` | `{ status, data: { allocationType, currentAllocations[], suggestedMoves[], constraintViolations[], note }, message, verification, quoteMetadata, meta }`                                     | `tools/compute-rebalance.tool.ts`     | Computation + `PortfolioService`                     | Braintrust span + SSE trace + Zod validation                  |
| 10  | `scenarioImpact`      | Estimate portfolio impact of hypothetical shocks. Use for "what if" questions.                 | `{ shocks: { symbolOrBucket: string, shockPct: number }[](1-20), horizon?: enum('1d','1wk','1mo'), assumeCashStable?: boolean }`                                             | `{ status, data: { estimatedPortfolioImpactPct, estimatedImpactByBucket[], assumptions[], missingMappings[], horizon }, message, verification, quoteMetadata, meta }`                        | `tools/scenario-impact.tool.ts`       | Computation + `PortfolioService`                     | Braintrust span + SSE trace + Zod validation                  |

### Schema Files

All schema files at: `apps/api/src/app/endpoints/ai/tools/schemas/`

| File                          | Input Schema Export              | Output Schema Export              |
| ----------------------------- | -------------------------------- | --------------------------------- |
| `portfolio-summary.schema.ts` | `GetPortfolioSummaryInputSchema` | `GetPortfolioSummaryOutputSchema` |
| `list-activities.schema.ts`   | `ListActivitiesInputSchema`      | `ListActivitiesOutputSchema`      |
| `allocations.schema.ts`       | `GetAllocationsInputSchema`      | `GetAllocationsOutputSchema`      |
| `performance.schema.ts`       | `GetPerformanceInputSchema`      | `GetPerformanceOutputSchema`      |
| `get-quote.schema.ts`         | `GetQuoteInputSchema`            | `GetQuoteOutputSchema`            |
| `get-history.schema.ts`       | `GetHistoryInputSchema`          | `GetHistoryOutputSchema`          |
| `get-fundamentals.schema.ts`  | `GetFundamentalsInputSchema`     | `GetFundamentalsOutputSchema`     |
| `get-news.schema.ts`          | `GetNewsInputSchema`             | `GetNewsOutputSchema`             |
| `compute-rebalance.schema.ts` | `ComputeRebalanceInputSchema`    | `ComputeRebalanceOutputSchema`    |
| `scenario-impact.schema.ts`   | `ScenarioImpactInputSchema`      | `ScenarioImpactOutputSchema`      |
| `verification.schema.ts`      | —                                | `VerificationResultSchema`        |
| `quote-metadata.schema.ts`    | —                                | `QuoteMetadataSchema`             |

---

## 3. Tool Selection Logic

### How the LLM Decides Which Tool to Call

**Mechanism**: Vercel AI SDK function calling via `generateText()`. The LLM receives all 10 tools with their descriptions and Zod-derived JSON schemas in the standard OpenAI function calling format. The model decides autonomously which tool(s) to invoke based on the system prompt's ReAct instructions.

**There is NO custom router or planner** — the model's native function calling capability handles tool selection, guided by the system prompt.

### System Prompt (Tool Selection Guidance)

**File**: `ai.service.ts` lines 144-232 (`buildReActSystemPrompt()`)

Key excerpts that guide tool selection:

```
# ReAct Protocol (MANDATORY)
1. **THINK**: What data do I need to answer this question?
2. **ACT**: Call the appropriate tool(s) to retrieve that data.
3. **OBSERVE**: Read the tool results carefully.
4. **DECIDE**: If I have enough data, compose my answer. If not, call another tool.

## Portfolio Tools
- **getPortfolioSummary**: Holdings count, top holdings, accounts. Use for overview questions.
- **listActivities**: Trades, dividends, fees with date/type filtering. Use for transaction history.
- **getAllocations**: Allocation by asset class, currency, sector. Use for diversification questions.
- **getPerformance**: Returns, net performance, investment totals. Use for performance questions.

## Market Tools
- **getQuote**: Real-time quotes for 1–25 symbols. Use for current prices and daily changes.
- **getHistory**: Historical price data with optional returns/volatility/drawdown. Use for trend analysis.
- **getFundamentals**: Valuation ratios (P/E, EPS, dividend yield, market cap). Use for fundamental analysis.
- **getNews**: Recent news items for a symbol. Use for market context.

## Decision-Support Tools
- **computeRebalance**: Compare current vs target allocation and compute deltas.
- **scenarioImpact**: Estimate portfolio impact of hypothetical shocks.
```

### Code That Assembles Tools for the LLM

**File**: `ai.service.ts` lines 777-1007

```typescript
const generatePromise = generateText({
  abortSignal: abortController.signal,
  maxSteps: MAX_ITERATIONS,  // 10
  model: openRouterService.chat(modelId),
  messages,
  tools: {
    getPortfolioSummary: tool({
      description: 'Get portfolio summary: holdings count, top allocations, accounts',
      parameters: GetPortfolioSummaryInputSchema,
      execute: async (args) => executeWithGuardrails('getPortfolioSummary', args,
        () => buildPortfolioSummary({ ... })
      )
    }),
    listActivities: tool({ ... }),
    getAllocations: tool({ ... }),
    getPerformance: tool({ ... }),
    getQuote: tool({ ... }),
    getHistory: tool({ ... }),
    getFundamentals: tool({ ... }),
    getNews: tool({ ... }),
    computeRebalance: tool({ ... }),
    scenarioImpact: tool({ ... })
  }
});
```

### Tool Argument Validation

**Two-phase validation:**

1. **Input validation** (automatic): Vercel AI SDK validates tool arguments against the Zod `parameters` schema before calling `execute()`. Invalid args cause a schema error returned to the LLM.

2. **Output validation** (explicit): After tool execution, the result is validated against `OUTPUT_SCHEMA_REGISTRY[toolName]` (lines 570-592). If validation fails, the result is replaced with a structured error.

### Fallback "No Tool" Path

When the model responds with text only (no tool calls), `generateText()` returns immediately with the text response. The system then runs `checkGroundedness()` which flags if the response contains numbers not backed by tool data. If no tools were called, confidence defaults to 0.5.

---

## 4. Tracing Map

### Current Tracing Architecture

**Tracer**: Braintrust SDK (`@braintrust/core`)

**File**: `apps/api/src/app/endpoints/ai/telemetry/braintrust-telemetry.service.ts` (647 lines)

**Config**: `BRAINTRUST_API_KEY` + `BRAINTRUST_PROJECT` env vars

### Span Diagram

```
ROOT SPAN (task) ─── traceId ──────────────────────────────────────────────
│ Input: { query, model, userId, systemPromptVersion }
│ Output: { responseText, scores, metrics }
│
├── LLM_GENERATION SPAN (llm) ─────────────────────────────────────────
│   Input: { messages, model, maxSteps }
│   Output: { promptTokens, completionTokens, totalTokens }
│   Timing: llmStartMs → llmEndMs
│
├── REACT_ITERATION_1 SPAN (task) ──────────────────────────────────────
│   ├── TOOL_SPAN: getPortfolioSummary (tool)
│   │   Input: { userCurrency: "USD" }
│   │   Output: { status, confidence, message }
│   │   Timing: startMs → endMs (durationMs)
│   │   Status: success | error
│   │   Error: (if failed)
│   │
│   └── TOOL_SPAN: getPerformance (tool)
│       Input: { dateRange: "1y" }
│       ...
│
├── REACT_ITERATION_2 SPAN (task) ──────────────────────────────────────
│   └── TOOL_SPAN: getQuote (tool)
│       ...
│
├── VERIFICATION SPAN (eval) ───────────────────────────────────────────
│   Groundedness check results
│   Hallucination flags, domain violations
│   Confidence score
│
└── FINAL_RESPONSE SPAN (task) ─────────────────────────────────────────
    Post-processing and formatting duration
```

### Where Spans Are Started/Ended

| Span Type      | Start Location                                                 | End Location                                                       |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| Root span      | `telemetryService.startTrace()` — ai.service.ts ~line 415      | `telemetryService.logTrace()` — ai.service.ts ~line 1140           |
| LLM generation | `trace.markLlmStart()` — ai.service.ts ~line 775               | `trace.markLlmEnd(usage)` — ai.service.ts ~line 1010               |
| Tool span      | `trace.startToolSpan(toolName, args)` — ai.service.ts line 559 | `spanBuilder.end({ status, toolOutput })` — ai.service.ts line 646 |
| Verification   | `trace.markVerificationStart()` — ai.service.ts ~line 1060     | `trace.markVerificationEnd()` — ai.service.ts ~line 1090           |
| Response       | `trace.markResponseStart()` — ai.service.ts ~line 1095         | `trace.markResponseEnd()` — ai.service.ts ~line 1120               |

### Database Persistence Layer

**File**: `apps/api/src/app/endpoints/ai/metrics/ai-metrics.service.ts` (297 lines)

Persisted to PostgreSQL:

- `aiTraceMetric`: traceId, userId, totalLatencyMs, llmLatencyMs, toolLatencyTotalMs, toolCallCount, usedTools, hallucinationFlagCount, verificationPassed, estimatedCostUsd
- `aiFeedback`: rating (UP/DOWN), conversationId, traceId, comment
- `aiVerificationLabel`: isHallucination, verificationShouldHavePassed, notes

### Evaluation Scorers

**File**: `apps/api/src/app/endpoints/ai/telemetry/eval-scorers.ts` (224 lines)

8 scoring functions computed per trace:

1. **Latency**: 1.0 (<2s) → 0.0 (>=10s)
2. **Cost**: 1.0 (<$0.05) → 0.0 (>=$1.00)
3. **Safety**: 1.0 (no escalation) → 0.0 (escalation triggered)
4. **Groundedness**: 1.0 (all tools succeed OR failure acknowledged)
5. **Tool Selection**: proportion of correct tool calls (0.5 default until graded)
6. **Tool Execution**: success rate of tool calls
7. **Correctness**: confidence proxy
8. **Relevance**: confidence proxy

Thresholds: `meetsGoodThreshold(>80%)`, `meetsExcellentThreshold(>90%)`

### Tracing Gaps

| Gap                            | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| No OpenTelemetry               | Only Braintrust-native spans; no OTEL export                       |
| No distributed tracing         | No cross-service trace correlation                                 |
| Fact checking placeholder      | `factCheckPassed` field exists in schema but no external API wired |
| Confidence is heuristic        | Not model-calibrated; uses hardcoded thresholds                    |
| Human feedback doesn't retrain | Labels stored but no feedback loop to model                        |

---

## 5. MCP Readiness Assessment

### Current MCP State: Partially Wired (Dashboard Only)

**File**: `apps/api/src/app/endpoints/ai/mcp/mcp-client.service.ts` (162 lines)

**What exists:**

- `McpClientService` — HTTP JSON-RPC client for an external `ghostfolio-mcp-server`
- Env vars: `MCP_SERVER_URL`, `MCP_API_KEY`
- Authentication via `x-mcp-api-key` header
- 30s timeout per RPC call
- Two methods used today:
  - `getDashboardConfig({ userId })` — fetch dashboard layout from MCP
  - `getDiagnostics()` — health probe

**What MCP is NOT used for:**

- Tool invocation (tools are defined inline in ai.service.ts via Vercel AI SDK)
- Tool discovery
- Tool schema exchange
- Streaming/SSE tool results

### Recommended MCP Integration Points

#### Option A: MCP at Tool Registry Layer (Recommended)

```
generateText() → tool() callback → executeWithGuardrails()
                                        |
                                        v
                               IS tool an MCP tool?
                              /                    \
                           YES                      NO
                            |                        |
                     McpClientService.rpc()     Local executeFn()
                            |                        |
                            v                        v
                     MCP Server tool            buildXxxResult()
```

**Where to integrate**: Inside `executeWithGuardrails()` at `ai.service.ts` line 562. Replace the local `executeFn()` call with a dispatch that checks if the tool should be routed to an MCP server.

**What's needed**:

1. A tool registry that maps `toolName` → `{ type: 'local' | 'mcp', mcpMethod?: string }`
2. Extend `McpClientService.rpc()` to handle tool invocations
3. Normalize MCP tool results to match the `{ status, data, verification }` shape
4. Keep existing guardrails wrapping the MCP call

#### Option B: MCP at Tool Discovery Layer

Register all 10 tools as MCP server tools, expose them via stdio/SSE transport, and have the AI system call them via MCP protocol. This requires:

1. Building an MCP server that wraps existing tool functions
2. Updating `generateText()` to discover tools via MCP handshake
3. More complex but better for multi-agent scenarios

### Risks

| Risk                                        | Mitigation                                                            |
| ------------------------------------------- | --------------------------------------------------------------------- |
| Latency increase (HTTP round-trip per tool) | Keep portfolio tools local; only route market tools to MCP            |
| Schema drift between MCP server and client  | Generate schemas from shared Zod definitions                          |
| MCP server downtime                         | Fallback to local tool execution                                      |
| Loss of guardrail enforcement               | Keep `executeWithGuardrails()` as the outer wrapper regardless of MCP |

---

## 6. Quick Test

### How to Run a Single Prompt Locally

```bash
# 1. Ensure environment variables are set:
export PROPERTY_API_KEY_OPENROUTER="your-key"
export PROPERTY_OPENROUTER_MODEL="anthropic/claude-sonnet-4-20250514"

# 2. Start the API server:
npx nx serve api

# 3. Send a chat request (requires valid JWT):
curl -X POST http://localhost:3333/api/v1/ai/chat \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What is my portfolio performance this year?",
    "history": [],
    "conversationId": null
  }'
```

### How to Confirm Tool Calls Happened

1. **Response metadata**: The response includes `traceId` — use it to query metrics:

   ```bash
   curl http://localhost:3333/api/v1/ai/metrics/traces/TRACE_ID \
     -H "Authorization: Bearer YOUR_JWT"
   ```

2. **SSE reasoning stream**: Connect to the reasoning SSE endpoint before sending the chat:

   ```bash
   curl -N http://localhost:3333/api/v1/ai/reasoning/stream/TRACE_ID \
     -H "Authorization: Bearer YOUR_JWT"
   ```

   Events include `trace.step_added` with `type: 'tool_call'` showing tool name, args, status, and duration.

3. **Braintrust dashboard**: If `BRAINTRUST_API_KEY` is configured, traces appear in the Braintrust project with full span hierarchy.

4. **Database**: Query `aiTraceMetric` table for `usedTools` column (JSON array of tool names used).

### Example: Prompt That Should Trigger a Specific Tool

| Prompt                         | Expected Tool         | Why                                                                 |
| ------------------------------ | --------------------- | ------------------------------------------------------------------- |
| "What's in my portfolio?"      | `getPortfolioSummary` | Overview question → system prompt says "Use for overview questions" |
| "How did I perform this year?" | `getPerformance`      | Performance question with "ytd" date range                          |
| "What's the price of AAPL?"    | `getQuote`            | Current price request → "Use for current prices"                    |
| "Show me my recent trades"     | `listActivities`      | Transaction history → "Use for transaction history"                 |
| "How diversified am I?"        | `getAllocations`      | Diversification → "Use for diversification questions"               |
| "What if tech drops 20%?"      | `scenarioImpact`      | What-if → "Use for what if questions"                               |
| "Rebalance to 60/40"           | `computeRebalance`    | Rebalancing → "Use when user asks about rebalancing"                |
| "Show NVDA P/E ratio"          | `getFundamentals`     | Valuation ratios → "Use for fundamental analysis"                   |
| "Any news on TSLA?"            | `getNews`             | News → "Use for market context"                                     |
| "Show MSFT price history"      | `getHistory`          | Historical data → "Use for trend analysis"                          |

---

## 7. File Reference Index

### Core AI Agent System

| File                                             | Lines | Purpose                                                                       |
| ------------------------------------------------ | ----- | ----------------------------------------------------------------------------- |
| `apps/api/src/app/endpoints/ai/ai.controller.ts` | ~80   | HTTP endpoints (chat, dashboard, diagnostics, prompts)                        |
| `apps/api/src/app/endpoints/ai/ai.module.ts`     | ~60   | NestJS module wiring                                                          |
| `apps/api/src/app/endpoints/ai/ai.service.ts`    | 1452  | **Main orchestrator**: ReAct prompt, guardrails, tool execution, groundedness |

### Tool Implementations

| File                                                                | Lines | Tool                  |
| ------------------------------------------------------------------- | ----- | --------------------- |
| `apps/api/src/app/endpoints/ai/tools/get-portfolio-summary.tool.ts` | ~140  | `getPortfolioSummary` |
| `apps/api/src/app/endpoints/ai/tools/list-activities.tool.ts`       | ~90   | `listActivities`      |
| `apps/api/src/app/endpoints/ai/tools/get-allocations.tool.ts`       | ~150  | `getAllocations`      |
| `apps/api/src/app/endpoints/ai/tools/get-performance.tool.ts`       | ~90   | `getPerformance`      |
| `apps/api/src/app/endpoints/ai/tools/get-quote.tool.ts`             | ~90   | `getQuote`            |
| `apps/api/src/app/endpoints/ai/tools/get-history.tool.ts`           | ~150  | `getHistory`          |
| `apps/api/src/app/endpoints/ai/tools/get-fundamentals.tool.ts`      | ~100  | `getFundamentals`     |
| `apps/api/src/app/endpoints/ai/tools/get-news.tool.ts`              | ~90   | `getNews`             |
| `apps/api/src/app/endpoints/ai/tools/compute-rebalance.tool.ts`     | ~250  | `computeRebalance`    |
| `apps/api/src/app/endpoints/ai/tools/scenario-impact.tool.ts`       | ~200  | `scenarioImpact`      |

### Schemas (Zod)

| File                                            | Schemas                              |
| ----------------------------------------------- | ------------------------------------ |
| `tools/schemas/portfolio-summary.schema.ts`     | Input + Output                       |
| `tools/schemas/list-activities.schema.ts`       | Input + Output                       |
| `tools/schemas/allocations.schema.ts`           | Input + Output                       |
| `tools/schemas/performance.schema.ts`           | Input + Output                       |
| `tools/schemas/get-quote.schema.ts`             | Input + Output                       |
| `tools/schemas/get-history.schema.ts`           | Input + Output                       |
| `tools/schemas/get-fundamentals.schema.ts`      | Input + Output                       |
| `tools/schemas/get-news.schema.ts`              | Input + Output                       |
| `tools/schemas/compute-rebalance.schema.ts`     | Input + Output                       |
| `tools/schemas/scenario-impact.schema.ts`       | Input + Output                       |
| `import-auditor/schemas/verification.schema.ts` | `VerificationResultSchema` + helpers |
| `tools/schemas/quote-metadata.schema.ts`        | `QuoteMetadataSchema`                |

### Guardrails

| File                                                                 | Purpose                                      |
| -------------------------------------------------------------------- | -------------------------------------------- |
| `apps/api/src/app/import-auditor/guardrails/circuit-breaker.ts`      | Same tool+args 3x → abort                    |
| `apps/api/src/app/import-auditor/guardrails/cost-limiter.ts`         | $1.00 USD per query cap                      |
| `apps/api/src/app/import-auditor/guardrails/tool-failure-tracker.ts` | Consecutive failure backoff                  |
| `apps/api/src/app/import-auditor/verification/enforce.ts`            | Verification gate (block/allow/human_review) |

### Telemetry & Observability

| File                                                                      | Purpose                        |
| ------------------------------------------------------------------------- | ------------------------------ |
| `apps/api/src/app/endpoints/ai/telemetry/braintrust-telemetry.service.ts` | Braintrust SDK integration     |
| `apps/api/src/app/endpoints/ai/telemetry/telemetry.interfaces.ts`         | Trace/span type definitions    |
| `apps/api/src/app/endpoints/ai/telemetry/eval-scorers.ts`                 | 8 evaluation scoring functions |
| `apps/api/src/app/endpoints/ai/telemetry/cost-projections.ts`             | Cost estimation models         |
| `apps/api/src/app/endpoints/ai/metrics/ai-metrics.service.ts`             | PostgreSQL persistence         |

### Reasoning (SSE)

| File                                                                 | Purpose                            |
| -------------------------------------------------------------------- | ---------------------------------- |
| `apps/api/src/app/endpoints/ai/reasoning/reasoning-trace.service.ts` | SSE stream management              |
| `apps/api/src/app/endpoints/ai/reasoning/trace-context.ts`           | Mutable trace builder              |
| `apps/api/src/app/endpoints/ai/reasoning/reasoning.controller.ts`    | SSE HTTP endpoint                  |
| `apps/api/src/app/endpoints/ai/reasoning/redaction.ts`               | PII redaction for persisted traces |

### MCP

| File                                                      | Purpose              |
| --------------------------------------------------------- | -------------------- |
| `apps/api/src/app/endpoints/ai/mcp/mcp-client.service.ts` | HTTP JSON-RPC client |

### Key Line Numbers in ai.service.ts

| Lines     | What                                                          |
| --------- | ------------------------------------------------------------- |
| 81-96     | Production guardrail constants                                |
| 100-111   | `OUTPUT_SCHEMA_REGISTRY` (tool → Zod schema map)              |
| 144-232   | `buildReActSystemPrompt()` (full system prompt)               |
| 520-681   | `executeWithGuardrails()` (tool execution wrapper)            |
| 777-1007  | `generateText()` call with all 10 tools                       |
| 1171-1249 | `checkGroundedness()` (post-response hallucination detection) |
