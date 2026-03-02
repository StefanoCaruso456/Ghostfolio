import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetDividendSummaryInputSchema = z.object({
  year: z
    .number()
    .optional()
    .describe(
      'Filter dividends to a specific year (e.g. 2024). If omitted, all years are included.'
    ),
  symbol: z
    .string()
    .optional()
    .describe('Filter dividends for a specific ticker symbol'),
  groupBy: z
    .enum(['month', 'year'])
    .optional()
    .describe(
      'Group dividend totals by month or year. If omitted, returns individual events.'
    )
});

export type GetDividendSummaryInput = z.infer<
  typeof GetDividendSummaryInputSchema
>;

// ─── Data ────────────────────────────────────────────────────────────

const DividendBySymbolSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  totalDividend: z.number(),
  currency: z.string(),
  eventCount: z.number()
});

const DividendByPeriodSchema = z.object({
  period: z.string(),
  totalDividend: z.number()
});

const RecentDividendEventSchema = z.object({
  date: z.string(),
  symbol: z.string(),
  name: z.string(),
  amount: z.number(),
  currency: z.string()
});

export const GetDividendSummaryDataSchema = z.object({
  totalDividendInBaseCurrency: z.number(),
  baseCurrency: z.string(),
  dividendsBySymbol: z.array(DividendBySymbolSchema),
  dividendsByPeriod: z.array(DividendByPeriodSchema).nullable(),
  recentDividends: z.array(RecentDividendEventSchema),
  symbolCount: z.number(),
  eventCount: z.number(),
  dateRange: z.object({
    from: z.string().nullable(),
    to: z.string().nullable()
  })
});

export type GetDividendSummaryData = z.infer<
  typeof GetDividendSummaryDataSchema
>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetDividendSummaryOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: GetDividendSummaryDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type GetDividendSummaryOutput = z.infer<
  typeof GetDividendSummaryOutputSchema
>;
