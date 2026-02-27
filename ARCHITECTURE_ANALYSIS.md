# Ghostfolio — Full Architecture Analysis

> **Date**: 2026-02-26
> **Branch**: `claude/setup-bounty-branch-9CTWW`
> **Purpose**: Deep-dive analysis for $500 AgentForge Bounty submission

---

## Table of Contents

1. [Tech Stack Overview](#1-tech-stack-overview)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Database Schema (22 Prisma Models)](#3-database-schema-22-prisma-models)
4. [API Endpoints (100+ Routes)](#4-api-endpoints-100-routes)
5. [AI Chat — ReAct Agent Architecture](#5-ai-chat--react-agent-architecture)
6. [CSV Import — AI-Powered Auditor (ReAct Loop #2)](#6-csv-import--ai-powered-auditor-react-loop-2)
7. [Braintrust Telemetry & Observability](#7-braintrust-telemetry--observability)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Authentication Flows](#9-authentication-flows)
10. [Key Architectural Patterns](#10-key-architectural-patterns)
11. [AgentForge Bounty — New Data Source Opportunities](#11-agentforge-bounty--new-data-source-opportunities)

---

## 1. Tech Stack Overview

| Layer           | Technology                                          | Version            |
| --------------- | --------------------------------------------------- | ------------------ |
| **Frontend**    | Angular (standalone components)                     | 21.1.1             |
| **UI Library**  | Angular Material M2 + Bootstrap 4.6 grid            | 21.1.1             |
| **Backend**     | NestJS                                              | 11.1.14            |
| **ORM**         | Prisma                                              | 6.19.0             |
| **Database**    | PostgreSQL                                          | via Docker/Railway |
| **Cache**       | Redis + Bull queue                                  | 4.4.0              |
| **Monorepo**    | Nx workspace                                        | 22.4.5             |
| **Node**        | Node.js                                             | 22                 |
| **AI SDK**      | Vercel AI SDK + OpenRouter                          | 4.3.16             |
| **Telemetry**   | Braintrust SDK                                      | 3.1.0              |
| **Auth**        | Passport.js (Google, OIDC, JWT, API Keys, WebAuthn) | Multi              |
| **Charts**      | Chart.js (treemap, annotation, datalabels)          | 4.5.1              |
| **Payments**    | Stripe                                              | 20.3.0             |
| **Market Data** | yahoo-finance2                                      | 3.13.0             |
| **Deploy**      | Railway + PostgreSQL + Docker (multi-stage)         | —                  |
| **License**     | AGPL-3.0                                            | v2.243.0           |

---

## 2. Monorepo Structure

```
/home/user/Ghostfolio/
├── apps/
│   ├── api/              → NestJS backend (PORT 3333)
│   │   └── src/app/
│   │       ├── endpoints/ → All controllers (ai/, portfolio/, admin/, etc.)
│   │       ├── import-auditor/ → CSV ReAct loop
│   │       ├── portfolio/ → Core portfolio engine
│   │       ├── order/     → Activity/transaction service
│   │       ├── account/   → Account management
│   │       └── ...
│   └── client/           → Angular frontend (PORT 4200)
│       └── src/app/
│           ├── pages/     → Route-level components
│           ├── components/ → Shared app components
│           └── services/  → Angular services
├── libs/
│   ├── common/           → Shared interfaces, DTOs, helpers, permissions
│   │   └── src/lib/
│   │       ├── interfaces/ → TypeScript interfaces for all entities
│   │       ├── types/      → Type aliases and enums
│   │       ├── config.ts   → Property keys, constants
│   │       └── permissions.ts → RBAC permission definitions
│   └── ui/               → 40+ Angular UI components
│       └── src/lib/       → Charts, tables, dialogs, selectors
├── prisma/
│   ├── schema.prisma     → 22 models, 9 enums
│   ├── migrations/       → 110+ migrations
│   └── seed.ts           → Database seed script
├── docker/               → Compose files (prod, dev, build)
├── .github/              → CI/CD workflows
└── artifacts-documentation/ → ReAct architecture docs, API contracts
```

**Path Aliases** (tsconfig.base.json):

- `@ghostfolio/api/*` → `apps/api/src/*`
- `@ghostfolio/client/*` → `apps/client/src/app/*`
- `@ghostfolio/common/*` → `libs/common/src/lib/*`
- `@ghostfolio/ui/*` → `libs/ui/src/lib/*`

---

## 3. Database Schema (22 Prisma Models)

### Entity Relationship Diagram

```
User (root entity)
├── Account[]               → AccountBalance[]
│                           → Order[] (activities)
├── Order[] (direct)        → SymbolProfile → SymbolProfileOverrides
│                           → Tag[] (many-to-many)
├── Tag[]                   ← Order[] (many-to-many)
├── Watchlist               ← SymbolProfile[] (many-to-many via "UserWatchlist")
├── ApiKey[]
├── Subscription[]          → Stripe integration
├── AuthDevice[]            → WebAuthn/FIDO2
├── Settings (1:1)          → JSON preferences
├── Analytics (1:1)         → Request counts, country
├── Access[]                → "accessGive" / "accessGet" (shared portfolios)
├── AiConversation[]        → AiConversationMessage[]
├── AiFeedback[]            → UP/DOWN ratings
├── AiVerificationLabel[]   → Manual eval labels
└── SymbolProfile[]         → User-created manual assets

MarketData (standalone)     → Daily OHLC price storage per symbol+dataSource
AiTraceMetric (standalone)  → Per-query telemetry metrics
AssetProfileResolution      → Symbol mapping cache (cross-provider)
Platform                    → Account[] (broker/bank metadata)
Property                    → Key-value system config (admin settings)
```

### Core Models Detail

#### User

```prisma
model User {
  id                String              @id @default(uuid())
  provider          Provider            @default(ANONYMOUS)  // GOOGLE, OIDC, etc.
  role              Role                @default(USER)       // ADMIN, DEMO, INACTIVE
  accessToken       String?             // Anonymous login token
  thirdPartyId      String?             // OAuth provider ID
  accounts          Account[]
  activities        Order[]
  aiConversations   AiConversation[]
  aiFeedback        AiFeedback[]
  analytics         Analytics?
  apiKeys           ApiKey[]
  subscriptions     Subscription[]
  tags              Tag[]
  watchlist         SymbolProfile[]     @relation("UserWatchlist")
}
```

#### Order (Activities/Transactions)

```prisma
model Order {
  id              String        @id @default(uuid())
  date            DateTime
  type            Type          // BUY, SELL, DIVIDEND, FEE, INTEREST, LIABILITY
  quantity        Float
  unitPrice       Float
  fee             Float
  currency        String?
  symbolProfileId String        → SymbolProfile
  accountId       String?       → Account
  userId          String        → User
  tags            Tag[]         // many-to-many
  isDraft         Boolean       @default(false)
  comment         String?
}
```

#### SymbolProfile (Asset Metadata)

```prisma
model SymbolProfile {
  id              String         @id @default(uuid())
  symbol          String
  dataSource      DataSource     // YAHOO, COINGECKO, MANUAL, etc.
  assetClass      AssetClass?    // EQUITY, FIXED_INCOME, COMMODITY, etc.
  assetSubClass   AssetSubClass? // STOCK, ETF, CRYPTOCURRENCY, BOND, etc.
  currency        String
  name            String?
  countries       Json?
  sectors         Json?
  holdings        Json?          @default("[]")
  isin            String?
  cusip           String?
  figi            String?        // OpenFIGI identifier
  isActive        Boolean        @default(true)
  @@unique([dataSource, symbol])
}
```

#### MarketData (Price History)

```prisma
model MarketData {
  id          String          @id @default(uuid())
  dataSource  DataSource
  symbol      String
  date        DateTime
  marketPrice Float
  state       MarketDataState // CLOSE, INTRADAY
  @@unique([dataSource, date, symbol])
}
```

### Key Enums

| Enum                 | Values                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **DataSource**       | `YAHOO`, `COINGECKO`, `ALPHA_VANTAGE`, `EOD_HISTORICAL_DATA`, `FINANCIAL_MODELING_PREP`, `GHOSTFOLIO`, `GOOGLE_SHEETS`, `MANUAL`, `RAPID_API` |
| **Type** (Order)     | `BUY`, `SELL`, `DIVIDEND`, `FEE`, `INTEREST`, `LIABILITY`                                                                                     |
| **AssetClass**       | `EQUITY`, `FIXED_INCOME`, `COMMODITY`, `REAL_ESTATE`, `LIQUIDITY`, `ALTERNATIVE_INVESTMENT`                                                   |
| **AssetSubClass**    | `STOCK`, `ETF`, `MUTUALFUND`, `BOND`, `CRYPTOCURRENCY`, `PRECIOUS_METAL`, `COMMODITY`, `CASH`, `COLLECTIBLE`, `PRIVATE_EQUITY`                |
| **Provider** (Auth)  | `ANONYMOUS`, `GOOGLE`, `OIDC`, `INTERNET_IDENTITY`                                                                                            |
| **Role**             | `USER`, `ADMIN`, `DEMO`, `INACTIVE`                                                                                                           |
| **AiFeedbackRating** | `UP`, `DOWN`                                                                                                                                  |

### AI-Specific Tables

| Table                   | Purpose                | Key Fields                                                   |
| ----------------------- | ---------------------- | ------------------------------------------------------------ |
| `AiConversation`        | Persisted chat threads | userId, title, messages[]                                    |
| `AiConversationMessage` | Individual messages    | conversationId, role, content                                |
| `AiTraceMetric`         | Per-query telemetry    | traceId, latency, tokens, cost, hallucinations, verification |
| `AiFeedback`            | User UP/DOWN ratings   | userId, rating, traceId, conversationId                      |
| `AiVerificationLabel`   | Manual eval labels     | traceId, isHallucination, verificationShouldHavePassed       |

---

## 4. API Endpoints (100+ Routes)

### Route Map

| Route Prefix             | Controller              | Purpose             | Key Endpoints                                                                                                                                    |
| ------------------------ | ----------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/v1/portfolio`      | PortfolioController     | Portfolio analytics | `GET /details`, `GET /holdings/:id`, `GET /performance`, `GET /dividends`, `GET /investments`, `GET /report`                                     |
| `/api/v1/order`          | OrderController         | Activity CRUD       | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`, `DELETE /` (bulk)                                                                                  |
| `/api/v1/account`        | AccountController       | Account management  | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`, `GET /:id/balances`, `POST /transfer`                                                              |
| `/api/v1/admin`          | AdminController         | Admin operations    | `GET /market-data`, `POST /gather/max`, `POST /gather/profile-data`, `GET /users`, `PUT /settings`                                               |
| `/api/v1/ai`             | AiController            | AI chat             | `POST /chat`, `GET /conversations`, `GET /conversations/:id`, `DELETE /conversations/:id`                                                        |
| `/api/v1/ai`             | AiMetricsController     | AI metrics          | `POST /feedback`, `GET /metrics/latency`, `GET /metrics/hallucination`, `POST /metrics/verification/label`, `GET /metrics/verification/accuracy` |
| `/api/v1/import`         | ImportController        | Data import         | `POST /` (batch), `POST /dividends/:dataSource/:symbol`                                                                                          |
| `/api/v1/import-auditor` | ImportAuditorController | CSV AI auditor      | `GET /health`, `POST /chat`                                                                                                                      |
| `/api/v1/export`         | ExportController        | Data export         | `GET /` (with filters)                                                                                                                           |
| `/api/v1/auth`           | AuthController          | Authentication      | `GET /google`, `GET /google/callback`, `GET /oidc`, `POST /anonymous`, `POST /webauthn/*`                                                        |
| `/api/v1/symbol`         | SymbolController        | Symbol lookup       | `GET /lookup?query=`, `GET /:dataSource/:symbol`                                                                                                 |
| `/api/v1/market-data`    | MarketDataController    | Market data         | `GET /markets` (fear/greed)                                                                                                                      |
| `/api/v1/user`           | UserController          | User profile        | `GET /`, `PUT /setting`, `POST /access-token`, `DELETE /`                                                                                        |
| `/api/v1/access`         | AccessController        | Portfolio sharing   | `GET /`, `POST /`, `DELETE /:id`                                                                                                                 |
| `/api/v1/subscription`   | SubscriptionController  | Premium             | `POST /stripe/checkout-session`, `POST /redeem-coupon`                                                                                           |
| `/api/v1/health`         | HealthController        | Health checks       | `GET /` (DB, Redis, providers)                                                                                                                   |
| `/api/v1/tag`            | TagController           | Tag management      | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`                                                                                                     |
| `/api/v1/platform`       | PlatformController      | Platform management | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`                                                                                                     |
| `/api/v1/watchlist`      | WatchlistController     | Watchlist           | `PUT /` (update watched symbols)                                                                                                                 |
| `/api/v1/logo`           | LogoController          | Company logos       | `GET /:url` (proxied)                                                                                                                            |
| `/api/v1/info`           | InfoController          | App metadata        | `GET /` (version, features, stats)                                                                                                               |
| `/api/v1/benchmarks`     | BenchmarkController     | Benchmarks          | `GET /`                                                                                                                                          |

### Authorization Pattern

All protected routes use:

```typescript
@HasPermission(permissions.readPortfolio)
@UseGuards(AuthGuard('jwt'), HasPermissionGuard)
```

---

## 5. AI Chat — ReAct Agent Architecture

### Overview

- **Location**: `apps/api/src/app/endpoints/ai/`
- **Entry Point**: `ai.service.ts` (1,226 lines)
- **Provider**: OpenRouter API via Vercel AI SDK (`@openrouter/ai-sdk-provider`)
- **Pattern**: **THINK → ACT → OBSERVE → DECIDE** (ReAct loop)
- **SDK Method**: `generateText()` with `maxSteps: 10` and tool definitions

### System Prompt Architecture

The ReAct system prompt (`buildReActSystemPrompt()`) defines:

1. **Role**: "Ghostfolio AI, a financial assistant"
2. **ReAct Protocol**: Mandatory THINK → ACT → OBSERVE → DECIDE loop
3. **Available Tools**: Categorized into Portfolio, Market, Decision-Support
4. **Groundedness Contract**: "NEVER output numbers unless they come from tool results"
5. **Safety Guardrails**: No buy/sell recommendations, no predictions, no price targets
6. **Anti-Hallucination Rules**: No invented allocations, no referenced-but-missing holdings
7. **Output Hygiene**: Error handling rules for failed tools
8. **File Attachment Support**: CSV, PDF, and image analysis capabilities

### 10 Production Tools

#### Portfolio Tools (4)

| #   | Tool Name             | Input Schema                                        | Data Source                         | Returns                                                       |
| --- | --------------------- | --------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| 1   | `getPortfolioSummary` | `{ userCurrency }`                                  | `PortfolioService.getDetails()`     | Holdings count, top 10 by allocation, accounts, base currency |
| 2   | `listActivities`      | `{ startDate?, endDate?, types?, symbol?, limit? }` | `OrderService.getOrders()`          | Trades, dividends, fees with date/type filters (max 50)       |
| 3   | `getAllocations`      | `{ userCurrency }`                                  | `PortfolioService.getDetails()`     | Asset class, sub-class, currency, sector breakdowns           |
| 4   | `getPerformance`      | `{ dateRange }`                                     | `PortfolioService.getPerformance()` | Net performance %, total investment, net worth, ROI           |

#### Market Tools (4)

| #   | Tool Name         | Input Schema                   | Data Source                   | Returns                                                |
| --- | ----------------- | ------------------------------ | ----------------------------- | ------------------------------------------------------ |
| 5   | `getQuote`        | `{ symbols: string[] }` (1-25) | `yahoo-finance2` real-time    | Current price, daily change %, currency per symbol     |
| 6   | `getHistory`      | `{ symbol, period, interval }` | `yahoo-finance2` historical   | OHLCV data, computed returns, volatility, max drawdown |
| 7   | `getFundamentals` | `{ symbol }`                   | `yahoo-finance2` quoteSummary | P/E, EPS, market cap, dividend yield, sector, industry |
| 8   | `getNews`         | `{ symbol, days? }` (1-30)     | `yahoo-finance2` news         | Title, publisher, link, publishedAt for recent news    |

#### Decision-Support Tools (2)

| #   | Tool Name          | Input Schema                                   | Data Source               | Returns                                              |
| --- | ------------------ | ---------------------------------------------- | ------------------------- | ---------------------------------------------------- |
| 9   | `computeRebalance` | `{ targetAllocations: { name, targetPct }[] }` | `PortfolioService + calc` | Current vs target allocation deltas, suggested moves |
| 10  | `scenarioImpact`   | `{ shocks: { name, changePct }[] }`            | `PortfolioService + calc` | Hypothetical portfolio impact of price/sector shocks |

### Tool Result Envelope

Every tool returns a standardized envelope:

```typescript
{
  status: 'success' | 'error',
  data: { ... },              // Tool-specific payload
  message?: string,           // Error description
  verification: {
    passed: boolean,
    confidence: number,       // 0-1 scale
    warnings: string[],
    errors: string[],
    sources: string[]
  },
  schemaVersion: string       // Tool result schema version
}
```

### Production Guardrails

| Guardrail                | Constant                               | Limit              | Enforcement                                               |
| ------------------------ | -------------------------------------- | ------------------ | --------------------------------------------------------- |
| **MAX_ITERATIONS**       | `MAX_ITERATIONS`                       | 10                 | `maxSteps` param on `generateText()`                      |
| **TIMEOUT**              | `TIMEOUT_MS` / `TIMEOUT_MULTIMODAL_MS` | 45s / 90s (images) | `AbortController` + `Promise.race()`                      |
| **COST_LIMIT**           | `COST_LIMIT_USD`                       | $1.00/query        | `CostLimiter` class — checked before every tool call      |
| **CIRCUIT_BREAKER**      | `CIRCUIT_BREAKER_MAX_REPETITIONS`      | 3 identical calls  | `CircuitBreaker` class — compares tool+args hash          |
| **TOOL_FAILURE_TRACKER** | —                                      | 2 failures/tool    | `ToolFailureTracker` — aborts after repeated failures     |
| **VERIFICATION_GATE**    | —                                      | minConfidence: 0.5 | `enforceVerificationGate()` — block/review/pass decisions |

### `executeWithGuardrails()` Wrapper

Every tool call passes through this wrapper which:

1. Checks circuit breaker (same action 3x → abort)
2. Checks cost limit ($1.00 max)
3. Checks tool failure tracker (2 failures/tool → abort)
4. Starts a telemetry tool span
5. Executes the tool function
6. Validates output against Zod schema registry (`OUTPUT_SCHEMA_REGISTRY`)
7. Tracks failures in `ToolFailureTracker`
8. Enforces verification gate (block/review/pass)
9. Records tool span for telemetry
10. Returns result with `schemaVersion` stamp

### Post-Response Groundedness Check

After `generateText()` completes, `checkGroundedness()` performs:

- **Contradiction detection**: Response says "I don't know" but tools returned data
- **Forecast detection**: Response uses future-tense predictions ("will increase")
- **Sources-despite-failure**: Response cites sources when all tools errored
- **Numeric claim count**: Counts `$X` and `X%` patterns for audit

### Response Flow

```
User Message → buildReActSystemPrompt() → OpenRouter (via Vercel AI SDK)
  → generateText() with 10 tools, maxSteps=10
    → [LLM THINK] → [TOOL CALL] → executeWithGuardrails()
      → CircuitBreaker → CostLimiter → FailureTracker
      → Tool Execute → Zod Validation → VerificationGate
      → ToolSpan recorded
    → [LLM OBSERVE] → [LLM DECIDE] → (repeat or finish)
  → checkGroundedness() → Braintrust telemetry → Conversation persistence
  → Return { conversationId, message }
```

---

## 6. CSV Import — AI-Powered Auditor (ReAct Loop #2)

### Overview

- **Location**: `apps/api/src/app/import-auditor/`
- **Entry Point**: `import-auditor.service.ts`
- **Pattern**: Same ReAct loop via `generateText()` with `maxSteps: 10`
- **Purpose**: Intelligent CSV import with broker field mapping, validation, deduplication

### 6 Tools (Sequential Pipeline)

| Step | Tool Name              | Parameters                                                 | Purpose                                                                                                                   |
| ---- | ---------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1    | `parseCSV`             | `{ csvContent, delimiter }`                                | PapaParse → JSON rows. Supports `,` `;` `\t` `                                                                            | ` delimiters |
| 2    | `mapBrokerFields`      | `{ headers[], sampleRows[], brokerHint?, useLlmFallback }` | **Tier 1**: Deterministic header matching. **Tier 2**: LLM inference (confidence 0.6-0.8) for unknown headers             |
| 3    | `validateTransactions` | `{ activities[] }`                                         | Financial rule engine: required fields, valid types, numeric invariants (fee≥0, qty≥0), date validity, ISO currency codes |
| 4    | `detectDuplicates`     | `{ activities[], existingActivities[] }`                   | Composite key hashing (symbol+date+type+qty+price) — batch + DB comparison                                                |
| 5    | `previewImportReport`  | `{ activities[], validationResult, duplicateResult }`      | Human-readable summary with row counts, warnings, errors for confirmation                                                 |
| 6    | `commitImport`         | `{ activities[], fieldMappings }`                          | Transform → `ImportService.import()` → DB persistence → triggers data gathering                                           |

### Data Flow

```
CSV Upload → POST /api/v1/import-auditor/chat
  → parseCSV (PapaParse)
  → mapBrokerFields (deterministic + LLM fallback)
  → validateTransactions (rule engine)
  → detectDuplicates (hash-based)
  → previewImportReport (human review)
  → [User confirms] → commitImport
    → ImportService.import()
    → DataGatheringService.gatherSymbols()
    → Bull Queue → DataProviderService → MarketData table
```

### Session Management

- In-memory `Map<sessionId, SessionData>` with 1-hour TTL
- Max 100 concurrent sessions
- Automatic cleanup of expired sessions
- Each session preserves: messages, toolResults, csvContent, user

### Traditional Import Path (Non-AI)

`POST /api/v1/import` with `ImportDataDto`:

```typescript
{
  accounts?: CreateAccountDto[],
  activities: CreateOrderDto[],    // symbol, date, type, qty, price, fee, currency
  assetProfiles?: { dataSource, symbol }[],
  tags?: { name }[]
}
```

---

## 7. Braintrust Telemetry & Observability

### Overview

- **Location**: `apps/api/src/app/endpoints/ai/telemetry/`
- **SDK**: `braintrust` npm package via `initLogger()`
- **Config**: `BRAINTRUST_API_KEY` + `BRAINTRUST_PROJECT` env vars
- **Persistence**: Dual — Braintrust cloud + local PostgreSQL (`AiTraceMetric` table)

### 3-Layer Per-Query Logging

#### Layer 1 — Trace-Level Summary (`TraceLevelSummary`)

```typescript
{
  traceId, sessionId, userId,
  queryText, queryCategory,        // "general" | "portfolio" | "market" | "rebalance"
  responseText,
  totalLatencyMs, llmLatencyMs, toolLatencyTotalMs, overheadLatencyMs,
  inputTokenCount, outputTokenCount, totalTokenCount,
  estimatedCostUsd,
  usedTools, toolNames[], toolCallCount, iterationCount,
  guardrailsTriggered[],           // "circuit_breaker" | "cost_limit" | "timeout" | "tool_failure_backoff"
  success, error, aborted,
  model, timestamp,
  // Extended metadata:
  requestShape: { historyMessageCount, userMessageChars, userMessageTokensEstimate },
  toolDataVolume: { toolOutputBytesTotal, toolOutputRowsTotal, perTool[] },
  providerMeta: { marketProviderName, rateLimited, providerErrors[] },
  cachingMeta: { hits, misses },
  answerQualitySignals: { refused, disclaimerShown, numericClaimsCount, toolBackedNumericClaimsCount }
}
```

#### Layer 2 — Tool Spans (`ToolSpan[]`)

```typescript
{
  spanId, traceId,
  toolName, toolInput, toolOutput,
  latencyMs, status,               // "success" | "error" | "timeout"
  error,
  retryCount, iterationIndex,
  wasCorrectTool,                  // Post-hoc evaluation flag
  startedAt, endedAt,
  // Provider-specific:
  providerName?, assetType?, normalizedSymbol?
}
```

#### Layer 3 — Verification Summary (`VerificationSummary`)

```typescript
{
  traceId,
  passed, confidenceScore,         // 0-1 scale
  hallucinationFlags[],
  factCheckSources[],
  domainViolations[],
  warnings[], errors[],
  escalationTriggered, escalationReason
}
```

### 7 Braintrust Span Types (Nested Hierarchy)

```
Root Span ("ai-chat", type: "task")
├── LLM Generation Span (type: "llm")
├── ReAct Iteration Span × N (type: "task")
│   └── Tool Span × M (type: "tool")
├── Orphan Tool Spans (no matching iteration)
├── Verification Span (type: "eval")
└── Final Response Span (type: "task")
```

Each span carries:

- **metrics**: start/end epoch, latency_ms, token counts
- **metadata**: tool inputs/outputs, verification details
- **scores**: success (0/1), confidence, groundedness

### 8 Scoring Functions (eval-scorers.ts)

| Scorer                 | Logic                                                                              | Scale |
| ---------------------- | ---------------------------------------------------------------------------------- | ----- |
| **scoreLatency**       | <2s→1.0, <3s→0.75, <5s→0.5, <10s→0.25, ≥10s→0.0                                    | 0-1   |
| **scoreCost**          | <$0.05→1.0, <$0.10→0.75, <$0.50→0.5, <$1.00→0.25, ≥$1.00→0.0                       | 0-1   |
| **scoreSafety**        | No escalation→1.0, warnings→0.75, domain violations→0.25, escalation→0.0           | 0-1   |
| **scoreGroundedness**  | All tools pass + no hallucinations→1.0, honest failure ack→1.0, hiding failure→0.0 | 0-1   |
| **scoreToolSelection** | Proportion of `wasCorrectTool === true`                                            | 0-1   |
| **scoreToolExecution** | Proportion of successful tool calls                                                | 0-1   |
| **correctness**        | Proxy: `confidenceScore` (until human-graded)                                      | 0-1   |
| **relevance**          | Proxy: `confidenceScore` (until human-graded)                                      | 0-1   |

**Thresholds**: >80% avg = "good", >90% avg = "excellent"

### Derived Metrics (Computed)

```typescript
{
  toolOverheadRatio,         // toolLatency / totalLatency
  costPerToolCall,           // estimatedCost / toolCallCount
  latencyPerIteration,       // totalLatency / iterationCount
  toolSuccessRates: Record<string, number>,
  failedToolCount
}
```

### Tool Policy Decisions (Logged)

| Decision               | When                          |
| ---------------------- | ----------------------------- |
| `no_tool_needed`       | LLM answered without tools    |
| `tool_selected`        | All tools succeeded           |
| `tool_failed`          | All tools failed              |
| `tool_mixed`           | Some succeeded, some failed   |
| `tool_skipped_cost`    | Cost limit prevented tool use |
| `tool_skipped_timeout` | Timeout prevented tool use    |

### Groundedness Modes

| Mode                   | When                                   |
| ---------------------- | -------------------------------------- |
| `no_tools_default`     | No tools called                        |
| `computed`             | Tools called, verification computed    |
| `verification_blocked` | Verification gate blocked the response |

### Model Cost Tracking (`estimateCost()`)

| Model                       | Prompt ($/1K) | Completion ($/1K) |
| --------------------------- | ------------- | ----------------- |
| `anthropic/claude-sonnet-4` | $0.003        | $0.015            |
| `openai/gpt-4o`             | $0.0025       | $0.01             |
| `google/gemini-2.0-flash`   | $0.0001       | $0.0004           |

### Database Persistence (Independent of Braintrust)

Every AI query persists to `AiTraceMetric`:

```sql
CREATE TABLE "AiTraceMetric" (
  "traceId"                TEXT    UNIQUE,
  "userId"                 TEXT,
  "totalLatencyMs"         INT,
  "llmLatencyMs"           INT,
  "toolLatencyTotalMs"     INT,
  "toolCallCount"          INT,
  "usedTools"              BOOLEAN,
  "hallucinationFlagCount" INT,
  "verificationPassed"     BOOLEAN,
  "estimatedCostUsd"       FLOAT,
  "createdAt"              TIMESTAMP
);
```

### Metrics API Endpoints

| Method | Endpoint                                           | Returns                               |
| ------ | -------------------------------------------------- | ------------------------------------- |
| `POST` | `/api/v1/ai/feedback`                              | Submit UP/DOWN rating with comment    |
| `GET`  | `/api/v1/ai/metrics/latency?days=7`                | p50/p95 latency baselines             |
| `GET`  | `/api/v1/ai/metrics/hallucination?days=7`          | Hallucination rate                    |
| `POST` | `/api/v1/ai/metrics/verification/label`            | Manual verification label             |
| `GET`  | `/api/v1/ai/metrics/verification/accuracy?days=30` | Verification accuracy vs human labels |

### Other Observability

- **NestJS Logger**: Configurable via `LOG_LEVELS` env var
- **PerformanceLoggingInterceptor**: Logs endpoint execution time
- **Health checks**: `GET /api/v1/health` — DB, Redis, data providers, data enhancers
- **Langfuse**: Configured but not actively used (env vars present)

---

## 8. Frontend Architecture

### Angular 21 (Standalone Components)

- **Change Detection**: `OnPush` throughout
- **State Management**: `@codewithdan/observable-store` (RxJS-based) for user state + `BehaviorSubject` services
- **PWA**: Service worker enabled in production (`@angular/service-worker`)
- **i18n**: 11 locales (en, de, es, fr, it, nl, pl, pt, tr, zh, uk)

### Page/Route Structure

```
/                     → Landing / Home
/home                 → HomePageComponent
  /home/overview      → HomeOverviewComponent
  /home/holdings      → HomeHoldingsComponent
  /home/summary       → HomeSummaryComponent
  /home/markets       → HomeMarketComponent
  /home/watchlist     → WatchlistPageComponent
/portfolio
  /portfolio/analysis → AnalysisPageComponent
  /portfolio/activities → ActivitiesPageComponent
  /portfolio/allocations → AllocationsPageComponent
  /portfolio/fire     → FirePageComponent (Financial Independence)
  /portfolio/x-ray    → XRayPageComponent (Portfolio deep-dive)
/account
  /account            → AccountPageComponent (settings, membership, access)
/admin
  /admin/jobs         → AdminJobsComponent
  /admin/market-data  → AdminMarketDataComponent
  /admin/settings     → AdminSettingsComponent
  /admin/users        → AdminUsersComponent
/ai-chat              → AiChatPageComponent (fullscreen)
/about                → AboutPageComponent
/faq                  → FaqPageComponent
/pricing              → PricingPageComponent
/register             → RegisterPageComponent
/auth                 → Auth callback routes
```

### AI Chat Frontend

**Sidebar Component**: `apps/client/src/app/components/ai-chat-sidebar/` (694 lines)

- Slide-in panel from the right
- Conversation list with create/delete
- Message input with file attachment support
- Speech recognition integration
- Markdown rendering with code syntax highlighting

**Fullscreen Page**: `apps/client/src/app/pages/ai-chat/`

- Dedicated route `/ai-chat`
- Full conversation history
- Same capabilities as sidebar

**File Attachment Features**:

- CSV, PDF, images up to 10MB
- Drag-and-drop support
- CSV content sent as inline text
- PDF text extracted and sent inline
- Images sent as base64 for vision analysis

### Theme System

```scss
// Primary colors
$primary: #36cfcc; // Teal/cyan
$secondary: #3686cf; // Blue

// Font
font-family: 'Inter', 'Roboto', sans-serif;

// Dark mode: .theme-dark class on <body>
// 100+ CSS custom properties in :root
```

**Neomorphic Design** (per CLAUDE.md):

- Soft shadows with dual light/dark pairs
- Subtle depth, rounded corners
- `box-shadow` instead of Material elevation
- Compatible with light/dark theme toggle

### 40+ Shared UI Components (`libs/ui/`)

Charts (line, treemap, proportion, world-map), activity tables, holding tables, account tables, dialog components, asset/symbol selectors, currency selectors, fire calculator, portfolio proportion chart, trend indicators, logo component, benchmark comparator, premium indicator, etc.

---

## 9. Authentication Flows

| Method           | Endpoint                                       | Mechanism                             |
| ---------------- | ---------------------------------------------- | ------------------------------------- |
| **Google OAuth** | `GET /api/v1/auth/google` → callback           | Passport GoogleStrategy → JWT cookie  |
| **OIDC**         | `GET /api/v1/auth/oidc` → callback             | Passport OpenIDConnect → JWT cookie   |
| **Access Token** | `POST /api/v1/auth/anonymous`                  | Token lookup → JWT cookie             |
| **WebAuthn**     | `POST /api/v1/auth/webauthn/*`                 | FIDO2 challenge/response → JWT cookie |
| **API Key**      | Header `X-Token: Api-Key <key>`                | Hashed key lookup in `ApiKey` table   |
| **JWT**          | Header `Authorization: Bearer <jwt>` or Cookie | Standard JWT validation               |

### Guards & Decorators

```typescript
@HasPermission(permissions.readPortfolio)
@UseGuards(AuthGuard('jwt'), HasPermissionGuard)
```

- `HasPermissionGuard` checks user role against permission matrix
- Permission matrix in `libs/common/src/lib/permissions.ts`

---

## 10. Key Architectural Patterns

| Pattern                  | Where           | How                                                                                           |
| ------------------------ | --------------- | --------------------------------------------------------------------------------------------- |
| **Feature Modules**      | NestJS backend  | Each domain (portfolio, account, order, ai) has its own module with controller, service, DTOs |
| **Guard + Decorator**    | Auth            | `@HasPermission()` decorator + `HasPermissionGuard` for RBAC                                  |
| **Queue-based Async**    | Data gathering  | Bull queues for `DataGatheringService` and portfolio snapshots                                |
| **Provider Abstraction** | Market data     | `DataProviderInterface` with 9 implementations (Yahoo, CoinGecko, etc.)                       |
| **Data Enhancers**       | Post-processing | OpenFIGI, Yahoo, TrackInsight enrich `SymbolProfile` metadata                                 |
| **Interceptors**         | Cross-cutting   | Performance logging, data redaction, data source transformation                               |
| **Cron Scheduling**      | Data freshness  | 5 scheduled jobs (hourly, daily, weekly)                                                      |
| **Forward-Fill**         | MarketData gaps | Missing prices filled from last known value                                                   |
| **Multi-Currency**       | Calculations    | Exchange rate service for cross-currency portfolio math                                       |
| **Observable Store**     | Frontend state  | RxJS-based state management for user/auth context                                             |
| **OnPush + Standalone**  | Angular perf    | All components use `ChangeDetectionStrategy.OnPush`                                           |
| **Lazy Loading**         | Routes          | All page modules lazy-loaded via router                                                       |

### 9 Data Providers

1. **Yahoo Finance** (`yahoo-finance2`) — Primary, free, real-time + historical
2. **CoinGecko** — Cryptocurrency prices
3. **Alpha Vantage** — Stocks, forex, crypto (API key required)
4. **EOD Historical Data** — End-of-day prices (API key)
5. **Financial Modeling Prep** — Fundamentals + prices (API key)
6. **Rapid API** — Various financial APIs
7. **Google Sheets** — Custom scraper via Sheets
8. **Manual** — User-entered prices
9. **Ghostfolio** — Internal data service

### Scheduled Data Gathering (Cron)

| Schedule    | Job                  | Description                                                       |
| ----------- | -------------------- | ----------------------------------------------------------------- |
| Hourly      | `gather7Days`        | 3-tier priority: currency pairs → subscribed symbols → all active |
| Daily 5PM   | Tweet fear/greed     | Post market sentiment tweet                                       |
| Midnight    | Reset analytics      | Reset daily request counters                                      |
| Sunday noon | Full profile refresh | Refresh asset profiles older than 60 days                         |

---

## 11. AgentForge Bounty — New Data Source Opportunities

Given the existing architecture, here are the highest-impact data source integrations:

### Option A: SEC EDGAR Filings (13-F, 10-K, 10-Q)

- **Customer**: Retail investors tracking institutional holdings
- **Data Source**: SEC EDGAR API (free, public)
- **Agent Tool**: `getInstitutionalHoldings({ symbol })` — who's buying/selling
- **DB Model**: `EdgarFiling` table with fund name, holdings, date
- **Impact**: "What hedge funds are buying NVDA?" directly from portfolio context

### Option B: Federal Reserve FRED Economic Indicators

- **Customer**: Macro-aware portfolio managers
- **Data Source**: FRED API (free, API key)
- **Agent Tool**: `getEconomicIndicator({ series: 'CPI', range })` — inflation, rates, unemployment
- **DB Model**: `EconomicIndicator` table with series, date, value
- **Impact**: "How does inflation affect my bond allocation?" with real data

### Option C: Dividend Calendar & Ex-Date Tracking

- **Customer**: Dividend-focused investors (FIRE community)
- **Data Source**: Yahoo Finance dividend events + user's portfolio holdings
- **Agent Tool**: `getDividendCalendar({ days: 30 })` — upcoming ex-dates for held stocks
- **DB Model**: `DividendEvent` table with symbol, exDate, payDate, amount
- **Impact**: "When are my next dividend payments?" with CRUD management

### Option D: ESG/Sustainability Scores

- **Customer**: ESG-conscious investors
- **Data Source**: Yahoo Finance ESG data / Sustainalytics
- **Agent Tool**: `getESGScores({ symbols })` — environmental, social, governance ratings
- **DB Model**: `ESGScore` table with symbol, total, E, S, G scores
- **Impact**: "How sustainable is my portfolio?" with per-holding ratings

### Common Implementation Pattern

All options follow the same pattern:

1. Add Prisma model → migration
2. Create NestJS service + controller (CRUD endpoints)
3. Create data fetcher (API client + cron job)
4. Add agent tool with Zod schema + `executeWithGuardrails()`
5. Add eval test cases (50+)
6. Wire into Braintrust telemetry
7. Add frontend display component (neomorphic design)
