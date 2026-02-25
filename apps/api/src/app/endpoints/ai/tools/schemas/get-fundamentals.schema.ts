import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetFundamentalsInputSchema = z.object({
  symbol: z.string().describe('Ticker symbol to get fundamentals for')
});

export type GetFundamentalsInput = z.infer<typeof GetFundamentalsInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

export const GetFundamentalsDataSchema = z.object({
  symbol: z.string(),
  marketCap: z.number().nullable(),
  pe: z.number().nullable(),
  forwardPe: z.number().nullable(),
  eps: z.number().nullable(),
  dividendYield: z.number().nullable(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  updatedAt: z.string(),
  source: z.string()
});

export type GetFundamentalsData = z.infer<typeof GetFundamentalsDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetFundamentalsOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: GetFundamentalsDataSchema.optional(),
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

export type GetFundamentalsOutput = z.infer<typeof GetFundamentalsOutputSchema>;
