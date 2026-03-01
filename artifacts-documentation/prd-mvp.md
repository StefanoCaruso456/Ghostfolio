# PRD - Ghostfolio Tax Intelligence

---

| Field | Value |
|-------|-------|
| **Title** | Tax Intelligence (Connected Accounts) |
| **Author** | Stefano |
| **Status** | Draft |
| **PM Epic** | TBD |

---

## One Pager

### Overview

Tax Intelligence connects brokerage (SnapTrade) and bank (Plaid) accounts, stores normalized portfolio data, streams live pricing via Yahoo, and enables tax impact simulation through structured API tools accessible by Ghostfolio AI.

### Problem

High-income multi-broker investors lack cross-account after-tax visibility before trading. Selling decisions are made without deterministic exposure modeling.

### Objectives

1. Enable brokerage + bank connectivity
2. Store normalized holdings + transactions
3. Provide deterministic sell simulation
4. Allow AI agent to access data via structured CRUD tools

### Constraints

1. SnapTrade coverage variability
2. Yahoo data reliability
3. No tax advisory claims
4. Limited MVP scope (federal estimates only)

### Persona

**High-Income Multi-Broker Investor** - $500K+ portfolio, 2+ brokerages, active allocator.

### Use Cases

1. Connect brokerage + bank accounts
2. View cross-account tax exposure
3. Ask AI: *"If I sell 100 shares of NVDA today, what is my estimated tax impact?"*
4. Adjust missing transaction and re-run simulation

---

## PRD Details

### Features In

#### 1. Account Connectivity

- SnapTrade broker connect
- Plaid bank connect
- Store linked account state
- Sync metadata

#### 2. Data Normalization

- Holdings table
- Transactions table
- Derived tax lots
- Sync status logs

#### 3. Tax Simulation Engine

| Component | Detail |
|-----------|--------|
| Lot Selection | FIFO (MVP) |
| Holding Period | Short-term vs long-term split |
| Tax Rate | Federal bracket assumption |
| Pricing | Yahoo pipeline |
| Computation | Deterministic |

#### 4. Agent Tool Access (Bounty Requirement)

Agent must call Ghostfolio API tools — agent **cannot** call SnapTrade, Plaid, or Yahoo directly.

| # | Tool | Purpose |
|---|------|---------|
| 1 | `listConnectedAccounts()` | List all linked brokerage/bank accounts |
| 2 | `syncAccount()` | Trigger data sync for a connected account |
| 3 | `getHoldings()` | Retrieve normalized cross-account holdings |
| 4 | `getTransactions()` | Retrieve normalized transaction history |
| 5 | `getTaxLots()` | Get FIFO-derived tax lots with holding period |
| 6 | `simulateSale()` | Run deterministic sell simulation with tax estimate |
| 7 | `createAdjustment()` | Add manual cost-basis adjustment |
| 8 | `updateAdjustment()` | Modify existing adjustment |
| 9 | `deleteAdjustment()` | Remove an adjustment |
| 10 | `webSearch()` | Search the web for real-time news, analysis, and general knowledge (Tavily API) |

### Features Out

- Wash sale detection
- State taxes
- Tax filing support
- Trade execution
- Optimization recommendations

---

## Technical Considerations

- Canonical ledger schema
- Encryption for connection tokens
- Price caching + fallback
- Audit logs for sync + simulations
- Tool schema validation

---

## Success Metrics

### North Star

**>= 20% of connected users run simulation within 30 days.**

### Operational Metrics

| Metric | Target |
|--------|--------|
| Broker connect success | >= 85% |
| Sync reliability | >= 90% |
| Tool schema validation | >= 95% |
| Simulation failures (missing price) | < 5% |

---

## GTM Approach

- **Messaging:** "Simulate your tax impact before you trade - across every connected account."
- **Positioning:** Privacy-first, connected, deterministic financial intelligence.

---

## Open Issues

- Confirm SnapTrade lot granularity
- Confirm Plaid investment vs bank scope
- Finalize minimal tax profile input

---

## Timeline

| Phase | Scope |
|-------|-------|
| **Phase 1** | Connectivity + normalization |
| **Phase 2** | Tax Intelligence tab + simulation |
| **Phase 3** | Agent tooling hardening + observability |
