import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetPerformanceInputSchema = z.object({
  dateRange: z
    .enum(['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y', 'max'])
    .default('max')
    .describe(
      'Date range for performance calculation. Defaults to max (all time).'
    )
});

export type GetPerformanceInput = z.infer<typeof GetPerformanceInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

export const PerformanceDataSchema = z.object({
  currentNetWorth: z.number().nullable(),
  currentValueInBaseCurrency: z.number(),
  totalInvestment: z.number(),
  netPerformance: z.number(),
  netPerformancePct: z.number(),
  netPerformanceWithCurrencyEffect: z.number(),
  netPerformancePctWithCurrencyEffect: z.number(),
  annualizedPerformancePct: z.number().nullable(),
  firstOrderDate: z.string().nullable(),
  dateRange: z.string(),
  baseCurrency: z.string()
});

export type PerformanceData = z.infer<typeof PerformanceDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetPerformanceOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: PerformanceDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type GetPerformanceOutput = z.infer<typeof GetPerformanceOutputSchema>;
