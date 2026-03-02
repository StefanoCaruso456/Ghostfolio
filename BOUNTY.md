# $500 Bounty — AgentForge Submission

## Customer

**FIRE Pursuers** (Financial Independence, Retire Early) — millennials and Gen-Z investors (avg. age 32, avg. portfolio $350K) who self-manage diversified portfolios across multiple brokerage accounts. They need a single pane of glass to understand holdings, tax exposure, and market context without paying a financial advisor.

Secondary personas: **Dividend Income Investors** (avg. age 52, $310K portfolio, $11.2K/yr dividend income) and **Privacy-Conscious Self-Directed Investors** (avg. age 38, $285K portfolio) who want a self-hosted alternative to Mint/Wealthfront.

## Features

An AI-powered financial copilot embedded in Ghostfolio (open-source portfolio tracker) that can:

1. **Portfolio Analysis** — Summarize holdings, performance, allocations, dividends, and trade history across all connected accounts
2. **Real-Time Market Data** — Fetch live quotes, historical charts, fundamentals (P/E, market cap, dividend yield), and news for any ticker
3. **Tax Intelligence** — Derive FIFO tax lots, simulate sale tax impact (federal + state + NIIT), harvest tax losses, detect wash sale violations, and manage cost basis adjustments
4. **Scenario Modeling** — Stress-test portfolios against hypothetical market shocks and compute rebalancing deltas
5. **Web Search Fallback** — When market data providers are unavailable, the agent automatically falls back to web search for real-time information

The agent uses 26 tools with structured verification, production guardrails, and 85+ evaluation test cases.

## Data Sources

### 1. Plaid — Brokerage Account Connectivity

- **What it provides**: Secure OAuth connections to 12,000+ financial institutions. Syncs account balances, holdings, and transaction history directly from the user's brokerage.
- **Why it's valuable**: Eliminates manual data entry. Users connect once and get live portfolio data flowing into Ghostfolio automatically. This is the foundation — without account data, the agent has nothing to analyze.
- **How the agent uses it**: The `syncAccount` tool triggers Plaid syncs. The `listConnectedAccounts` tool shows connection status. All portfolio tools (`getPortfolioSummary`, `listActivities`, `getAllocations`, `getPerformance`) read from Plaid-synced data stored in the database.
- **Stored data**: Orders, account metadata, holdings — all persisted to PostgreSQL via Prisma.

### 2. SnapTrade — Brokerage Account Connectivity (Alternative)

- **What it provides**: Alternative brokerage aggregation API supporting brokerages that Plaid doesn't cover (particularly international and crypto-native brokerages).
- **Why it's valuable**: Extends coverage beyond Plaid's US-centric institution list. Users with accounts at Interactive Brokers, Wealthsimple, Questrade, etc. can connect seamlessly.
- **How the agent uses it**: Same as Plaid — the `syncAccount` tool triggers SnapTrade syncs, and all portfolio/tax tools read from the synced data.
- **Stored data**: Orders, account metadata, holdings — persisted to PostgreSQL.

### 3. Yahoo Finance (`yahoo-finance2`) — Market Data (Primary)

- **What it provides**: Real-time quotes, OHLCV historical price data, fundamental valuation metrics (P/E, EPS, dividend yield, market cap, sector, industry), and financial news articles.
- **Why it's valuable**: Free, no API key required, covers equities + ETFs + crypto + indices globally. Gives the agent real-time market context to pair with the user's portfolio data.
- **How the agent uses it**: Four dedicated tools — `getQuote` (live prices for up to 25 symbols), `getHistory` (price charts with returns/volatility/drawdown), `getFundamentals` (valuation ratios), and `getNews` (recent headlines with thumbnails and publisher info). Also powers the standalone News page (`/api/v1/news`).
- **Fallback**: CoinGecko (see below), then QuoteCacheService (last-known-good quotes from DB).
- **Stored data**: Quotes cached in-memory (60s TTL) and last-known-good quotes persisted to DB for fallback.

### 4. CoinGecko — Cryptocurrency Data (Yahoo Fallback)

- **What it provides**: Cryptocurrency pricing, market cap, and metadata for tokens not well-covered by Yahoo Finance.
- **Why it's valuable**: Yahoo Finance's crypto coverage is inconsistent. CoinGecko fills gaps for altcoins and DeFi tokens, ensuring the agent can always price crypto holdings.
- **How the agent uses it**: Automatically activated as the second provider in the fallback chain when Yahoo Finance fails or returns empty results for a symbol. Transparent to the user — they just get the quote.
- **Fallback chain**: Yahoo Finance (primary) → CoinGecko (crypto fallback) → QuoteCacheService (last-known DB cache).

