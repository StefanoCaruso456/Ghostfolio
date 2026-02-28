import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';
import { QuoteMetadataSchema } from './quote-metadata.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetHoldingDetailInputSchema = z.object({
  symbol: z
    .string()
    .describe(
      'Ticker symbol of the holding to inspect (e.g. AAPL, VWRL.L, BTC)'
    ),
  dataSource: z
    .enum([
      'ALPHA_VANTAGE',
      'COINGECKO',
      'EOD_HISTORICAL_DATA',
      'FINANCIAL_MODELING_PREP',
      'GHOSTFOLIO',
      'GOOGLE_SHEETS',
      'MANUAL',
      'RAPID_API',
      'YAHOO'
    ])
    .optional()
    .describe(
      'Data source for the holding. If omitted, auto-resolved from the portfolio.'
    )
});

export type GetHoldingDetailInput = z.infer<typeof GetHoldingDetailInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

const HistoricalPointSchema = z.object({
  date: z.string(),
  marketPrice: z.number().nullable(),
  averagePrice: z.number().nullable(),
  quantity: z.number().nullable()
});

const PerformanceSummarySchema = z.object({
  grossPerformance: z.number().nullable(),
  grossPerformancePct: z.number().nullable(),
  netPerformance: z.number().nullable(),
  netPerformancePct: z.number().nullable(),
  netPerformanceWithCurrencyEffect: z.number().nullable(),
  netPerformancePctWithCurrencyEffect: z.number().nullable()
});

export const GetHoldingDetailDataSchema = z.object({
  symbol: z.string(),
  name: z.string().nullable(),
  currency: z.string().nullable(),
  assetClass: z.string().nullable(),
  assetSubClass: z.string().nullable(),
  dataSource: z.string(),

  // Position
  quantity: z.number(),
  averagePrice: z.number(),
  marketPrice: z.number(),
  marketPriceMax: z.number(),
  marketPriceMin: z.number(),
  value: z.number(),
  investmentInBaseCurrency: z.number().nullable(),

  // Dates & counts
  dateOfFirstActivity: z.string().nullable(),
  activitiesCount: z.number(),

  // Income & fees
  dividendInBaseCurrency: z.number(),
  dividendYieldPct: z.number().nullable(),
  feeInBaseCurrency: z.number(),

  // Performance
  performance: PerformanceSummarySchema,

  // All-time high
  allTimeHigh: z
    .object({
      date: z.string().nullable(),
      performancePctFromATH: z.number().nullable()
    })
    .nullable(),

  // Historical data (capped to last 90 points)
  historicalData: z.array(HistoricalPointSchema),
  historicalDataPointCount: z.number()
});

export type GetHoldingDetailData = z.infer<typeof GetHoldingDetailDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetHoldingDetailOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: GetHoldingDetailDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema,
  quoteMetadata: QuoteMetadataSchema
});

export type GetHoldingDetailOutput = z.infer<
  typeof GetHoldingDetailOutputSchema
>;
