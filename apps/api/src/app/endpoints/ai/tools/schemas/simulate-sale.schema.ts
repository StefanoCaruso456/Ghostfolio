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
      'Federal tax bracket percentage for short-term gains (default 24%)'
    )
});

export type SimulateSaleInput = z.infer<typeof SimulateSaleInputSchema>;

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

export const SimulateSaleSummarySchema = z.object({
  totalCostBasis: z.number(),
  totalProceeds: z.number(),
  totalGainLoss: z.number(),
  shortTermGain: z.number(),
  longTermGain: z.number(),
  estimatedFederalTax: z.number(),
  effectiveTaxRate: z.number(),
  shortTermTaxRate: z.number(),
  longTermTaxRate: z.number(),
  currency: z.string()
});

export const SimulateSaleDataSchema = z.object({
  lotsConsumed: z.array(SimulateSaleLotSchema),
  summary: SimulateSaleSummarySchema,
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
