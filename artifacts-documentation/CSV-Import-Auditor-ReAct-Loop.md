# CSV Import Auditor — ReAct Loop & Tool Registry

> Internal reference for the CSV import pipeline's agent loop, tool registry, guardrails, and verification layer.
>
> **Source:** `apps/api/src/app/import-auditor/`

---

## 1. Overview

The Import Auditor is a ReAct-based agent that processes CSV files containing brokerage transaction data. It parses, validates, normalizes, deduplicates, and optionally commits transactions to Ghostfolio — all orchestrated by an LLM that selects tools autonomously within guardrail constraints.

**Key characteristics:**

- 6 registered tools (atomic, idempotent, verified)
- Session-based state (1-hour TTL, max 100 concurrent sessions)
- LLM-powered via OpenRouter (Vercel AI SDK)
- Full Braintrust telemetry integration
- Shared guardrails with the AI chat agent

---

## 2. Request Flow

```
User uploads CSV (Angular frontend)
       │
       ▼
  POST /api/import-auditor/chat       ← JWT-guarded
       │
       ▼
┌─ import-auditor.service.ts ──────────────────────────────┐
│                                                           │
│  1. Resolve or create session (sessionId + userId)        │
│  2. Store CSV content in session state                    │
│  3. Append user message to conversation history           │
│  4. Initialize guardrails (circuit breaker, cost limiter) │
│  5. Start Braintrust telemetry trace                      │
│                                                           │
│  ┌─ ReAct Loop (Vercel AI SDK generateText) ──────────┐  │
│  │                                                     │  │
│  │  LLM reads system prompt + 6 tool descriptions      │  │
│  │       │                                             │  │
│  │       ▼                                             │  │
│  │  LLM returns: "call tool X with {params}"           │  │
│  │       │                                             │  │
│  │       ▼                                             │  │
│  │  Tool executes with verification envelope           │  │
│  │    ├─ Circuit breaker check                         │  │
│  │    ├─ Cost limiter check                            │  │
│  │    ├─ Execute tool function                         │  │
│  │    └─ Return { status, data, verification }         │  │
│  │       │                                             │  │
│  │       ▼                                             │  │
│  │  Tool result → sent back to LLM                     │  │
│  │  LLM decides: need more data → loop, or respond     │  │
│  │       │                                             │  │
│  │  (repeats up to maxSteps: 10)                       │  │
│  └─────────────────────────────────────────────────────┘  │
│       │                                                   │
│       ▼                                                   │
│  Append assistant response to session history             │
│  Record tool calls with verification + timing             │
│  Braintrust telemetry log                                 │
│       │                                                   │
│       ▼                                                   │
│  Return ChatResponse → frontend                           │
└───────────────────────────────────────────────────────────┘
```

---

## 3. Session Management

Each import operation is tracked via a stateful session:

```typescript
interface SessionData {
  csvContent?: string;
  lastAccessedAt: number;
  messages: { role: 'user' | 'assistant'; content: string }[];
  toolResults: Record<string, unknown>;
  user?: UserWithSettings;
  userId: string;
}
```

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `SESSION_TTL_MS` | 3,600,000 (1 hour) | Auto-expire idle sessions |
| `MAX_SESSIONS` | 100 | Memory ceiling for concurrent imports |

Sessions are evicted on access when expired. Tool results persist in `toolResults` so the LLM can reference prior step outputs without re-execution.

---

## 4. System Prompt

**Source:** `buildSystemPrompt()` in `import-auditor.service.ts`

The system prompt is built dynamically per session and defines the agent's role, tool catalog, execution protocol, and safety rules.

**Core directives:**

- Role: "Ghostfolio CSV Import Auditor, a financial data validation assistant"
- Lists all 6 tools with descriptions
- Prescribes sequential execution order: parse → map → validate → duplicates → preview → commit
- Requires explicit user confirmation before calling `commitImport`
- Must offer a dry-run before real import
- Report validation errors with row numbers
- Never display raw CSV data in full — only summaries and specific issues
- Be concise but thorough

**Dynamic context:** When the session contains uploaded CSV content, the prompt appends:

```
The user has uploaded a CSV file ({length} characters).
When you need to parse it, pass the CSV content to the parseCSV tool.
```

This provides the LLM with file awareness without embedding the raw CSV in the system message.

---

## 5. Tool Registry (6 Tools)

