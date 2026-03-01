# AI Chat — Tool Registry

## Overview

The AI chat system uses **23 production tools** registered with the Vercel AI SDK's `tool()` function. All tools are fully implemented (no stubs). Each tool has:

- **Input schema** (Zod) -- validates arguments from the LLM
- **Output schema** (Zod) -- validates the ToolResult envelope at runtime
- **Execute function** -- real implementation with error handling and verification

## Tool Table

### Portfolio Tools (7)

| Tool Name             | Description                                                      | Data Source      |
| --------------------- | ---------------------------------------------------------------- | ---------------- |
| `getPortfolioSummary` | Holdings count, top 5 positions, accounts, base currency         | PortfolioService |
| `getHoldingDetail`    | Deep detail for one holding: position, performance, dividends, fees, historical data, ATH | PortfolioService |
| `getPortfolioChart`   | Portfolio value time-series with peak/trough/change summary, configurable date range | PortfolioService |
| `getDividendSummary`  | Dividend income by symbol, by period (month/year), recent events | OrderService     |
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

### Tax Intelligence Tools (9)

| Tool Name                 | Description                                                                     | Data Source | Verification Type     |
| ------------------------- | ------------------------------------------------------------------------------- | ----------- | --------------------- |
| `listConnectedAccounts`   | List all connected brokerage (SnapTrade) and bank (Plaid) accounts              | TaxService  | confidence_scoring    |
| `syncAccount`             | Trigger a sync for a specific connected account to refresh data                 | TaxService  | confidence_scoring    |
| `getTaxHoldings`          | Cross-account holdings with cost basis, unrealized gain/loss, market prices     | TaxService  | confidence_scoring    |
| `getTaxTransactions`      | Tax-relevant transaction history with symbol/date/limit filtering               | TaxService  | confidence_scoring    |
| `getTaxLots`              | FIFO-derived tax lots with holding periods (short/long term) and open/closed status | TaxService | confidence_scoring |
| `simulateSale`            | Estimate tax impact of selling shares — FIFO lot consumption + federal brackets | TaxService  | human_in_the_loop     |
| `createAdjustment`        | Create a cost basis adjustment (override, add lot, remove lot)                  | TaxService  | confidence_scoring    |
| `updateAdjustment`        | Update an existing cost basis adjustment                                        | TaxService  | confidence_scoring    |
| `deleteAdjustment`        | Delete a cost basis adjustment                                                  | TaxService  | confidence_scoring    |

> **Note:** `simulateSale` uses `human_in_the_loop` verification with confidence capped at 0.8. Tax estimates are informational only — not tax advice.

### Web Search Tools (1)

| Tool Name    | Description                                                                                                | Data Source       | Verification Type |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ----------------- | ----------------- |
| `webSearch`  | Search the web for real-time information — news, analysis, company data, market events, general knowledge  | Tavily Search API | fact_check        |

> **Note:** `webSearch` requires `TAVILY_API_KEY` environment variable. Free tier: 1,000 searches/month. Results are pre-optimized for LLM consumption with relevance scoring. Low-relevance results (score < 0.3) are filtered out automatically.

## Tool Input Schemas

### getPortfolioSummary

```typescript
{
  userCurrency: string;
}
```

### getHoldingDetail

```typescript
{
  symbol: string,                // Ticker symbol (e.g. AAPL, VWRL.L)
  dataSource?: DataSource        // Auto-resolved from portfolio if omitted
}
```

### getPortfolioChart

```typescript
{
  dateRange: '1d' | '1w' | '1m' | '3m' | '6m' | 'ytd' | '1y' | '5y' | 'max',
  maxPoints?: number             // Max 200, default 100. Evenly sampled.
}
```

### getDividendSummary

```typescript
{
  year?: number,                 // Filter to specific year
  symbol?: string,               // Filter to specific symbol
  groupBy?: 'month' | 'year'    // Group totals by period
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

### listConnectedAccounts

```typescript
{}  // No parameters required
```

### syncAccount

```typescript
{
  connectionId: string,            // ID of the connected account
  type: 'snaptrade' | 'plaid'     // Connection type
}
```

### getTaxHoldings

```typescript
{
  symbol?: string,                 // Filter to specific symbol
  accountId?: string               // Filter to specific account
}
```

### getTaxTransactions

```typescript
{
  symbol?: string,                 // Filter to specific symbol
  startDate?: string,              // ISO date (e.g. "2024-01-01")
  endDate?: string,                // ISO date
  limit?: number                   // Max results (default 100)
}
```

### getTaxLots

```typescript
{
  symbol?: string,                 // Filter to specific symbol
  status?: 'OPEN' | 'CLOSED' | 'ALL'  // Lot status filter (default ALL)
}
```

### simulateSale

```typescript
{
  symbol: string,                  // Ticker to simulate selling
  quantity: number,                // Number of shares to sell
  pricePerShare?: number,          // Sale price (defaults to current market price)
  taxBracketPct?: number           // Federal marginal rate (default 24%)
}
```

### createAdjustment

```typescript
{
  symbol: string,
  adjustmentType: 'COST_BASIS_OVERRIDE' | 'ADD_LOT' | 'REMOVE_LOT',
  data: Record<string, any>,      // Adjustment-specific data (costBasis, quantity, acquiredDate, etc.)
  note?: string,
  dataSource?: string
}
```

### updateAdjustment

```typescript
{
  adjustmentId: string,
  data?: Record<string, any>,
  note?: string
}
```

### deleteAdjustment

```typescript
{
  adjustmentId: string
}
```

### webSearch

```typescript
{
  query: string,                                    // Search query — be specific
  maxResults?: number,                              // 1-10, default 5
  topic?: 'general' | 'news',                      // Default 'general', use 'news' for current events
  timeRange?: 'day' | 'week' | 'month' | 'year'   // Recency filter, omit for all-time
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
  getHoldingDetail: GetHoldingDetailOutputSchema,
  getPortfolioChart: GetPortfolioChartOutputSchema,
  getDividendSummary: GetDividendSummaryOutputSchema,
  listActivities: ListActivitiesOutputSchema,
  getAllocations: GetAllocationsOutputSchema,
  getPerformance: GetPerformanceOutputSchema,
  getQuote: GetQuoteOutputSchema,
  getHistory: GetHistoryOutputSchema,
  getFundamentals: GetFundamentalsOutputSchema,
  getNews: GetNewsOutputSchema,
  computeRebalance: ComputeRebalanceOutputSchema,
  scenarioImpact: ScenarioImpactOutputSchema,
  // Tax Intelligence tools
  listConnectedAccounts: ListConnectedAccountsOutputSchema,
  syncAccount: SyncAccountOutputSchema,
  getTaxHoldings: GetTaxHoldingsOutputSchema,
  getTaxTransactions: GetTaxTransactionsOutputSchema,
  getTaxLots: GetTaxLotsOutputSchema,
  simulateSale: SimulateSaleOutputSchema,
  createAdjustment: CreateAdjustmentOutputSchema,
  updateAdjustment: UpdateAdjustmentOutputSchema,
  deleteAdjustment: DeleteAdjustmentOutputSchema,
  // Web Search
  webSearch: WebSearchOutputSchema
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
