import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────
export const SimulateSaleInputSchema = z.object({
  symbol: z.string().describe('Ticker symbol to simulate selling'),
  quantity: z.number().positive().describe('Number of shares to sell'),
  pricePerShare: z
    .number()
    .positive()
    .optional()
    .describe('Sale price per share (uses current market price if omitted)'),
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
      'Include 3.8% Net Investment Income Tax (NIIT) for AGI > $200K/$250K. Default true for HNW.'
    )
});

export type SimulateSaleInput = z.infer<typeof SimulateSaleInputSchema>;

// ─── Shared Summary Schema ──────────────────────────────────────────
export const TaxSummarySchema = z.object({
  totalCostBasis: z.number(),
  totalProceeds: z.number(),
  totalGainLoss: z.number(),
  shortTermGain: z.number(),
  longTermGain: z.number(),
  estimatedFederalTax: z.number(),
  estimatedStateTax: z.number(),
  estimatedNIIT: z.number(),
  estimatedTotalTax: z.number(),
  effectiveTaxRate: z.number(),
  shortTermTaxRate: z.number(),
  longTermTaxRate: z.number(),
  stateTaxRate: z.number(),
  niitRate: z.number(),
  currency: z.string()
});

// ─── Data ────────────────────────────────────────────────────────────
export const SimulateSaleLotSchema = z.object({
  lotId: z.string(),
  acquiredDate: z.string(),
  quantityFromLot: z.number(),
  costBasisPerShare: z.number(),
  costBasis: z.number(),
  proceeds: z.number(),
  gainLoss: z.number(),
  holdingPeriod: z.enum(['SHORT_TERM', 'LONG_TERM'])
});

export const SimulateSaleDataSchema = z.object({
  lotsConsumed: z.array(SimulateSaleLotSchema),
  summary: TaxSummarySchema,
  assumptions: z.array(z.string())
});

export type SimulateSaleData = z.infer<typeof SimulateSaleDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────
export const SimulateSaleOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: SimulateSaleDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type SimulateSaleOutput = z.infer<typeof SimulateSaleOutputSchema>;
