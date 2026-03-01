import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetTaxHoldingsInputSchema = z.object({
  accountId: z
    .string()
    .optional()
    .describe('Filter by account ID'),
  symbol: z
    .string()
    .optional()
    .describe('Filter by ticker symbol')
});

export type GetTaxHoldingsInput = z.infer<typeof GetTaxHoldingsInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

const TaxHoldingSchema = z.object({
  symbol: z.string(),
  name: z.string().nullable(),
  quantity: z.number(),
  marketPrice: z.number().nullable(),
  marketValue: z.number().nullable(),
  costBasis: z.number(),
  unrealizedGainLoss: z.number().nullable(),
  unrealizedGainLossPct: z.number().nullable(),
  currency: z.string(),
  accountName: z.string().nullable(),
  dataSource: z.string()
});

export const GetTaxHoldingsDataSchema = z.object({
  holdings: z.array(TaxHoldingSchema),
  totalMarketValue: z.number().nullable(),
  totalCostBasis: z.number(),
  totalUnrealizedGainLoss: z.number().nullable()
});

export type GetTaxHoldingsData = z.infer<typeof GetTaxHoldingsDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetTaxHoldingsOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: GetTaxHoldingsDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type GetTaxHoldingsOutput = z.infer<typeof GetTaxHoldingsOutputSchema>;