### 5. Tavily — Web Search API

- **What it provides**: Real-time web search results with structured content extraction (titles, URLs, relevance scores, content snippets).
- **Why it's valuable**: Acts as the agent's "escape hatch" for questions beyond portfolio and market data — breaking news, analyst opinions, macroeconomic context, company events, or anything the structured tools can't answer. Also serves as a fallback when market data providers are down.
- **How the agent uses it**: The `webSearch` tool is called automatically when market data tools fail (system prompt instructs fallback) or when the user asks general financial questions. Sources are always cited in responses.
- **Stored data**: Not persisted (real-time search results).

### 6. Ghostfolio Portfolio Engine — Internal Data Source

- **What it provides**: The core portfolio calculation engine — performance metrics, allocation breakdowns, dividend summaries, portfolio charts, and holding-level detail computed from synced brokerage data.
- **Why it's valuable**: This is the "brain" that transforms raw transaction data (from Plaid/SnapTrade) into actionable portfolio insights. The agent reads from this engine rather than computing metrics from scratch.
- **How the agent uses it**: Seven portfolio tools (`getPortfolioSummary`, `getHoldingDetail`, `getPortfolioChart`, `getDividendSummary`, `listActivities`, `getAllocations`, `getPerformance`) all query Ghostfolio's internal services.
- **Stored data**: All source data (orders, accounts) persisted to PostgreSQL. Computed metrics derived on-the-fly.

## Data Source Fallback Architecture

```
Market Data Request
  │
  ├─► Yahoo Finance (primary, free, no key needed)
  │     └─ fail? ──► CoinGecko (crypto fallback)
  │                     └─ fail? ──► QuoteCacheService (last-known DB quote, marked stale)
  │                                     └─ fail? ──► Agent calls webSearch as final fallback
  │
  Brokerage Data Request
  │
  ├─► Plaid (US brokerages, 12K+ institutions)
  └─► SnapTrade (international brokerages, crypto-native)
```

## Stateful CRUD Operations

The agent doesn't just read data — it writes to the database through these operations:

| Operation                    | Tool               | Prisma Model            | DB Action                                   |
| ---------------------------- | ------------------ | ----------------------- | ------------------------------------------- |
| Create cost basis adjustment | `createAdjustment` | `TaxAdjustment`         | `prisma.taxAdjustment.create()`             |
| Update adjustment            | `updateAdjustment` | `TaxAdjustment`         | `prisma.taxAdjustment.update()`             |
| Delete adjustment            | `deleteAdjustment` | `TaxAdjustment`         | `prisma.taxAdjustment.delete()`             |
| Sync brokerage account       | `syncAccount`      | `Order`                 | Plaid/SnapTrade → `prisma.order.create()`   |
| Save conversation            | (auto)             | `AiConversation`        | `prisma.aiConversation.create()`            |
| Persist messages             | (auto)             | `AiConversationMessage` | `prisma.aiConversationMessage.createMany()` |
| Record feedback              | (auto)             | `AiFeedback`            | `prisma.aiFeedback.create()`                |
| Log trace metrics            | (auto)             | `AiTraceMetric`         | `prisma.aiTraceMetric.create()`             |

## Impact

1. **Time saved**: A FIRE investor checking portfolio health, tax exposure, and market context manually takes 30-60 minutes across multiple tools. The AI copilot answers the same questions in seconds with a single conversational query.

2. **Tax savings**: The `taxLossHarvest` tool identifies unrealized losses eligible for harvesting. For a $350K portfolio, this can save $1,000-5,000/year in federal taxes. The `washSaleCheck` tool prevents costly IRS violations that would disallow those deductions.

3. **Cost reduction**: Self-hosted and free (no subscription fees). Replaces paid services like Wealthfront ($0.25% AUM = $875/yr on $350K), Personal Capital, or financial advisor consultations ($200-500/session).

4. **Privacy**: All data stays on the user's own infrastructure. No third-party analytics, no data selling, no vendor lock-in. Critical for the privacy-conscious investor persona.

5. **Market size**: 875K addressable FIRE pursuers (primary), 1.45M dividend investors (secondary). Open-source Ghostfolio already has 5K+ active users as a base.
