# Ghostfolio AI Copilot — AgentForge $500 Bounty Submission

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Customer](#customer)
3. [Solution Overview](#solution-overview)
4. [Features](#features)
5. [Data Sources](#data-sources)
6. [Agent Architecture](#agent-architecture)
7. [Production Guardrails](#production-guardrails)
8. [Stateful Operations](#stateful-operations)
9. [Evaluation](#evaluation)
10. [Impact](#impact)

---

## Problem Statement

Self-directed investors manage portfolios across multiple brokerage accounts but lack a unified, intelligent interface to answer questions like:

- "What's my total tax liability if I sell all my NVDA shares?"
- "Which holdings have unrealized losses I can harvest before year-end?"
- "Am I violating IRS wash sale rules?"
- "What's my portfolio exposure to a 20% tech crash?"

Today they context-switch between brokerage dashboards, tax software, market data sites, and spreadsheets. There is no single tool that connects their actual portfolio data with real-time market intelligence and tax logic — especially not one they can self-host and own their data.

---

## Customer

| Persona                            | Age | Portfolio | Key Need                                               |
| ---------------------------------- | --- | --------- | ------------------------------------------------------ |
| **FIRE Pursuers** (primary)        | ~32 | $350K     | Single pane of glass across accounts, tax optimization |
| **Dividend Income Investors**      | ~52 | $310K     | Dividend tracking, income forecasting                  |
| **Privacy-Conscious Self-Hosters** | ~38 | $285K     | No third-party data sharing, full data ownership       |

All personas share a common trait: they self-manage diversified portfolios and want AI-powered insights without paying a financial advisor ($200-500/session) or surrendering data to a SaaS platform.

---

## Solution Overview

An AI-powered financial copilot embedded in [Ghostfolio](https://github.com/ghostfolio/ghostfolio) (open-source, self-hosted portfolio tracker) that combines:

- **26 specialized tools** for portfolio analysis, market data, tax intelligence, and scenario modeling
- **6 external + internal data sources** with automatic fallback chains
- **ReAct agent loop** (Thought -> Action -> Observation -> Repeat) with structured verification
- **Full-stack UI** — neomorphic chat sidebar with conversation history, voice input, file attachments, tool discovery panel, and reasoning trace visualization

---

## Features

### 1. Market News Tab with Source Links

A dedicated `/news` page displays a card grid of real-time market news articles sourced from Yahoo Finance. Each card shows:

- Thumbnail image (or placeholder)
- Headline as a clickable link to the original source
- Publisher name and relative timestamp ("2h ago")

In the AI chat, when the agent calls `getNews`, it renders each result as a **clickable thumbnail linking to the article** using markdown: `[![Headline](thumbnail_url)](article_url)`, plus a bullet-point summary, source attribution, and a separate article URL. Every news item is traceable back to its original source.

**Tool**: `getNews` — fetches recent headlines, thumbnails, URLs, and publisher info for any ticker symbol. Configurable limit and recency window (days).

### 2. Capital Gains Simulation Before Selling

Before a user sells any holding, they can simulate the exact tax impact:

- **`simulateSale`** — "What if I sell 50 shares of NVDA?" Computes FIFO lot selection, short-term vs. long-term gain/loss breakdown, federal tax (at bracket rate), state tax (configurable), and Net Investment Income Tax (NIIT at 3.8%). Returns a mandatory 4-layer tax breakdown table:

  | Tax Layer                | Gain/Loss | Rate | Estimated Tax |
  | ------------------------ | --------- | ---- | ------------- |
  | Short-term capital gains | $X        | 24%  | $X            |
  | Long-term capital gains  | $X        | 15%  | $X            |
  | State tax                | $X        | 5%   | $X            |
  | NIIT (3.8%)              | $X        | 3.8% | $X            |

- **`portfolioLiquidation`** — "What if I sell everything?" Simulates selling ALL holdings at once with a per-holding tax breakdown and total liability. Fully self-contained: fetches market prices, tax lots, and holdings internally in a single tool call.

Both tools are self-contained (no prerequisite tool calls needed), always include a "not tax advice" disclaimer, and support configurable federal bracket, state rate, and filing status.

### 3. Tax-Loss Harvesting & Wash Sale Detection

- **`taxLossHarvest`** — Scans all holdings for unrealized losses eligible for harvesting. Shows potential tax savings, flags positions with wash sale risk (repurchases within 30 days), and ranks candidates by savings magnitude.
- **`washSaleCheck`** — Scans transaction history for IRS wash sale violations: substantially identical securities repurchased within 30 days before or after a loss sale. Flags confirmed violations and at-risk positions.

### 4. Portfolio Analysis (7 Tools)

| Tool                  | What It Does                                                               |
| --------------------- | -------------------------------------------------------------------------- |
| `getPortfolioSummary` | Holdings count, top allocations, accounts, base currency                   |
| `getHoldingDetail`    | Deep dive on one holding: position size, performance, dividends, fees, ATH |
| `getPortfolioChart`   | Portfolio value over time with peak, trough, total change                  |
| `getDividendSummary`  | Total dividends, breakdown by symbol and period (monthly/yearly)           |
| `listActivities`      | Trade history with date range and type filtering                           |
| `getAllocations`      | Breakdown by asset class, sub-class, currency, sector                      |
| `getPerformance`      | Net performance, returns %, total investment, net worth                    |

### 5. Real-Time Market Intelligence (4 Tools)

| Tool              | What It Does                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `getQuote`        | Live prices for 1-25 symbols: price, daily change, currency           |
| `getHistory`      | OHLCV historical data with returns, volatility, max drawdown          |
| `getFundamentals` | P/E, EPS, market cap, dividend yield, sector, industry                |
| `getNews`         | Headlines with thumbnails, publisher info, and clickable source links |

### 6. Scenario Modeling & Rebalancing

- **`scenarioImpact`** — "What if NVDA drops 20%?" or "What if tech falls 10%?" Uses current allocations and deterministic arithmetic. No predictions, no speculation — pure math.
- **`computeRebalance`** — Compares current allocation against target allocation and computes deltas with suggested buy/sell moves.

### 7. Brokerage Account Management

- **`listConnectedAccounts`** — Shows all connected Plaid (bank/brokerage) and SnapTrade (international brokerage) accounts with sync status.
- **`syncAccount`** — Triggers a live sync for a specific account, pulling latest holdings and transactions.

### 8. Cost Basis Adjustment CRUD

- **`createAdjustment`** / **`updateAdjustment`** / **`deleteAdjustment`** — Manage cost basis corrections when source data is wrong or missing (e.g., transferred-in lots, corporate actions, stock splits).

### 9. Web Search Fallback

- **`webSearch`** — Powered by Tavily. Used for questions beyond portfolio/market data scope: breaking news, analyst opinions, macroeconomic context, company events. Always cites sources. Also serves as the final fallback when all market data providers fail.

### 10. AI Chat Interface

The frontend is a full Perplexity-style chat experience:

- **Sidebar mode** (slide-in panel) and **fullscreen mode** (dedicated `/ai-chat` page)
- **Conversation history** — persistent conversations saved to DB, renamable, deletable
- **Streaming responses** with typing indicator and reasoning trace panel (`gf-reasoning-panel`)
- **Voice input** (Web Speech API) and **file attachments** (images, CSV)
- **Tool Discovery panel** — categorized catalog of all 26 tools with one-click example prompts
- **Suggested prompts** on welcome screen for common queries
- **Copy, retry** actions on messages
- **Drag-and-drop** file uploads
- **Neomorphic design** with light/dark theme support

---

## Data Sources

### 1. Plaid — Brokerage Account Connectivity

- **What it provides**: Secure OAuth connections to 12,000+ US financial institutions. Syncs account balances, holdings, and transaction history directly from the user's brokerage.
- **Why it's valuable**: This is the foundation of everything. Without account connectivity, the agent has no portfolio data to analyze. Plaid eliminates manual data entry — users connect once and get live data flowing automatically. Every portfolio tool, tax tool, and allocation tool reads from Plaid-synced data.
- **How the agent uses it**: `syncAccount` triggers Plaid syncs. `listConnectedAccounts` shows connection status. All 7 portfolio tools + all 8 tax tools read from Plaid-synced data stored in PostgreSQL.
- **Config**: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (sandbox/development/production)
- **Data persistence**: Orders, account metadata, holdings -> PostgreSQL via Prisma

### 2. SnapTrade — International Brokerage Connectivity

- **What it provides**: Alternative brokerage aggregation API covering brokerages Plaid doesn't support — particularly international (Interactive Brokers, Wealthsimple, Questrade) and crypto-native platforms.
- **Why it's valuable**: Plaid is US-centric. SnapTrade extends coverage globally, which is critical for the privacy-conscious self-hoster persona who may use international brokerages specifically to avoid US platform data harvesting. Together, Plaid + SnapTrade cover virtually any brokerage a self-directed investor would use.
- **How the agent uses it**: Same pipeline as Plaid — `syncAccount` triggers SnapTrade syncs, data flows into the same normalized schema, and all portfolio/tax tools read from it transparently.
- **Data persistence**: Orders, account metadata, holdings -> PostgreSQL via Prisma

### 3. Yahoo Finance (`yahoo-finance2`) — Market Data (Primary)

- **What it provides**: Real-time quotes, OHLCV historical price data, fundamental valuation metrics (P/E, EPS, dividend yield, market cap, sector, industry), and financial news articles with thumbnails and publisher metadata.
- **Why it's valuable**: Free, no API key required, global coverage (equities, ETFs, crypto, indices, forex). This is the primary market intelligence layer — it pairs real-time market context with the user's portfolio data. Without it, the agent could tell you what you own but not what it's worth or what's happening in the market.
- **How the agent uses it**: Four dedicated tools — `getQuote` (live prices, batched up to 25 symbols), `getHistory` (price charts with computed returns/volatility/drawdown), `getFundamentals` (valuation ratios for fundamental analysis), `getNews` (headlines with clickable source links). Also powers the standalone News page at `/news`.
- **Caching**: In-memory TTL cache (60s) + last-known-good quotes persisted to DB for stale fallback

### 4. CoinGecko — Cryptocurrency Data (Yahoo Fallback)

- **What it provides**: Cryptocurrency pricing, market cap, volume, and metadata for 10,000+ tokens.
- **Why it's valuable**: Yahoo Finance's crypto coverage is inconsistent — many altcoins and DeFi tokens return empty results. CoinGecko is the gold standard for crypto data. It automatically activates as the second provider in the fallback chain when Yahoo fails for a symbol, so crypto-heavy portfolios always get accurate pricing.
- **How the agent uses it**: Transparent to the user. The `FallbackMarketDataProvider` tries Yahoo first, then CoinGecko. The user just asks "what's my BTC worth?" and gets the answer regardless of which provider responded.
- **Config**: `API_KEY_COINGECKO_DEMO` (optional, reduces rate limits), `API_KEY_COINGECKO_PRO` (optional, uses pro endpoint)
- **Fallback position**: 2nd in chain (Yahoo -> **CoinGecko** -> QuoteCacheService -> webSearch)

### 5. Tavily — Web Search API

- **What it provides**: Real-time web search results with structured content extraction (titles, URLs, relevance scores, content snippets, answer summaries).
- **Why it's valuable**: The agent's "escape hatch." Financial questions don't stop at portfolio data and market quotes — users ask about Fed rate decisions, earnings reports, analyst ratings, macroeconomic trends, or "should I buy X?" Tavily gives the agent access to the entire web, with source attribution baked in. It also serves as the **last-resort fallback** when Yahoo Finance and CoinGecko both fail.
- **How the agent uses it**: The `webSearch` tool fires when (a) the user asks a question outside portfolio/market scope, or (b) market data providers all fail. Sources are always cited in the response with clickable URLs.
- **Config**: `TAVILY_API_KEY`
- **Data persistence**: Not persisted (real-time search, pass-through)

### 6. Ghostfolio Portfolio Engine — Internal Computation Layer

- **What it provides**: The core calculation engine that transforms raw transaction data into portfolio insights — performance metrics, allocation breakdowns, dividend summaries, portfolio charts, holding-level detail, and FIFO tax lot derivation.
- **Why it's valuable**: This is where Plaid/SnapTrade's raw data becomes _useful_. The engine computes time-weighted returns, allocation percentages, dividend aggregations, and tax lots. Without it, the agent would need to reimplement portfolio math from scratch on every query.
- **How the agent uses it**: Seven portfolio tools query Ghostfolio's internal `PortfolioService`, `PortfolioCalculator`, and related services. Eight tax tools query the `TaxService` which derives FIFO lots and simulates sales.
- **Data persistence**: Source data (orders, accounts) in PostgreSQL. Computed metrics derived on-the-fly per request.

### 7. Additional Original Ghostfolio Providers (Not Used by AI Agent)

The Ghostfolio platform also registers these data providers in its `DataSource` enum for asset price gathering (background jobs, not AI agent tools):

| Provider                    | Purpose                                         | Config                            |
| --------------------------- | ----------------------------------------------- | --------------------------------- |
| **Alpha Vantage**           | US equity fundamentals and forex                | `API_KEY_ALPHA_VANTAGE`           |
| **EOD Historical Data**     | End-of-day prices, 60+ exchanges                | `API_KEY_EOD_HISTORICAL_DATA`     |
| **Financial Modeling Prep** | Financial statements, DCF valuations            | `API_KEY_FINANCIAL_MODELING_PREP` |
| **Rapid API**               | Various financial data via RapidAPI marketplace | `API_KEY_RAPID_API`               |
| **Google Sheets**           | Manual data import from spreadsheets            | Google Sheets API                 |
| **Manual**                  | User-entered manual price data                  | None                              |

These power Ghostfolio's background data-gathering jobs (asset price history, symbol profiles) and are available to the AI agent indirectly — the portfolio engine reads from data these providers populate.

---

## Data Source Fallback Architecture

```
User asks a question
  │
  ├─ Portfolio question? ──► Ghostfolio Engine (reads Plaid/SnapTrade-synced DB data)
  │
  ├─ Market data question? ──► Fallback Chain:
  │     1. Yahoo Finance (primary, free, no API key)
  │     2. CoinGecko (crypto fallback, optional API key)
  │     3. QuoteCacheService (last-known-good DB quote, marked stale)
  │     4. Tavily webSearch (final fallback, requires TAVILY_API_KEY)
  │
  ├─ Tax question? ──► TaxService (reads DB) + Market Data Chain (for current prices)
  │
  └─ General/news question? ──► Tavily webSearch (with source citations)

Brokerage Sync
  │
  ├─► Plaid (US brokerages, 12K+ institutions)
  └─► SnapTrade (international brokerages, crypto-native)
```

---

## Agent Architecture

```
User Message
  │
  ▼
System Prompt (tool descriptions, groundedness contract, tax format rules)
  │
  ▼
ReAct Loop (max 10-15 iterations)
  ├─ Thought: "User wants tax impact of selling NVDA"
  ├─ Action: call simulateSale(symbol="NVDA", quantity=50)
  ├─ Observation: { status: "success", data: { ... }, verification: { passed: true, confidence: 0.95 } }
  └─ Repeat until answer is grounded in tool results
  │
  ▼
Streaming Response (markdown with tables, citations, disclaimers)
  │
  ▼
Persistence: conversation + messages + trace metrics -> PostgreSQL
```

### Production Guardrails

| Guardrail          | Value                   | Purpose                                                 |
| ------------------ | ----------------------- | ------------------------------------------------------- |
| `MAX_ITERATIONS`   | 10-15                   | Prevent infinite tool loops                             |
| `TIMEOUT`          | 150s                    | User experience limit (multi-step chains need headroom) |
| `COST_LIMIT`       | $1/query                | Prevent bill explosions                                 |
| `CIRCUIT_BREAKER`  | Same action 3x -> abort | Prevent retry storms                                    |
| `PROVIDER_TIMEOUT` | 20s per provider        | Prevent one slow provider from blocking the chain       |
| `QUOTE_BATCH_SIZE` | 10 symbols/batch        | Parallel fetching, prevents API overload                |

### Verification Layer

Every tool result includes structured verification:

```json
{
  "status": "success",
  "data": { ... },
  "verification": {
    "passed": true,
    "confidence": 0.95,
    "warnings": [],
    "errors": [],
    "sources": ["yahoo-finance", "portfolio-db"]
  }
}
```

Verification types implemented:

1. **Fact Checking** — cross-reference portfolio DB data with market data providers
2. **Hallucination Detection** — groundedness contract: agent NEVER outputs portfolio/market numbers unless they come from tool results
3. **Confidence Scoring** — 0-1 scale on every tool result, low-confidence responses surfaced to user
4. **Domain Constraints** — valid ticker validation, real portfolio data only (no made-up holdings)
5. **Human-in-the-Loop** — tax tools always include "not financial/tax advice" disclaimer; high-risk actions (delete, sell simulation) require explicit user intent

---

## Stateful Operations

The agent reads AND writes to the database:

| Operation                    | Tool               | Prisma Model            | DB Action                                   |
| ---------------------------- | ------------------ | ----------------------- | ------------------------------------------- |
| Create cost basis adjustment | `createAdjustment` | `TaxAdjustment`         | `prisma.taxAdjustment.create()`             |
| Update adjustment            | `updateAdjustment` | `TaxAdjustment`         | `prisma.taxAdjustment.update()`             |
| Delete adjustment            | `deleteAdjustment` | `TaxAdjustment`         | `prisma.taxAdjustment.delete()`             |
| Sync brokerage account       | `syncAccount`      | `Order`                 | Plaid/SnapTrade -> `prisma.order.create()`  |
| Save conversation            | (auto)             | `AiConversation`        | `prisma.aiConversation.create()`            |
| Persist messages             | (auto)             | `AiConversationMessage` | `prisma.aiConversationMessage.createMany()` |
| Record feedback              | (auto)             | `AiFeedback`            | `prisma.aiFeedback.create()`                |
| Log trace metrics            | (auto)             | `AiTraceMetric`         | `prisma.aiTraceMetric.create()`             |

---

## Evaluation

- **85+ test cases** covering correctness, tool selection, tool execution, safety, and latency
- **Latency target**: <5s for single-tool queries, <30s for multi-step chains
- **Pass rate target**: >80% (good), >90% (excellent)
- **Observability**: Every tool call logged with token count, cost, latency, and provider used (via `AiTraceMetric`)

---

## Impact

1. **Time saved**: A FIRE investor checking portfolio health, tax exposure, and market context manually takes 30-60 minutes across multiple tools (brokerage dashboard + TurboTax + Yahoo Finance + spreadsheets). The AI copilot answers the same questions in seconds with a single conversational query.

2. **Tax savings**: The `taxLossHarvest` tool identifies unrealized losses eligible for harvesting. For a $350K portfolio, this can save $1,000-5,000/year in federal taxes. The `washSaleCheck` tool prevents costly IRS violations that would disallow those deductions entirely.

3. **Capital gains visibility**: `simulateSale` and `portfolioLiquidation` let users see their exact tax bill BEFORE executing a trade — something no brokerage dashboard provides with this level of detail (federal + state + NIIT breakdown by lot, with FIFO ordering).

4. **Cost reduction**: Self-hosted and free. Replaces paid services like Wealthfront ($0.25% AUM = $875/yr on $350K), Personal Capital premium, or financial advisor consultations ($200-500/session).

5. **Privacy**: All data stays on the user's own infrastructure. No third-party analytics, no data selling, no vendor lock-in. Plaid/SnapTrade tokens stored locally, all AI conversations stored in the user's own PostgreSQL instance.

6. **Market size**: 875K addressable FIRE pursuers (primary), 1.45M dividend investors (secondary). Open-source Ghostfolio already has 5K+ GitHub stars as a distribution base.
