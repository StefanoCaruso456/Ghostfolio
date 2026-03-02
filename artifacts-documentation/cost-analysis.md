# AI Chat Production Cost Projections

## Assumptions

| Parameter                  | Value                       |
| -------------------------- | --------------------------- |
| Model                      | `anthropic/claude-sonnet-4` |
| Queries/user/day           | 3                           |
| Avg input tokens/query     | 1,200                       |
| Avg output tokens/query    | 400                         |
| Tool call rate             | 70%                         |
| Avg tool calls/query       | 2.1                         |
| Tokens per tool result     | 350                         |
| Verification overhead rate | 15%                         |
| Verification extra tokens  | 200                         |
| Days/month                 | 30                          |

### Derivation

- **Effective input tokens/query** = 1,200 base + (0.70 × 2.1 × 350 tool tokens) + (0.15 × 200 verification) = 1,200 + 514.5 + 30 = **1,744.5 tokens**
- **Effective output tokens/query** = **400 tokens** (unchanged)
- **Pricing**: Prompt $0.003/1K, Completion $0.015/1K (from `MODEL_PRICING['anthropic/claude-sonnet-4']`)
- **Cost/query** = (1,744.5/1000 × $0.003) + (400/1000 × $0.015) = $0.005234 + $0.006 = **~$0.0112/query**

## Cost Projections

|   Users | Queries/mo | Input Tokens/mo | Output Tokens/mo | Monthly Cost | $/query | $/user/mo |
| ------: | ---------: | --------------: | ---------------: | -----------: | ------: | --------: |
|     100 |      9,000 |      15,700,500 |        3,600,000 |      $101.10 | $0.0112 |     $1.01 |
|   1,000 |     90,000 |     157,005,000 |       36,000,000 |    $1,011.02 | $0.0112 |     $1.01 |
|  10,000 |    900,000 |   1,570,050,000 |      360,000,000 |   $10,110.15 | $0.0112 |     $1.01 |
| 100,000 |  9,000,000 |  15,700,500,000 |    3,600,000,000 |  $101,101.50 | $0.0112 |     $1.01 |

## Multi-Model Pricing Reference

All LLM calls route through OpenRouter. Pricing per 1K tokens:

| Model                       | Prompt (per 1K) | Completion (per 1K) | Est. Cost/Query | Notes               |
| --------------------------- | --------------- | ------------------- | --------------- | ------------------- |
| `anthropic/claude-sonnet-4` | $0.003          | $0.015              | $0.0112         | Primary model       |
| `anthropic/claude-haiku-4`  | $0.00025        | $0.00125            | $0.0009         | Fast/cheap fallback |
| `openai/gpt-4o`             | $0.0025         | $0.010              | $0.0084         | Alternative         |
| `openai/gpt-4o-mini`        | $0.00015        | $0.0006             | $0.0005         | Budget alternative  |
| `google/gemini-2.0-flash`   | $0.0001         | $0.0004             | $0.0003         | Cheapest option     |

Source: `MODEL_PRICING` in `apps/api/src/app/import-auditor/schemas/agent-metrics.schema.ts`

## Cost Reduction Strategies

| Strategy                                                    | Estimated Savings          | Implementation Effort         |
| ----------------------------------------------------------- | -------------------------- | ----------------------------- |
| Switch to `openai/gpt-4o-mini` for simple queries           | 80-90% on those queries    | Medium (query classifier)     |
| Tiered model routing (haiku for simple, sonnet for complex) | 40-60% overall             | Medium                        |
| Response caching (identical portfolio questions)            | 10-20% overall             | Low (Redis key by query hash) |
| Market data cache (already partially in place)              | 5-10% via fewer tool calls | Already started               |
| Prompt compression (shorter system prompt)                  | 5-15% on input tokens      | Low                           |
| Query deduplication (concurrent identical requests)         | 2-5%                       | Low                           |
| Streaming with early cancel (user navigates away)           | 5-10%                      | Medium                        |

### Hybrid Model Routing (Recommended)

Route simple queries (single-tool, FAQ-like) to Haiku, complex queries (multi-tool, analysis) to Sonnet:

