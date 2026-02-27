# AI Chat — Tool Registry

## Overview

The AI chat system uses **10 production tools** registered with the Vercel AI SDK's `tool()` function. All tools are fully implemented (no stubs). Each tool has:

- **Input schema** (Zod) -- validates arguments from the LLM
- **Output schema** (Zod) -- validates the ToolResult envelope at runtime
- **Execute function** -- real implementation with error handling and verification

## Tool Table

### Portfolio Tools (4)

| Tool Name             | Description                                                      | Data Source      |
| --------------------- | ---------------------------------------------------------------- | ---------------- |
| `getPortfolioSummary` | Holdings count, top 5 positions, accounts, base currency         | PortfolioService |
| `listActivities`      | Orders/transactions with date, symbol, type filters              | OrderService     |
| `getAllocations`      | Allocation breakdown by asset class, sub-class, currency, sector | PortfolioService |
| `getPerformance`      | Net worth, total investment, returns %, first order date         | PortfolioService |

### Market Tools (4)

| Tool Name         | Description                                                             | Data Source    |
| ----------------- | ----------------------------------------------------------------------- | -------------- |
| `getQuote`        | Real-time price quotes (1-25 symbols), daily change, source attribution | yahoo-finance2 |
| `getHistory`      | Historical OHLCV data, total returns %, max drawdown, volatility        | yahoo-finance2 |
| `getFundamentals` | P/E, forward P/E, EPS, market cap, dividend yield, sector, industry     | yahoo-finance2 |
| `getNews`         | Financial news articles (1-10 items, 1-30 day recency)                  | yahoo-finance2 |

### Decision-Support Tools (2)

| Tool Name          | Description                                                                                                   | Data Source      |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------- |
| `computeRebalance` | Current vs target allocation deltas, suggested moves with rationale, constraint violations. NOT trade advice. | PortfolioService |
| `scenarioImpact`   | "What if" portfolio impact simulation with shock scenarios (1-20 shocks)                                      | PortfolioService |

## Tool Input Schemas

### getPortfolioSummary

```typescript
{
  userCurrency: string;
}
```

### listActivities

```typescript
{
  startDate?: string,       // ISO date
  endDate?: string,         // ISO date
  types?: ('BUY' | 'SELL' | 'DIVIDEND' | 'FEE' | 'INTEREST' | 'LIABILITY')[],
  symbol?: string,
  limit?: number
}
```

### getAllocations

```typescript
{
  userCurrency: string;
}
```

### getPerformance

```typescript
{
  dateRange: '1d' |
    '1w' |
    '1m' |
    '3m' |
    '6m' |
    'ytd' |
    '1y' |
    '3y' |
    '5y' |
    'max';
}
```

### getQuote

```typescript
{
  symbols: string[],        // 1-25 symbols
  assetType?: string,
  quoteCurrency?: string
}
```

### getHistory

```typescript
{
  symbol: string,
  range: '5d' | '1mo' | '3mo' | '6mo' | '1y' | '5y',
  interval: '1d' | '1wk',
  includeReturns?: boolean
}
```

### getFundamentals

```typescript
{
  symbol: string;
}
```

### getNews

```typescript
{
  symbol: string,
  limit?: number,           // 1-10, default 5
  recencyDays?: number      // 1-30, default 7
}
```

### computeRebalance

```typescript
{
  baseCurrency?: string,
  targetAllocations: {
    assetClass?: Record<string, number>,
    sector?: Record<string, number>,
    symbols?: Record<string, number>
  },
  constraints?: {
    maxSingleNamePct?: number,
    minCashPct?: number,
    ignoreSymbols?: string[]
  }
}
```

### scenarioImpact

```typescript
{
  shocks: { symbolOrBucket: string, shockPct: number }[],  // 1-20 shocks
  horizon: '1d' | '1wk' | '1mo',
  assumeCashStable?: boolean
}
```

## ToolResult Envelope

Every tool returns a consistent envelope shape:

```typescript
{
  status: 'success' | 'error';
  data?: <tool-specific data>;
  message: string;
  verification: {
    passed: boolean;
    confidence: number;        // 0.0 - 1.0
    errors?: string[];
    warnings?: string[];
    sources: string[];
    domainRulesChecked?: string[];
    domainRulesFailed?: string[];
    verificationType: 'confidence_scoring';
  };
  meta?: {
    schemaVersion: string;     // e.g., "1.0.0"
    source: string;            // e.g., "yahoo-finance2"
    cacheHit?: boolean;
    providerLatencyMs?: number;
  };
}
```

## executeWithGuardrails() Wrapper

Every tool call is wrapped in `executeWithGuardrails()` which enforces:

1. **Circuit Breaker** -- Detects repeated tool+args combinations (3x -> abort)
2. **Cost Limiter** -- Accumulates estimated cost; blocks at $1/query
3. **Tool Failure Backoff** -- After 3 failures, aborts automatically
4. **Runtime Output Schema Validation** -- Zod `safeParse`; generates error if invalid
5. **Verification Gate** -- Checks confidence score (min 0.5)
6. **Tool Span Recording** -- Logs to Braintrust telemetry with status, output, error
7. **Duration Tracking** -- Measures execution time in milliseconds

## OUTPUT_SCHEMA_REGISTRY

Located in `tools/index.ts`. Maps every tool name to its Zod output schema for runtime validation:

```typescript
export const OUTPUT_SCHEMA_REGISTRY: Record<string, z.ZodType> = {
  getPortfolioSummary: GetPortfolioSummaryOutputSchema,
  listActivities: ListActivitiesOutputSchema,
  getAllocations: GetAllocationsOutputSchema,
  getPerformance: GetPerformanceOutputSchema,
  getQuote: GetQuoteOutputSchema,
  getHistory: GetHistoryOutputSchema,
  getFundamentals: GetFundamentalsOutputSchema,
  getNews: GetNewsOutputSchema,
  computeRebalance: ComputeRebalanceOutputSchema,
  scenarioImpact: ScenarioImpactOutputSchema
};
```

Proof tests in `tools/__tests__/tool-registry-match.spec.ts` ensure registry keys match the tools object keys exactly.

## Naming Consistency

All three registries use identical keys:

1. `TOOL_NAME` constant in each schema file
2. Keys in `OUTPUT_SCHEMA_REGISTRY` (`tools/index.ts`)
3. Keys in the `tools` object passed to `generateText()` (`ai.service.ts`)

## Adding a New Tool

1. Create `tools/schemas/<tool-name>.schema.ts` with input + output Zod schemas and `TOOL_NAME` constant
2. Export schemas from `tools/schemas/index.ts`
3. Add output schema to `OUTPUT_SCHEMA_REGISTRY` in `tools/index.ts`
4. Create `tools/<tool-name>.tool.ts` with the execute function
5. Export from `tools/index.ts`
6. Register in `AiService.chat()` tool object
7. Add routing rule to `buildReActSystemPrompt()`
8. Add golden set routing test in `evals/golden-set.spec.ts`
9. Add labeled scenario in `evals/labeled-scenarios.spec.ts`
