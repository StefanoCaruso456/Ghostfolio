import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetTaxLotsInputSchema = z.object({
  symbol: z
    .string()
    .optional()
    .describe('Filter by ticker symbol'),
  status: z
    .enum(['OPEN', 'CLOSED', 'ALL'])
    .optional()
    .default('ALL')
    .describe('Filter by lot status')
});

export type GetTaxLotsInput = z.infer<typeof GetTaxLotsInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

const TaxLotSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  acquiredDate: z.string(),
  quantity: z.number(),
  remainingQuantity: z.number(),
  costBasisPerShare: z.number(),
  costBasis: z.number(),
  holdingPeriod: z.enum(['SHORT_TERM', 'LONG_TERM']),
  status: z.enum(['OPEN', 'CLOSED', 'PARTIAL']),
  gainLoss: z.number().nullable()
});

const TaxLotsSummarySchema = z.object({
  totalOpenLots: z.number(),
  totalClosedLots: z.number(),
  totalCostBasis: z.number(),
  totalUnrealizedGainLoss: z.number().nullable()
});

export const GetTaxLotsDataSchema = z.object({
  lots: z.array(TaxLotSchema),
  summary: TaxLotsSummarySchema
});

export type GetTaxLotsData = z.infer<typeof GetTaxLotsDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetTaxLotsOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: GetTaxLotsDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type GetTaxLotsOutput = z.infer<typeof GetTaxLotsOutputSchema>;
