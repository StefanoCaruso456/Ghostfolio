# Ghostfolio AI — ReAct Agent Architecture

> Internal reference for the AI chat sidebar's agent loop, tool registry, and guardrails.
>
> **Source:** `apps/api/src/app/endpoints/ai/ai.service.ts`

---

## 1. Request Flow

```
User message (Angular frontend)
       │
       ▼
  POST /api/ai/chat          ← JWT-guarded (ai.controller.ts)
       │
       ▼
┌─ ai.service.ts ──────────────────────────────────────────────┐
│                                                               │
│  1. Build system prompt (role + ReAct rules + anti-halluc.)   │
│  2. Attach conversation history + new user message            │
│  3. Initialize guardrails (circuit breaker, cost, failures)   │
│  4. Start Braintrust telemetry trace                          │
│                                                               │
│  ┌─ ReAct Loop (Vercel AI SDK generateText) ──────────────┐  │
│  │                                                         │  │
│  │  LLM reads system prompt + all 10 tool descriptions     │  │
│  │       │                                                 │  │
│  │       ▼                                                 │  │
│  │  LLM returns: "call tool X with {params}"               │  │
│  │       │                                                 │  │
│  │       ▼                                                 │  │
│  │  executeWithGuardrails(toolName, args, executeFn)        │  │
│  │    ├─ Circuit breaker check                             │  │
│  │    ├─ Cost limiter check                                │  │
│  │    ├─ Failure tracker check                             │  │
│  │    ├─ Execute tool function                             │  │
│  │    ├─ Zod schema validation (input + output)            │  │
│  │    └─ Verification gate (confidence + domain rules)     │  │
│  │       │                                                 │  │
│  │       ▼                                                 │  │
│  │  Tool result → sent back to LLM                         │  │
│  │  LLM decides: need more data → loop, or respond → exit  │  │
│  │       │                                                 │  │
│  │  (repeats up to maxSteps: 10)                           │  │
│  └─────────────────────────────────────────────────────────┘  │
│       │                                                       │
│       ▼                                                       │
│  Post-response groundedness check                             │
│  Braintrust telemetry log (tokens, cost, latency, tools)      │
│       │                                                       │
│       ▼                                                       │
│  Final answer → frontend                                      │
└───────────────────────────────────────────────────────────────┘
```

---

## 2. How Tool Selection Works

There is **no routing logic or if/else**. The LLM receives all 10 tool definitions (name + description + parameter schema) in the system prompt. It reads the user's message, reasons about what data it needs, and outputs a structured JSON tool call. The Vercel AI SDK parses that JSON and invokes the matching `execute` function on the backend.

Example from source:

```typescript
getQuote: tool({
  description:
    'Get real-time quotes for 1–25 symbols: price, daily change, currency. '
    + 'Use for current price lookups and daily movers.',
  parameters: GetQuoteInputSchema,
  execute: async (args) => executeWithGuardrails('getQuote', args, () => ...)
})
```

The `description` string is the selector. Clear, distinct descriptions prevent the LLM from picking the wrong tool.

---

## 3. Complete Tool Registry (10 tools)

### Portfolio Tools

| Tool                  | File                            | Description                                                         | When the LLM selects it                           |
| --------------------- | ------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| `getPortfolioSummary` | `get-portfolio-summary.tool.ts` | Holdings count, top holdings by allocation, accounts, base currency | "Show my portfolio", overview questions           |
| `listActivities`      | `list-activities.tool.ts`       | Trades, dividends, fees with date range and type filtering          | "What did I buy last month?", transaction history |
| `getAllocations`      | `get-allocations.tool.ts`       | Allocation breakdown by asset class, sub-class, currency, sector    | "Am I diversified?", allocation questions         |
| `getPerformance`      | `get-performance.tool.ts`       | Net performance, returns %, total investment, net worth             | "How are my returns?", gains/losses               |

### Market Tools

| Tool              | File                       | Description                                                           | When the LLM selects it                        |
| ----------------- | -------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| `getQuote`        | `get-quote.tool.ts`        | Real-time quotes for 1–25 symbols (price, daily change, currency)     | "What's Bitcoin worth?", current prices        |
| `getHistory`      | `get-history.tool.ts`      | Historical price data with optional returns, volatility, max drawdown | "How has ETH done this year?", trend analysis  |
| `getFundamentals` | `get-fundamentals.tool.ts` | P/E, EPS, market cap, dividend yield, sector, industry                | "What's Apple's P/E ratio?", valuation         |
| `getNews`         | `get-news.tool.ts`         | Recent news items (raw titles + links, no summarization)              | "What's happening with Tesla?", market context |

### Decision-Support Tools

| Tool               | File                        | Description                                                                  | When the LLM selects it                     |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| `computeRebalance` | `compute-rebalance.tool.ts` | Current vs target allocation with deltas and suggested moves                 | "Should I rebalance?", target allocation    |
| `scenarioImpact`   | `scenario-impact.tool.ts`   | Portfolio impact of hypothetical shocks (deterministic math, no predictions) | "What if tech drops 20%?", what-if analysis |

