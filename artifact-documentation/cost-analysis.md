# AI Chat Production Cost Projections

## Assumptions

| Parameter | Value |
|---|---|
| Model | `anthropic/claude-sonnet-4` |
| Queries/user/day | 3 |
| Avg input tokens/query | 1,200 |
| Avg output tokens/query | 400 |
| Tool call rate | 70% |
| Avg tool calls/query | 2.1 |
| Tokens per tool result | 350 |
| Verification overhead rate | 15% |
| Verification extra tokens | 200 |
| Days/month | 30 |

### Derivation

- **Effective input tokens/query** = 1,200 base + (0.70 × 2.1 × 350 tool tokens) + (0.15 × 200 verification) = 1,200 + 514.5 + 30 = **1,744.5 tokens**
- **Effective output tokens/query** = **400 tokens** (unchanged)
- **Pricing**: Prompt $0.003/1K, Completion $0.015/1K (from `MODEL_PRICING['anthropic/claude-sonnet-4']`)
- **Cost/query** = (1,744.5/1000 × $0.003) + (400/1000 × $0.015) = $0.005234 + $0.006 = **~$0.0112/query**

## Cost Projections

| Users | Queries/mo | Input Tokens/mo | Output Tokens/mo | Monthly Cost | $/query | $/user/mo |
|------:|-----------:|----------------:|-----------------:|-------------:|--------:|----------:|
| 100 | 9,000 | 15,700,500 | 3,600,000 | $101.10 | $0.0112 | $1.01 |
| 1,000 | 90,000 | 157,005,000 | 36,000,000 | $1,011.02 | $0.0112 | $1.01 |
| 10,000 | 900,000 | 1,570,050,000 | 360,000,000 | $10,110.15 | $0.0112 | $1.01 |
| 100,000 | 9,000,000 | 15,700,500,000 | 3,600,000,000 | $101,101.50 | $0.0112 | $1.01 |

## Pricing Reference

- **Prompt**: $0.003/1K tokens
- **Completion**: $0.015/1K tokens
- Source: `MODEL_PRICING` in `apps/api/src/app/import-auditor/schemas/agent-metrics.schema.ts`

## Cost Reduction Strategies

| Strategy | Estimated Savings | Implementation Effort |
|---|---|---|
| Switch to `openai/gpt-4o-mini` for simple queries | 80-90% on those queries | Medium (query classifier) |
| Response caching (identical portfolio questions) | 10-20% overall | Low (Redis key by query hash) |
| Market data cache (already partially in place) | 5-10% via fewer tool calls | Already started |
| Prompt compression (shorter system prompt) | 5-15% on input tokens | Low |
| Tiered model routing (haiku for simple, sonnet for complex) | 40-60% overall | Medium |

## Break-Even Analysis

At **$5/user/month** subscription price (common SaaS tier):
- AI cost/user = ~$1.01/mo → **20% of subscription revenue**
- With tiered routing: ~$0.50/mo → **10% of subscription revenue** ✅

## Notes

- Projections assume uniform daily usage. Real usage will be bursty.
- Tool call rate of 70% means 30% of queries are answered without tools (general questions).
- Verification overhead applies to the 15% of queries where groundedness checks add extra context.
- These are LLM API costs only. Infrastructure (Railway, Postgres, Redis) adds ~$20-50/mo fixed.
- Cost per query will decrease as caching layers are added.
- The `$1/query` guardrail (`COST_LIMIT_USD` in `ai.service.ts` line 87) prevents bill explosions.

## Verification

Run the projection script:
```bash
npx ts-node apps/api/src/app/endpoints/ai/telemetry/cost-projections.ts
```

Or run the snapshot test:
```bash
npx nx test api --testPathPatterns="ai-compliance" --skipNxCache
```

*Generated: 2026-02-26*
