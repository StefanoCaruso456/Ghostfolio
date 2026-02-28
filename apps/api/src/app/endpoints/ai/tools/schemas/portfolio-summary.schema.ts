import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';
import { QuoteMetadataSchema } from './quote-metadata.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetPortfolioSummaryInputSchema = z.object({
  userCurrency: z
    .string()
    .describe('Base currency of the user (e.g. USD, EUR, CHF)')
});

export type GetPortfolioSummaryInput = z.infer<
  typeof GetPortfolioSummaryInputSchema
>;

// ─── Data ────────────────────────────────────────────────────────────

const HoldingSummarySchema = z.object({
  name: z.string(),
  symbol: z.string(),
  allocationPct: z.number(),
  currency: z.string(),
  assetClass: z.string().nullable(),
  assetSubClass: z.string().nullable()
});

export const PortfolioSummaryDataSchema = z.object({
  holdingsCount: z.number(),
  cashPct: z.number().nullable(),
  investedPct: z.number().nullable(),
  topHoldingsByAllocation: z.array(HoldingSummarySchema),
  accountsCount: z.number(),
  baseCurrency: z.string()
});

export type PortfolioSummaryData = z.infer<typeof PortfolioSummaryDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetPortfolioSummaryOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: PortfolioSummaryDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema,
  quoteMetadata: QuoteMetadataSchema
});

export type GetPortfolioSummaryOutput = z.infer<
  typeof GetPortfolioSummaryOutputSchema
>;
