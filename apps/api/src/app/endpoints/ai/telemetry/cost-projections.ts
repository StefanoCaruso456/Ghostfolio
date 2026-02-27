/**
 * Production Cost Projection Calculator
 *
 * Computes monthly cost estimates for AI chat at various user scales.
 * Based on observed MODEL_PRICING and configurable assumptions.
 *
 * Usage:
 *   npx ts-node apps/api/src/app/endpoints/ai/telemetry/cost-projections.ts
 *   — OR —
 *   import { computeCostProjections, formatProjectionsMarkdown } from './cost-projections';
 */
import { MODEL_PRICING } from '../../../import-auditor/schemas/agent-metrics.schema';

// ─── Assumptions (configurable) ───────────────────────────────────────────

export interface CostAssumptions {
  /** Average queries per user per day */
  queriesPerUserPerDay: number;
  /** Average input tokens per query (includes system prompt + history) */
  avgInputTokens: number;
  /** Average output tokens per query */
  avgOutputTokens: number;
  /** Fraction of queries that invoke at least one tool (0–1) */
  toolCallRate: number;
  /** Average number of tool calls per tool-using query */
  avgToolCallsPerQuery: number;
  /** Additional input tokens per tool call (tool result injected into context) */
  tokensPerToolResult: number;
  /** Fraction of queries requiring verification overhead (extra tokens) */
  verificationOverheadRate: number;
  /** Extra tokens for verification pass */
  verificationExtraTokens: number;
  /** Model ID for pricing lookup */
  model: string;
  /** Days in billing month */
  daysPerMonth: number;
}

export const DEFAULT_ASSUMPTIONS: CostAssumptions = {
  queriesPerUserPerDay: 3,
  avgInputTokens: 1200,
  avgOutputTokens: 400,
  toolCallRate: 0.7,
  avgToolCallsPerQuery: 2.1,
  tokensPerToolResult: 350,
  verificationOverheadRate: 0.15,
  verificationExtraTokens: 200,
  model: 'anthropic/claude-sonnet-4',
  daysPerMonth: 30
};

// ─── Projection Engine ───────────────────────────────────────────────────

export interface CostProjectionRow {
  users: number;
  queriesPerMonth: number;
  inputTokensPerMonth: number;
  outputTokensPerMonth: number;
  totalTokensPerMonth: number;
  monthlyCostUsd: number;
  costPerQuery: number;
  costPerUser: number;
}

export function computeCostProjections(
  userCounts: number[],
  assumptions: CostAssumptions = DEFAULT_ASSUMPTIONS
): CostProjectionRow[] {
  const pricing = MODEL_PRICING[assumptions.model] ?? MODEL_PRICING['default'];

  return userCounts.map((users) => {
    const queriesPerMonth =
      users * assumptions.queriesPerUserPerDay * assumptions.daysPerMonth;

    // Base tokens per query
    let avgInputPerQuery = assumptions.avgInputTokens;

    // Add tool result tokens for queries that use tools
    avgInputPerQuery +=
      assumptions.toolCallRate *
      assumptions.avgToolCallsPerQuery *
      assumptions.tokensPerToolResult;

    // Add verification overhead
    avgInputPerQuery +=
      assumptions.verificationOverheadRate *
      assumptions.verificationExtraTokens;

    const inputTokensPerMonth = queriesPerMonth * avgInputPerQuery;
    const outputTokensPerMonth = queriesPerMonth * assumptions.avgOutputTokens;
    const totalTokensPerMonth = inputTokensPerMonth + outputTokensPerMonth;

    const monthlyCostUsd =
      (inputTokensPerMonth / 1000) * pricing.promptPer1k +
      (outputTokensPerMonth / 1000) * pricing.completionPer1k;

    return {
      users,
      queriesPerMonth,
      inputTokensPerMonth: Math.round(inputTokensPerMonth),
      outputTokensPerMonth: Math.round(outputTokensPerMonth),
      totalTokensPerMonth: Math.round(totalTokensPerMonth),
      monthlyCostUsd: Math.round(monthlyCostUsd * 100) / 100,
      costPerQuery:
        queriesPerMonth > 0
          ? Math.round((monthlyCostUsd / queriesPerMonth) * 10000) / 10000
          : 0,
      costPerUser:
        users > 0 ? Math.round((monthlyCostUsd / users) * 100) / 100 : 0
    };
  });
}

// ─── Markdown Formatter ──────────────────────────────────────────────────

export function formatProjectionsMarkdown(
  rows: CostProjectionRow[],
  assumptions: CostAssumptions = DEFAULT_ASSUMPTIONS
): string {
  const lines: string[] = [
    '# AI Chat Production Cost Projections',
    '',
    '## Assumptions',
    '',
    `| Parameter | Value |`,
    `|---|---|`,
    `| Model | \`${assumptions.model}\` |`,
    `| Queries/user/day | ${assumptions.queriesPerUserPerDay} |`,
    `| Avg input tokens/query | ${assumptions.avgInputTokens} |`,
    `| Avg output tokens/query | ${assumptions.avgOutputTokens} |`,
    `| Tool call rate | ${(assumptions.toolCallRate * 100).toFixed(0)}% |`,
    `| Avg tool calls/query | ${assumptions.avgToolCallsPerQuery} |`,
    `| Tokens per tool result | ${assumptions.tokensPerToolResult} |`,
    `| Verification overhead rate | ${(assumptions.verificationOverheadRate * 100).toFixed(0)}% |`,
    `| Verification extra tokens | ${assumptions.verificationExtraTokens} |`,
    `| Days/month | ${assumptions.daysPerMonth} |`,
    '',
    '## Cost Projections',
    '',
    '| Users | Queries/mo | Input Tokens/mo | Output Tokens/mo | Monthly Cost | $/query | $/user/mo |',
    '|------:|-----------:|----------------:|-----------------:|-------------:|--------:|----------:|'
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.users.toLocaleString()} | ${row.queriesPerMonth.toLocaleString()} | ${row.inputTokensPerMonth.toLocaleString()} | ${row.outputTokensPerMonth.toLocaleString()} | $${row.monthlyCostUsd.toLocaleString()} | $${row.costPerQuery.toFixed(4)} | $${row.costPerUser.toFixed(2)} |`
    );
  }

  const pricing = MODEL_PRICING[assumptions.model] ?? MODEL_PRICING['default'];

  lines.push(
    '',
    '## Pricing Reference',
    '',
    `- **Prompt**: $${pricing.promptPer1k}/1K tokens`,
    `- **Completion**: $${pricing.completionPer1k}/1K tokens`,
    `- Source: \`MODEL_PRICING\` in \`apps/api/src/app/import-auditor/schemas/agent-metrics.schema.ts\``,
    '',
    '## Notes',
    '',
    '- Projections assume uniform daily usage. Real usage will be bursty.',
    '- Tool call rate of 70% means 30% of queries are answered without tools (general questions).',
    '- Verification overhead applies to the 15% of queries where groundedness checks add extra context.',
    '- These are LLM API costs only. Infrastructure (Railway, Postgres, Redis) adds ~$20-50/mo fixed.',
    '- Cost per query will decrease as caching layers are added (response cache, market data cache).',
    '',
    `*Generated: ${new Date().toISOString().split('T')[0]}*`
  );

  return lines.join('\n');
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────

if (require.main === module) {
  const userCounts = [100, 1_000, 10_000, 100_000];
  const rows = computeCostProjections(userCounts);
  const markdown = formatProjectionsMarkdown(rows);

  console.log(markdown);
}
