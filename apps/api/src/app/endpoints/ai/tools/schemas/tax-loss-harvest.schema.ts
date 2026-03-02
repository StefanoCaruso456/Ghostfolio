import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────
export const TaxLossHarvestInputSchema = z.object({
  minLoss: z
    .number()
    .positive()
    .optional()
    .describe(
      'Minimum unrealized loss threshold (absolute $) to include. Default $100.'
    ),
  taxBracketPct: z
    .number()
    .min(0)
    .max(50)
    .optional()
    .describe(
      'Federal tax bracket percentage for estimating tax savings (default 24%)'
    )
});

export type TaxLossHarvestInput = z.infer<typeof TaxLossHarvestInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────
export const TaxLossHarvestCandidateSchema = z.object({
  symbol: z.string(),
  name: z.string().nullable(),
  quantity: z.number(),
  marketPrice: z.number().nullable(),
  costBasis: z.number(),
  marketValue: z.number().nullable(),
  unrealizedLoss: z.number(),
  unrealizedLossPct: z.number(),
  holdingPeriod: z.enum(['SHORT_TERM', 'LONG_TERM', 'MIXED']),
  washSaleRisk: z.boolean(),
  washSaleDetail: z.string().nullable()
});

export const TaxLossHarvestDataSchema = z.object({
  candidates: z.array(TaxLossHarvestCandidateSchema),
  totalHarvestableShortTerm: z.number(),
  totalHarvestableLongTerm: z.number(),
  totalHarvestable: z.number(),
  potentialTaxSavings: z.number(),
  assumptions: z.array(z.string())
});

export type TaxLossHarvestData = z.infer<typeof TaxLossHarvestDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────
export const TaxLossHarvestOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: TaxLossHarvestDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type TaxLossHarvestOutput = z.infer<typeof TaxLossHarvestOutputSchema>;
