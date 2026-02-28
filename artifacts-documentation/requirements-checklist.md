# Ghostfolio Requirements Checklist

## Project Overview

| Field       | Value                                              |
| ----------- | -------------------------------------------------- |
| **App**     | Ghostfolio (Personal Finance Dashboard)            |
| **Domain**  | `app.ghostclone.xyz`                               |
| **Stack**   | Angular 17+ / NestJS / Prisma / PostgreSQL / Redis |
| **Hosting** | Railway                                            |
| **Branch**  | `feature/mcp-rpc-result-unwrap`                    |

---

## 1. UI/UX Requirements

| #   | Requirement                                                          | Status | Notes                                                    |
| --- | -------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| 1.1 | Neomorphic design style (soft shadows, dual light/dark shadow pairs) | DONE   | All new components use `box-shadow` pairs                |
| 1.2 | Dark theme support (`.theme-dark` class)                             | DONE   | All SCSS includes `:host-context(.theme-dark)` overrides |
| 1.3 | Primary color `#36cfcc` / Secondary `#3686cf`                        | DONE   | Defined in `styles.scss` CSS variables                   |
| 1.4 | Inter font (Roboto fallback)                                         | DONE   | Global stylesheet                                        |
| 1.5 | Responsive layout (Bootstrap grid + Angular Material)                | DONE   | Mobile breakpoints, `d-none d-sm-block` patterns         |

---

## 2. Navigation & Layout

| #   | Requirement                                               | Status | Notes                                                       |
| --- | --------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| 2.1 | Remove Overview tab from home page                        | DONE   | Holdings is now default landing (`/home`)                   |
| 2.2 | Remove Overview tab from Market page                      | DONE   | Guides is now default sub-page                              |
| 2.3 | Rename "Resources" to "Market" in header                  | DONE   | Desktop nav + mobile menu                                   |
| 2.4 | Market charts always visible at top of Market page        | DONE   | `<gf-resources-markets>` embedded in parent                 |
| 2.5 | Resource tabs (Guides, Glossary) below charts             | DONE   | Tab bar repositioned below charts                           |
| 2.6 | "More" dropdown in header (near user widget)              | DONE   | Contains Holdings, Summary, Watchlist, Admin Control, About |
| 2.7 | Top nav items: Portfolio, Accounts, Market, Ghostfolio AI | DONE   | Cleaned up header nav bar                                   |
| 2.8 | Mobile menu mirrors desktop structure                     | DONE   | Account menu updated                                        |

---

## 3. Markets Dashboard

| #   | Requirement                                      | Status | Notes                                               |
| --- | ------------------------------------------------ | ------ | --------------------------------------------------- |
| 3.1 | Search bar for stocks/crypto/ETFs                | DONE   | Angular Material autocomplete with debounced search |
| 3.2 | Live symbol lookup via `/api/v1/symbol/lookup`   | DONE   | Uses `DataService.fetchSymbols()`                   |
| 3.3 | Add searched symbols as new chart cards          | DONE   | `onSelectSymbol()` adds to `chartConfigs`           |
| 3.4 | Remove user-added charts                         | DONE   | X button on user-added cards                        |
| 3.5 | Pre-configured charts (S&P 500, BTC, AAPL, etc.) | DONE   | 8 default chart configs                             |
| 3.6 | Date range selector (5D, 1M, 6M, 1Y)             | DONE   | Existing `dateRange` toggle                         |
| 3.7 | Neomorphic search bar styling                    | DONE   | Inset shadows, dark theme support                   |

---

## 4. AI Chat (AgentForge)

### 4.1 Tool Design (5+ tools)

| #   | Tool                  | Atomic | Idempotent | Documented | Error-Handled | Verified |
| --- | --------------------- | ------ | ---------- | ---------- | ------------- | -------- |
| 1   | `getPortfolioSummary` | YES    | YES        | YES        | YES           | YES      |
| 2   | `getPerformance`      | YES    | YES        | YES        | YES           | YES      |
| 3   | `getAllocations`      | YES    | YES        | YES        | YES           | YES      |
| 4   | `getQuote`            | YES    | YES        | YES        | YES           | YES      |
| 5   | `getHistory`          | YES    | YES        | YES        | YES           | YES      |
| 6   | `getFundamentals`     | YES    | YES        | YES        | YES           | YES      |
| 7   | `getNews`             | YES    | YES        | YES        | YES           | YES      |
| 8   | `computeRebalance`    | YES    | YES        | YES        | YES           | YES      |

### 4.2 Production Guardrails

| #   | Guardrail       | Required       | Implemented | Value |
| --- | --------------- | -------------- | ----------- | ----- |
| 1   | MAX_ITERATIONS  | 10-15          | YES         | 12    |
| 2   | TIMEOUT         | 30-45s         | YES         | 35s   |
| 3   | COST_LIMIT      | $1/query       | YES         | $1.00 |
| 4   | CIRCUIT_BREAKER | 3x same action | YES         | 3     |