All tools are registered with the Vercel AI SDK's `tool()` function. The LLM selects tools autonomously based on descriptions and conversation context.

### Pipeline Tools

| Tool | File | Purpose | Typical Step |
|------|------|---------|-------------|
| `parseCSV` | `parse-csv.tool.ts` | Parse raw CSV into structured rows + headers | 1st |
| `mapBrokerFields` | `map-broker-fields.tool.ts` | Map CSV headers to Ghostfolio fields | 2nd |
| `validateTransactions` | `validate-transactions.tool.ts` | Apply domain rules to mapped transactions | 3rd |
| `detectDuplicates` | `detect-duplicates.tool.ts` | Find duplicates within batch and against DB | 4th |
| `previewImportReport` | `preview-import-report.tool.ts` | Generate human-readable summary for review | 5th |
| `commitImport` | `commit-import.tool.ts` | Transform to DTOs for final import | 6th |

### Supporting Tools (used internally by pipeline tools)

| Tool | File | Purpose |
|------|------|---------|
| `normalizeToActivityDTO` | `normalize-to-activity-dto.tool.ts` | Normalize types, dates, numerics to DTO format |
| `detectBrokerFormat` | `detect-broker-format.tool.ts` | Identify broker source from headers + patterns |

---

## 6. Tool Specifications

### 6.1 parseCSV

Parses raw CSV text into structured data using PapaParse.

**Input:**

```typescript
{
  csvContent: string;
  delimiter: ',' | ';' | '\t' | '|';
}
```

**Output:**

```typescript
{
  status: 'success' | 'error';
  data: {
    rows: Record<string, unknown>[];
    headers: string[];
    rowCount: number;
    errors: Array<{ row: number; message: string }>;
  };
  verification: VerificationResult;
}
```

**Confidence:** `1.0` if no errors; otherwise `max(0, 1 - errorCount / rowCount)`.

---

### 6.2 mapBrokerFields

Maps CSV column headers to Ghostfolio's canonical fields using deterministic matching with optional LLM fallback.

**Deterministic Field Map:**

| Target Field | Recognized Headers |
|--------------|--------------------|
| `account` | account, accountid |
| `comment` | comment, note |
| `currency` | ccy, currency, currencyprimary |
| `date` | date, tradedate |
| `fee` | commission, fee, ibcommission |
| `quantity` | qty, quantity, shares, units |
| `symbol` | code, symbol, ticker |
| `type` | action, activitytype, buy/sell, type |
| `unitPrice` | price, tradeprice, unitprice, value |

**LLM Fallback:** Invoked only when deterministic matching is `'partial'` and `useLlmFallback = true`. LLM confidence is clamped to 0.6–0.8 range to reflect uncertainty.

**Transform Rules:**

| Field | Transformation |
|-------|---------------|
| `date` | Parse as date string |
| `fee`, `quantity`, `unitPrice` | Parse as number, take absolute value |
| `type` | Normalize to uppercase enum: BUY, SELL, DIVIDEND, FEE, INTEREST, LIABILITY |
| `currency` | Validate as 3-character ISO 4217 code |

---

### 6.3 validateTransactions

Applies 8 domain validation rules to each mapped transaction.

**Rules:**

1. **required-fields** — Checks presence of: currency, date, fee, quantity, symbol, type, unitPrice
2. **valid-activity-type** — Validates against allowed enum values
3. **numeric-invariants** — fee ≥ 0, quantity ≥ 0, unitPrice ≥ 0
4. **price-quantity-coherence** — Warns if BUY/SELL has price = 0 or quantity = 0
5. **date-validity** — ISO 8601 format, after 1970-01-01, not in the future
6. **currency-validity** — 3-character ISO 4217 code
7. **batch-duplicate-detection** — Detects identical transactions within the CSV

**Status Values:** `'pass'` (no errors), `'warnings'` (warnings only), `'fail'` (has errors)

---

### 6.4 detectDuplicates

Identifies duplicate transactions within the CSV batch and against existing portfolio records.

**Composite Key:**

```
[symbol | date | type | quantity | unitPrice | fee | currency]
```

**Detection Tiers:**

| Tier | Match Source | Confidence | Date Precision |
|------|-------------|------------|----------------|
| `batch` | Within CSV rows | 1.0 | Exact key match |
| `database` | Against existing activities | 0.95 | Second-level (`isSameSecond()`) |

---

### 6.5 previewImportReport

