import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetQuoteInputSchema = z.object({
  symbols: z
    .array(z.string())
    .min(1)
    .max(25)
    .describe('Ticker symbols to quote (1–25)'),
  assetType: z
    .enum(['stock', 'etf', 'crypto', 'fx'])
    .optional()
    .describe('Optional asset type hint for provider routing'),
  quoteCurrency: z
    .string()
    .optional()
    .describe('Optional currency to express prices in')
});

export type GetQuoteInput = z.infer<typeof GetQuoteInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

const QuoteItemSchema = z.object({
  symbol: z.string(),
  name: z.string().nullable(),
  price: z.number(),
  currency: z.string(),
  dayChangeAbs: z.number().nullable(),
  dayChangePct: z.number().nullable(),
  asOf: z.string(),
  source: z.string()
});

const QuoteErrorSchema = z.object({
  symbol: z.string(),
  error: z.string()
});

export const GetQuoteDataSchema = z.object({
  quotes: z.array(QuoteItemSchema),
  errors: z.array(QuoteErrorSchema),
  requestedCount: z.number(),
  returnedCount: z.number()
});

export type GetQuoteData = z.infer<typeof GetQuoteDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetQuoteOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: GetQuoteDataSchema.optional(),
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

export type GetQuoteOutput = z.infer<typeof GetQuoteOutputSchema>;
