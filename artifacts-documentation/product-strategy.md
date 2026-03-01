# Product Strategy

## Ghostfolio Tax Intelligence

---

## Product Vision

**For** high-income US investors managing multiple brokerage accounts
**Who** lack cross-account visibility into after-tax exposure before trading
**Ghostfolio Tax Intelligence** is a connected portfolio intelligence module
**That** unifies broker + bank data and enables deterministic tax simulations before execution
**Unlike** siloed broker dashboards or spreadsheets
**Our product** provides privacy-first, cross-account, explainable tax impact modeling accessible via AI tools.

---

## Insights

### Competitors

| Competitor Type | Limitation |
|----------------|------------|
| Brokers (E\*TRADE, IBKR) | Siloed views, no cross-account tax modeling |
| Aggregators | Aggregation without deterministic tax simulation in workflow |
| Tax Software | Filing-focused, not embedded in portfolio decision-making |

**Differentiator:** Connected accounts + deterministic tax simulation + structured AI tool access.

### Market Insight

- **Target:** US high-income investor ($500K+ portfolio, 2+ brokers)
- **Opportunity:** After-tax performance materially impacts real returns, yet is poorly surfaced pre-trade

### Market Trends

- Multi-broker investing
- Increased retail sophistication
- Demand for AI financial copilots
- Privacy-first financial tooling

---

## Customer Insight (Single Persona)

### High-Income Multi-Broker Investor

| Attribute | Detail |
|-----------|--------|
| Accounts | 2-4 brokerage accounts |
| Banking | Separate bank accounts |
| Behavior | Active allocation management |
| Concern | Tax drag on portfolio returns |
| Need | Control and predictability |

**Core Pain:** "I don't know my true tax exposure across accounts before I sell."

---

## Challenges

### Technical

- Normalize SnapTrade + Plaid schemas
- Reliable Yahoo price ingestion
- Deterministic tax computation
- Sync reliability + reconciliation

### Customer Pain Points

- Fear of incorrect numbers
- Low trust if broker values mismatch
- Confusion around short vs long-term gains

### GTM Risks

- Friction connecting accounts
- Trust around data handling

### Legal

- Clear "informational only" disclaimer
- Secure token storage
- No personalized tax advice

---

## Approaches

### Approach (Multi-Prong)

1. **SnapTrade** -> brokerage holdings + transactions
2. **Plaid** -> bank balances
3. **Yahoo pipeline** -> live market pricing
4. **Normalize** into canonical ledger
5. **Expose** structured CRUD tools to agent
6. **Deliver** deterministic sell simulation

### Overcoming Challenges

- Cache + fallback for Yahoo pricing
- Sync metadata + reconciliation status
- Transparent tax assumptions
- Agent restricted to structured internal tools

### Do's

- Store stateful linked account data
- Expose CRUD endpoints
- Show calculation breakdown
- Maintain observability logs

### Don'ts

- No tax filing
- No execution engine
- No black-box AI estimates

---

## Accountability

### North Star Metric

**% of connected users who run >= 1 tax simulation before a sell decision.**

### Supporting Metrics

| Metric | Purpose |
|--------|---------|
| Broker connect success rate | Connectivity reliability |
| Sync reliability | Data freshness |
| Simulation completion rate | Feature adoption |
| Agent tool-call schema validity | System correctness |
| User trust score | User confidence |
