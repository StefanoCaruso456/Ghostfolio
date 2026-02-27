import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';
import { QuoteMetadataSchema } from './quote-metadata.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const ScenarioImpactInputSchema = z.object({
  shocks: z
    .array(
      z.object({
        symbolOrBucket: z
          .string()
          .describe(
            'Symbol (e.g. "NVDA") or bucket name (e.g. "Technology", "Equity")'
          ),
        shockPct: z
          .number()
          .describe('Percentage shock to apply (e.g. -20 for a 20% drop)')
      })
    )
    .min(1)
    .max(20)
    .describe('List of shocks to simulate'),
  horizon: z
    .enum(['1d', '1wk', '1mo'])
    .default('1d')
    .describe('Label for the time horizon (informational only)'),
  assumeCashStable: z
    .boolean()
    .default(true)
    .describe('Assume cash positions are not affected by shocks')
});

export type ScenarioImpactInput = z.infer<typeof ScenarioImpactInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

const BucketImpactSchema = z.object({
  name: z.string(),
  currentPct: z.number(),
  shockPct: z.number(),
  impactOnPortfolioPct: z.number()
});

export const ScenarioImpactDataSchema = z.object({
  estimatedPortfolioImpactPct: z.number(),
  estimatedImpactByBucket: z.array(BucketImpactSchema),
  assumptions: z.array(z.string()),
  missingMappings: z.array(z.string()),
  horizon: z.string()
});

export type ScenarioImpactData = z.infer<typeof ScenarioImpactDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const ScenarioImpactOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: ScenarioImpactDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema,
  quoteMetadata: QuoteMetadataSchema,
  meta: z
    .object({
      schemaVersion: z.string(),
      source: z.string(),
      cacheHit: z.boolean().optional(),
      providerLatencyMs: z.number().optional()
    })
    .optional()
});

export type ScenarioImpactOutput = z.infer<typeof ScenarioImpactOutputSchema>;