Generates a human-readable summary for user review before committing.

**Report Includes:**

- Total transaction count
- Type breakdown (BUY, SELL, DIVIDEND, etc.) with estimated values
- Date range (earliest → latest)
- Unique currencies
- Estimated total portfolio value (Σ quantity × unitPrice)
- Warning and error counts
- Natural language summary

---

### 6.6 commitImport

Transforms validated activities into `CreateOrderDto` objects for Ghostfolio's import system.

**DTO Fields:**

| Field | Required | Default |
|-------|----------|---------|
| `currency` | Yes | — |
| `date` | Yes | — |
| `symbol` | Yes | — |
| `type` | Yes | — |
| `fee` | No | 0 |
| `quantity` | No | 0 |
| `unitPrice` | No | 0 |
| `accountId` | No | — |
| `comment` | No | — |

Errors are reported per-row without halting the entire batch.

---

### 6.7 normalizeToActivityDTO

Normalizes raw broker data into Ghostfolio's DTO format with extensive type alias support.

**Type Normalization (57 aliases):**

| Input Variants | Normalized To |
|----------------|---------------|
| Market buy, Limit buy, PURCHASE | BUY |
| Market sell, SALE | SELL |
| DIV | DIVIDEND |
| COMMISSION | FEE |

**Date Format Support:**

- YYYY-MM-DD (passthrough)
- ISO 8601 with time (extract date)
- YYYYMMDD (Interactive Brokers format)
- DD-MM-YYYY, DD/MM/YYYY
- JavaScript `Date` constructor fallback

**Numeric Coercion:** Non-negative enforcement via `Math.max(0, value)`. Handles strings, numbers, null/undefined.

---

### 6.8 detectBrokerFormat

Identifies the broker source from CSV headers and file patterns.

**Supported Brokers:**

| Broker | Required Headers | File Pattern |
|--------|-----------------|--------------|
| Interactive Brokers | currencyprimary, symbol, tradedate, tradeprice, quantity | `/ibkr/i`, `/interactive.?broker/i` |
| DEGIRO | datum, produkt, isin | — |
| Trading212 | action, time, ticker, price, no. of shares | — |
| Swissquote | date, order, symbol, quantity, price | — |
| Ghostfolio | date, code, datasource, currency, price, quantity, action, fee | — |

**Confidence Calculation:**

```
confidence = min(1.0, requiredMatchRatio × 0.8 + optionalBoost + fileNameBoost)
```

**Thresholds:**

- Detection threshold: confidence ≥ 0.5
- Warning threshold: confidence < 0.7
- Hallucination flag: confidence < 0.6

Falls back to `'generic'` if no broker exceeds the detection threshold.

---

## 7. Verification Layer

Every tool returns a `VerificationResult` envelope (defined in `schemas/verification.schema.ts`):

```typescript
interface VerificationResult {
  passed: boolean;
  confidence: number;              // 0–1
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
  factCheckPassed?: boolean;
  factCheckSources?: Array<{ name: string; ref?: string }>;
  hallucinationFlags?: string[];
  allClaimsSupported?: boolean;
  domainRulesChecked?: string[];
  domainRulesFailed?: string[];
  requiresHumanReview: boolean;
  escalationReason?: string;
}
```

### Escalation Logic

```typescript
function shouldEscalateToHuman(verification, isHighStakes):
  - Domain constraint failure → true
  - High stakes + confidence < 0.7 → true
  - Hallucination flags present → true
```

### Merge Logic

When combining results from multiple tools, `mergeVerificationResults()`:

- All must pass for composite to pass
- Confidence = average across results
- Warnings/errors/sources are flattened
- Any `requiresHumanReview` → composite requires review

---

## 8. Guardrails

| Guardrail | File | Config | Trigger | Action |
|-----------|------|--------|---------|--------|
| **Circuit Breaker** | `circuit-breaker.ts` | `maxRepetitions: 3` | Same tool + identical args called 3× | Abort loop |
| **Cost Limiter** | `cost-limiter.ts` | `maxCostUsd: 1.0`, `warnThreshold: 0.8` | Accumulated cost exceeds $1.00 | Abort loop |
| **Max Iterations** | `import-auditor.service.ts` | `MAX_ITERATIONS: 10` | 10 LLM round-trips | Force exit |
| **Timeout** | `import-auditor.service.ts` | `TIMEOUT_MS: 45,000` | 45 seconds elapsed | Abort |