> **All tool files:** `apps/api/src/app/endpoints/ai/tools/`

---

## 4. Guardrails

Every tool call passes through `executeWithGuardrails()` before execution. Four independent guardrails run in sequence:

| Guardrail             | File                        | Trigger                                 | Action                                     |
| --------------------- | --------------------------- | --------------------------------------- | ------------------------------------------ |
| **Circuit Breaker**   | `circuit-breaker.ts`        | Same tool + args called 3 times         | Abort loop, return error                   |
| **Cost Limiter**      | `cost-limiter.ts`           | Accumulated query cost > $1.00          | Abort loop, return error                   |
| **Failure Tracker**   | (inline in `ai.service.ts`) | Repeated tool execution errors          | Backoff, then abort                        |
| **Verification Gate** | `verification.schema.ts`    | Low confidence or domain rule violation | Block response or escalate to human review |

```typescript
// Guardrail constants (ai.service.ts)
const MAX_ITERATIONS = 10;
const TIMEOUT_MS = 45_000; // 45 seconds
const COST_LIMIT_USD = 1.0; // $1 per query
const CIRCUIT_BREAKER_MAX_REPETITIONS = 3;
```

> **Guardrail files:** `apps/api/src/app/import-auditor/guardrails/`

---

## 5. Verification Layer

Every tool result includes a `verification` object:

```typescript
interface VerificationResult {
  passed: boolean;
  confidence: number; // 0–1 scale
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

  // Optional fields
  hallucinationFlags?: string[];
  allClaimsSupported?: boolean;
  domainRulesChecked?: string[];
  domainRulesFailed?: string[];
  requiresHumanReview?: boolean;
  escalationReason?: string;
}
```

The verification gate decides: `'continue'` | `'block'` | `'human_review'`.

---

## 6. System Prompt Structure

The system prompt (`buildReActSystemPrompt()`) contains:

1. **Role definition** — "You are Ghostfolio AI, a financial assistant..."
2. **ReAct protocol** — mandatory THINK → ACT → OBSERVE → DECIDE loop
3. **Response format rules** — language, currency formatting, markdown
4. **Anti-hallucination rules:**
   - Never invent prices, allocations, or performance figures
   - Never reference holdings not returned by tools
   - Always call tools before stating any numbers
   - Show work using tool-provided values

---

## 7. Telemetry

Every query is logged to **Braintrust** with three layers:

| Layer                    | What's logged                                              |
| ------------------------ | ---------------------------------------------------------- |
| **Trace-level**          | Request ID, user ID, model, latency, total tokens, cost    |
| **Tool spans**           | Per-tool timing, input/output, status, verification result |
| **Verification summary** | Hallucination flags, confidence scores, domain violations  |

> **Telemetry files:** `apps/api/src/app/endpoints/ai/telemetry/`

---

## 8. Multi-Tool Example

User asks: _"What's my best performing holding and what's its current price?"_

```
Step 1  LLM THINKS: I need portfolio performance data
        LLM ACTS:   call getPerformance({range: 'max'})
        OBSERVE:    {topPerformer: {symbol: 'NVDA', return: 342%}, ...}

Step 2  LLM THINKS: Now I need NVDA's current price
        LLM ACTS:   call getQuote({symbols: ['NVDA']})
        OBSERVE:    {NVDA: {price: 891.20, change: +2.3%, currency: 'USD'}}

Step 3  LLM RESPONDS: "Your best performer is NVIDIA (NVDA) at +342% return.
                       Current price: $891.20 (+2.3% today)."
```

Two tools called, two LLM round-trips, one final answer.

---

## 9. Key Source Files

| File                                                             | Purpose                                            |
| ---------------------------------------------------------------- | -------------------------------------------------- |
| `apps/api/src/app/endpoints/ai/ai.service.ts`                    | ReAct loop, system prompt, guardrail orchestration |
| `apps/api/src/app/endpoints/ai/ai.controller.ts`                 | REST endpoint, JWT guard                           |
| `apps/api/src/app/endpoints/ai/tools/*.tool.ts`                  | 10 tool implementations                            |
| `apps/api/src/app/endpoints/ai/tools/schemas/*.ts`               | Zod input/output schemas                           |
| `apps/api/src/app/import-auditor/guardrails/`                    | Circuit breaker, cost limiter                      |
| `apps/api/src/app/import-auditor/schemas/verification.schema.ts` | Verification result types                          |
| `apps/api/src/app/endpoints/ai/telemetry/`                       | Braintrust logging                                 |
| `apps/api/src/app/endpoints/ai/evals/`                           | Golden set tests, replay harness                   |
| `apps/client/src/app/components/ai-chat-sidebar/`                | Frontend chat UI                                   |
