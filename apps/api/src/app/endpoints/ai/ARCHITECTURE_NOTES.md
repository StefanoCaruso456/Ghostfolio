# AI Chat — Market Data Resilience Architecture

## Problem

Yahoo Finance (via `yahoo-finance2`) is unreachable from Railway's infrastructure due to DNS resolution failures (`EAI_AGAIN`, `ECONNREFUSED`). This causes **both** market data tools (getQuote, getHistory, etc.) and portfolio tools (getPortfolioSummary, getAllocations, etc.) to fail, since the portfolio service needs current quotes to compute values.

## Solution: Provider Fallback Stack + Quote Caching + Graceful Degradation

### 1. Provider Order (Fallback Chain)

```
FallbackMarketDataProvider
  ├── Primary:   CachedProvider(Yahoo)     ← configurable via env
  ├── Fallback:  CachedProvider(CoinGecko) ← configurable via env
  └── Last-Known: QuoteCacheService        ← persistent DB cache
```

**Environment variables:**

- `MARKET_DATA_PRIMARY_PROVIDER` — First-choice provider (default: `yahoo`)
- `MARKET_DATA_FALLBACK_PROVIDERS` — Comma-separated fallback list (default: `coingecko`)
- `MARKET_DATA_CACHE_ENABLED` — Enable TTL cache layer (default: `true`)

**Behavior:**

1. Try primary provider → on success, cache quotes and return
2. If primary fails, try fallback providers in order
3. If ALL providers fail, return last-known quotes from persistent cache (marked `isStale`)
4. If no cached quote exists, return error for that symbol

### 2. Cache Strategy

**Layer 1: In-Memory TTL Cache** (`CachedMarketDataProvider`)

- Quotes: 60s TTL
- History: 5min TTL
- Fundamentals: 5min TTL
- News: 2min TTL
- Wraps each individual provider in the chain

**Layer 2: Persistent Last-Known-Good** (`QuoteCacheService` + `LastKnownQuote` table)

- Every successful quote is persisted to PostgreSQL
- Keyed by symbol (uppercase)
- Stores: price, currency, source, updatedAt
- No TTL — represents "last time we successfully got a quote"
- Used only when ALL providers fail

**Layer 3: In-Memory Stale Fallback**

- Even after TTL expiry, in-memory quotes are retained (not deleted)
- `getLastKnown()` returns them as stale before hitting the DB
- Avoids DB round-trip for recently-fetched symbols

### 3. Degradation Behavior

| Scenario                          | quoteStatus   | Behavior                         |
| --------------------------------- | ------------- | -------------------------------- |
| All providers working             | `fresh`       | Normal operation                 |
| Primary fails, fallback succeeds  | `fresh`       | Transparent fallback             |
| All providers fail, cache hit     | `stale`       | Returns cached prices + warning  |
| All providers fail, partial cache | `partial`     | Some fresh, some stale           |
| All providers fail, no cache      | `unavailable` | Error for missing symbols        |
| Portfolio service throws          | `unavailable` | Degraded result (empty holdings) |

**Portfolio tools never hard-fail.** They return a result with `quoteMetadata` indicating data freshness:

```typescript
{
  status: 'success',
  data: { holdingsCount: 5, ... },
  quoteMetadata: {
    quoteStatus: 'partial',
    quotesAsOf: '2026-02-27T10:00:00Z',
    message: 'Some prices may be stale due to provider issues'
  }
}
```

The LLM is instructed to relay freshness warnings to the user, e.g.:

> "Your portfolio has 5 holdings. Note: some prices may use cached values from earlier today."

### 4. Sequential Fetch Fix

**Before:** Yahoo quotes were fetched one-by-one in a `for` loop with 15s timeout each. 25 symbols = up to 6 minutes.

**After:** `FallbackMarketDataProvider.fetchQuotesInBatches()` splits symbols into batches of 10 and fetches them with `Promise.allSettled()`. Each provider attempt has a 20s overall timeout.

### 5. Bug Fixes

**CostLimiter now enforced:**

- `costLimiter.addCost()` called after each tool step (estimated ~1K prompt + 500 completion tokens)
- Also called after `generateText()` completes with actual token counts
- The `$1/query` guardrail is now functional

**Verification gate now blocks:**

- When `enforceVerificationGate()` returns `decision: 'block'`, the tool result is replaced with an error
- Previously it only logged — the LLM could still use blocked data

### 6. File Map

```
providers/
  ├── market-data.provider.ts      — Yahoo provider + factory (updated)
  ├── fallback-market-data.provider.ts — NEW: fallback chain wrapper
  ├── quote-cache.service.ts       — NEW: 2-layer quote cache
  ├── cached-market-data.provider.ts — TTL cache (unchanged)
  ├── coingecko-market-data.provider.ts — CoinGecko (unchanged)
  ├── market-data.types.ts         — Provider interface (unchanged)
  ├── index.ts                     — Re-exports (updated)
  └── __tests__/
      ├── quote-cache.spec.ts      — NEW: 9 tests
      └── fallback-provider.spec.ts — NEW: 10 tests

tools/
  ├── get-portfolio-summary.tool.ts — Updated: quoteMetadata
  ├── get-allocations.tool.ts       — Updated: quoteMetadata
  └── schemas/
      ├── quote-metadata.schema.ts  — NEW: shared schema
      ├── portfolio-summary.schema.ts — Updated
      ├── allocations.schema.ts      — Updated
      ├── performance.schema.ts      — Updated
      ├── compute-rebalance.schema.ts — Updated
      └── scenario-impact.schema.ts  — Updated

prisma/schema.prisma               — NEW model: LastKnownQuote
ai.service.ts                       — Updated: safeGetDetails, safeGetPerformance, cost limiter, verification gate
```
