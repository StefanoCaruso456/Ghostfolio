import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetHistoryInputSchema = z.object({
  symbol: z.string().describe('Ticker symbol to get history for'),
  range: z
    .enum(['5d', '1mo', '3mo', '6mo', '1y', '5y'])
    .describe('Time range for historical data'),
  interval: z
    .enum(['1d', '1wk'])
    .default('1d')
    .describe('Data interval (default: 1d)'),
  includeReturns: z
    .boolean()
    .default(false)
    .describe('Whether to compute period returns from the price series')
});

export type GetHistoryInput = z.infer<typeof GetHistoryInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

const HistoryPointSchema = z.object({
  date: z.string(),
  close: z.number(),
  volume: z.number().nullable()
});

const ReturnsSummarySchema = z.object({
  totalReturnPct: z.number(),
  maxDrawdownPct: z.number(),
  volatilityPct: z.number().nullable(),
  periodHigh: z.number(),
  periodLow: z.number()
});

export const GetHistoryDataSchema = z.object({
  symbol: z.string(),
  points: z.array(HistoryPointSchema),
  pointCount: z.number(),
  truncated: z.boolean(),
  range: z.string(),
  interval: z.string(),
  returns: ReturnsSummarySchema.nullable()
});

export type GetHistoryData = z.infer<typeof GetHistoryDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetHistoryOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: GetHistoryDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema,
  meta: z
    .object({
      schemaVersion: z.string(),
      source: z.string(),
      cacheHit: z.boolean().optional(),
      providerLatencyMs: z.number().optional()
    })
    .optional()
});

export type GetHistoryOutput = z.infer<typeof GetHistoryOutputSchema>;
