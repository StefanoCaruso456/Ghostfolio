import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';
import { QuoteMetadataSchema } from './quote-metadata.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetPortfolioChartInputSchema = z.object({
  dateRange: z
    .enum(['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '5y', 'max'])
    .default('1y')
    .describe('Date range for chart data. Defaults to 1 year.'),
  maxPoints: z
    .number()
    .max(200)
    .default(100)
    .optional()
    .describe(
      'Maximum chart data points to return (max 200, default 100). Points are evenly sampled from the full series.'
    )
});

export type GetPortfolioChartInput = z.infer<
  typeof GetPortfolioChartInputSchema
>;

// ─── Data ────────────────────────────────────────────────────────────

const ChartPointSchema = z.object({
  date: z.string(),
  netWorth: z.number().nullable(),
  totalInvestment: z.number().nullable(),
  netPerformancePct: z.number().nullable(),
  value: z.number().nullable()
});

const ChartSummarySchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  startValue: z.number().nullable(),
  endValue: z.number().nullable(),
  peakValue: z.number().nullable(),
  peakDate: z.string().nullable(),
  troughValue: z.number().nullable(),
  troughDate: z.string().nullable(),
  totalChangePct: z.number().nullable()
});

export const GetPortfolioChartDataSchema = z.object({
  chart: z.array(ChartPointSchema),
  pointCount: z.number(),
  totalPointsAvailable: z.number(),
  sampled: z.boolean(),
  summary: ChartSummarySchema,
  dateRange: z.string(),
  baseCurrency: z.string()
});

export type GetPortfolioChartData = z.infer<typeof GetPortfolioChartDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetPortfolioChartOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: GetPortfolioChartDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema,
  quoteMetadata: QuoteMetadataSchema
});

export type GetPortfolioChartOutput = z.infer<
  typeof GetPortfolioChartOutputSchema
>;