|   Users | Haiku Queries (70%) | Sonnet Queries (30%) | Monthly Cost | Savings vs All-Sonnet |
| ------: | ------------------: | -------------------: | -----------: | --------------------: |
|     100 |               6,300 |                2,700 |       $35.90 |                   64% |
|   1,000 |              63,000 |               27,000 |      $359.00 |                   64% |
|  10,000 |             630,000 |              270,000 |    $3,590.00 |                   64% |
| 100,000 |           6,300,000 |            2,700,000 |   $35,900.00 |                   64% |

## Production Guardrails (Cost Controls)

### Already Implemented

| Guardrail          | Limit                          | Source                                              |
| ------------------ | ------------------------------ | --------------------------------------------------- |
| Per-query cost cap | $1.00                          | `CostLimiter` → `COST_LIMIT_USD` in `ai.service.ts` |
| Circuit breaker    | 3 same-action repetitions      | `CircuitBreaker`                                    |
| Max iterations     | 10 steps per query             | `MAX_ITERATIONS`                                    |
| Timeout            | 45 seconds                     | `TIMEOUT_MS`                                        |
| Token tracking     | Per-query via `estimateCost()` | `agent-metrics.schema.ts`                           |

## Monitoring & Alerting Thresholds

Every query logs to **Braintrust**:

- Input/output token counts
- Estimated USD cost
- Model used
- Latency
- Tool calls and durations

Source: `apps/api/src/app/endpoints/ai/telemetry/braintrust-telemetry.service.ts`

### Recommended Alerting Thresholds

| Metric                        | Warning | Critical          |
| ----------------------------- | ------- | ----------------- |
| Daily LLM spend               | >$50    | >$200             |
| Single query cost             | >$0.50  | $1.00 (guardrail) |
| Avg query cost (1h window)    | >$0.05  | >$0.10            |
| Error rate                    | >5%     | >15%              |
| Circuit breaker triggers/hour | >10     | >50               |

## Break-Even Analysis

At **$5/user/month** subscription price (common SaaS tier):

- AI cost/user (Sonnet) = ~$1.01/mo → **20% of subscription revenue**
- AI cost/user (Hybrid) = ~$0.36/mo → **7% of subscription revenue** ✅

| Premium Price | AI Cost % (Sonnet) | AI Cost % (Hybrid) |
| ------------- | ------------------ | ------------------ |
| $1/month      | ~101%              | ~36%               |
| $3/month      | ~34%               | ~12%               |
| $5/month      | ~20%               | ~7%                |
| $10/month     | ~10%               | ~4%                |

## Infrastructure Costs (Non-LLM)

| Component                | Monthly Cost    | Notes                     |
| ------------------------ | --------------- | ------------------------- |
| Railway (API + DB)       | ~$20–50         | Current hosting plan      |
| PostgreSQL (Railway)     | Included        | Bundled with Railway plan |
| OpenRouter API           | Pay-per-use     | See LLM costs above       |
| Braintrust (telemetry)   | Free tier / ~$0 | Logging + eval platform   |
| **Total infrastructure** | **~$20–50**     | Excludes LLM costs        |

## Notes

- Projections assume uniform daily usage. Real usage will be bursty.
- Tool call rate of 70% means 30% of queries are answered without tools (general questions).
- Verification overhead applies to the 15% of queries where groundedness checks add extra context.
- These are LLM API costs only. Infrastructure (Railway, Postgres, Redis) adds ~$20-50/mo fixed.
- Cost per query will decrease as caching layers are added.
- The `$1/query` guardrail (`COST_LIMIT_USD` in `ai.service.ts` line 87) prevents bill explosions.

## Key Source Files

| File                                                                      | Purpose                            |
| ------------------------------------------------------------------------- | ---------------------------------- |
| `apps/api/src/app/import-auditor/schemas/agent-metrics.schema.ts`         | `MODEL_PRICING`, `estimateCost()`  |
| `apps/api/src/app/import-auditor/guardrails/cost-limiter.ts`              | Per-query $1.00 cap                |
| `apps/api/src/app/endpoints/ai/ai.service.ts`                             | Guardrail constants, cost tracking |
| `apps/api/src/app/endpoints/ai/telemetry/braintrust-telemetry.service.ts` | Cost logging per query             |

## Verification

Run the projection script:

```bash
npx ts-node apps/api/src/app/endpoints/ai/telemetry/cost-projections.ts
```

Or run the snapshot test:

```bash
npx nx test api --testPathPatterns="ai-compliance" --skipNxCache
```

_Updated: 2026-03-02_
