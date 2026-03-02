import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';
import { TaxSummarySchema } from './simulate-sale.schema';

// ─── Input ───────────────────────────────────────────────────────────
export const PortfolioLiquidationInputSchema = z.object({
  taxBracketPct: z
    .number()
    .min(0)
    .max(50)
    .optional()
    .describe(
      'Federal tax bracket percentage for short-term gains (ordinary income rate). Default 24%.'
    ),
  longTermBracketPct: z
    .number()
    .min(0)
    .max(20)
    .optional()
    .describe(
      'Federal long-term capital gains rate: 0% (income ≤$47K), 15% (≤$518K), 20% (>$518K). Default 15%.'
    ),
  stateTaxPct: z
    .number()
    .min(0)
    .max(15)
    .optional()
    .describe(
      'State income tax rate percentage (e.g. 13.3 for California, 0 for Texas/Florida). Default 0.'
    ),
  includeNIIT: z
    .boolean()
    .optional()
    .describe(
      'Include 3.8% Net Investment Income Tax (NIIT). Default true for HNW.'
    ),
  topN: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'Limit to top N holdings by market value. Omit for full liquidation.'
    )
});

export type PortfolioLiquidationInput = z.infer<
  typeof PortfolioLiquidationInputSchema
>;

// ─── Data ────────────────────────────────────────────────────────────
export const LiquidationHoldingSchema = z.object({
  symbol: z.string(),
  name: z.string().nullable(),
  quantity: z.number(),
  marketPrice: z.number(),
  totalProceeds: z.number(),
  totalCostBasis: z.number(),
  gainLoss: z.number(),
  shortTermGain: z.number(),
  longTermGain: z.number(),
  estimatedTax: z.number()
});

export const PortfolioLiquidationDataSchema = z.object({
  holdings: z.array(LiquidationHoldingSchema),
  summary: TaxSummarySchema,
  assumptions: z.array(z.string()),
  holdingsCount: z.number()
});

export type PortfolioLiquidationData = z.infer<
  typeof PortfolioLiquidationDataSchema
>;

// ─── Output ──────────────────────────────────────────────────────────
export const PortfolioLiquidationOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: PortfolioLiquidationDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type PortfolioLiquidationOutput = z.infer<
  typeof PortfolioLiquidationOutputSchema
>;