### 4.3 Verification Layer (3+ types)

| #   | Type                    | Status | Notes                                          |
| --- | ----------------------- | ------ | ---------------------------------------------- |
| 1   | Fact Checking           | DONE   | Cross-references authoritative sources         |
| 2   | Hallucination Detection | DONE   | Flags unsupported claims, requires attribution |
| 3   | Confidence Scoring      | DONE   | 0-1 scale, surfaces low-confidence responses   |
| 4   | Domain Constraints      | DONE   | Valid tickers, real portfolio data only        |
| 5   | Human-in-the-Loop       | DONE   | Escalation for high-risk financial advice      |

### 4.4 Architecture

| #   | Requirement                                       | Status | Notes                                    |
| --- | ------------------------------------------------- | ------ | ---------------------------------------- |
| 1   | ReAct Loop (Thought -> Action -> Observation)     | DONE   | Vercel AI SDK `maxSteps` with tool calls |
| 2   | Tool results include `status, data, verification` | DONE   | Structured response format               |
| 3   | Error surfacing (actual error, not generic)       | DONE   | Returns OpenRouter error messages        |

### 4.5 Evaluation Framework

| #   | Requirement                | Target | Actual | Status |
| --- | -------------------------- | ------ | ------ | ------ |
| 1   | Total test cases           | 50+    | 85     | DONE   |
| 2   | Golden set cases           | —      | 57     | DONE   |
| 3   | Labeled scenarios          | —      | 28     | DONE   |
| 4   | Multi-step reasoning cases | 10+    | 14     | DONE   |
| 5   | Pass rate                  | >80%   | 96/96  | DONE   |
| 6   | Correctness scoring        | YES    | YES    | DONE   |
| 7   | Tool selection scoring     | YES    | YES    | DONE   |
| 8   | Tool execution scoring     | YES    | YES    | DONE   |
| 9   | Safety scoring             | YES    | YES    | DONE   |
| 10  | Latency target             | <5s    | YES    | DONE   |
| 11  | Cost tracking              | YES    | YES    | DONE   |

### 4.6 Observability

| #   | Requirement           | Status | Notes                     |
| --- | --------------------- | ------ | ------------------------- |
| 1   | Log every tool call   | DONE   | Braintrust telemetry      |
| 2   | Token count per query | DONE   | Tracked in telemetry      |
| 3   | Cost per query        | DONE   | Computed from token usage |

---

## 5. Plaid Broker Integration

| #   | Requirement                                  | Status  | Notes                                                        |
| --- | -------------------------------------------- | ------- | ------------------------------------------------------------ |
| 5.1 | Plaid Node SDK integration                   | DONE    | v41.3.0                                                      |
| 5.2 | Service, Controller, Module                  | DONE    | `plaid.service.ts`, `plaid.controller.ts`, `plaid.module.ts` |
| 5.3 | AES-256-GCM token encryption                 | DONE    | `encryption.util.ts`                                         |
| 5.4 | Frontend Link component                      | DONE    | Plaid Link flow                                              |
| 5.5 | `PLAID_CLIENT_ID` / `PLAID_API_KEY` fallback | DONE    | Supports both env var names                                  |
| 5.6 | `PLAID_API_KEY` in Environment interface     | DONE    | Fixes TypeScript build                                       |
| 5.7 | `PLAID_SECRET` configured in Railway         | PENDING | User must add to Railway Variables                           |

---

## 6. Deployment

| #   | Requirement                       | Status | Notes                                  |
| --- | --------------------------------- | ------ | -------------------------------------- |
| 6.1 | Railway PostgreSQL                | DONE   | Production database                    |
| 6.2 | Environment variables via Railway | DONE   | Property table pattern                 |
| 6.3 | Domain `app.ghostclone.xyz`       | DONE   | Custom domain configured               |
| 6.4 | Production build passes           | DONE   | `nx run client:build:production` clean |

---

## Summary

| Category            | Total  | Done   | Pending |
| ------------------- | ------ | ------ | ------- |
| UI/UX               | 5      | 5      | 0       |
| Navigation & Layout | 8      | 8      | 0       |
| Markets Dashboard   | 7      | 7      | 0       |
| AI Chat Tools       | 8      | 8      | 0       |
| AI Guardrails       | 4      | 4      | 0       |
| AI Verification     | 5      | 5      | 0       |
| AI Architecture     | 3      | 3      | 0       |
| AI Eval Framework   | 11     | 11     | 0       |
| AI Observability    | 3      | 3      | 0       |
| Plaid Integration   | 7      | 6      | 1       |
| Deployment          | 4      | 4      | 0       |
| **TOTAL**           | **65** | **64** | **1**   |

> **1 pending item:** `PLAID_SECRET` must be added to Railway environment variables for Plaid broker connections to work.