### Circuit Breaker Details

- Generates SHA-256 signatures from normalized tool name + arguments
- Strings trimmed and truncated to 200 characters
- Numbers rounded to 2 decimal places
- Object keys sorted alphabetically
- Arrays bucketed by length
- Resets per session

### Cost Limiter Details

- Warning at 80% of budget ($0.80)
- Tracks accumulated cost across all LLM calls in a session
- `getRemainingBudget()` returns `max(0, limit - accumulated)`

---

## 9. Typical Import Sequence

```
User: "Here's my Interactive Brokers CSV"

Step 1  LLM THINKS: I need to parse the CSV first
        LLM ACTS:   call parseCSV({ csvContent, delimiter: ',' })
        OBSERVE:    { rows: 47, headers: [...], errors: [] }

Step 2  LLM THINKS: Headers look like IB format, map them
        LLM ACTS:   call mapBrokerFields({ headers, rows })
        OBSERVE:    { matchQuality: 'full', mappings: [...] }

Step 3  LLM THINKS: Validate the mapped transactions
        LLM ACTS:   call validateTransactions({ activities })
        OBSERVE:    { status: 'warnings', warnings: 2, errors: 0 }

Step 4  LLM THINKS: Check for duplicates before importing
        LLM ACTS:   call detectDuplicates({ activities, existingActivities })
        OBSERVE:    { status: 'duplicates_found', duplicates: 3 }

Step 5  LLM THINKS: Show the user a summary before committing
        LLM ACTS:   call previewImportReport({ activities })
        OBSERVE:    { summary: "47 transactions, 3 duplicates..." }

Step 6  LLM RESPONDS: "I found 47 transactions from Interactive Brokers.
                       2 warnings (zero-price entries), 3 duplicates.
                       Ready to import 44 unique transactions. Proceed?"
```

Six tool calls, six LLM round-trips, one final answer with human-in-the-loop confirmation before commit.

---

## 10. Response Shape

```typescript
interface ChatResponse {
  sessionId: string;
  response: string;
  toolCalls: ToolCallRecord[];
  canCommit: boolean;
  stateHash?: string;
}

interface ToolCallRecord {
  tool: string;
  status: string;
  verification: VerificationResult;
  durationMs: number;
}
```

`canCommit` signals to the frontend that the pipeline has completed validation and the user may confirm the import.

---

## 11. Dependencies

| Dependency | Purpose |
|------------|---------|
| `@openrouter/ai-sdk-provider` | LLM provider (OpenRouter) |
| `ai` (Vercel AI SDK) | `generateText`, `tool()` registration |
| `papaparse` | CSV parsing |
| `date-fns` | Date comparison (`isSameSecond`) |
| `zod` | Schema validation |
| Braintrust | Telemetry and tracing |
| `OrderService` | Portfolio activity queries (duplicate detection) |
| `ImportService` | Transaction commit |
| `ConfigurationService` | Environment config |

---

## 12. Key Source Files

| File | Purpose |
|------|---------|
| `apps/api/src/app/import-auditor/import-auditor.service.ts` | ReAct loop, session management, tool orchestration |
| `apps/api/src/app/import-auditor/tools/parse-csv.tool.ts` | CSV parsing with PapaParse |
| `apps/api/src/app/import-auditor/tools/map-broker-fields.tool.ts` | Header mapping (deterministic + LLM fallback) |
| `apps/api/src/app/import-auditor/tools/validate-transactions.tool.ts` | 8-rule domain validation |
| `apps/api/src/app/import-auditor/tools/detect-duplicates.tool.ts` | Batch + database deduplication |
| `apps/api/src/app/import-auditor/tools/preview-import-report.tool.ts` | Pre-commit summary report |
| `apps/api/src/app/import-auditor/tools/commit-import.tool.ts` | DTO transformation for import |
| `apps/api/src/app/import-auditor/tools/normalize-to-activity-dto.tool.ts` | Type/date/numeric normalization |
| `apps/api/src/app/import-auditor/tools/detect-broker-format.tool.ts` | Broker identification |
| `apps/api/src/app/import-auditor/schemas/verification.schema.ts` | Verification types + escalation logic |
| `apps/api/src/app/import-auditor/guardrails/circuit-breaker.ts` | Repetition detection |
| `apps/api/src/app/import-auditor/guardrails/cost-limiter.ts` | Budget enforcement |
