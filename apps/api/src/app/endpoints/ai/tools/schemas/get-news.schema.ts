import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetNewsInputSchema = z.object({
  symbol: z.string().describe('Ticker symbol to get news for'),
  limit: z
    .number()
    .min(1)
    .max(10)
    .default(5)
    .describe('Maximum number of news items to return (1–10)'),
  recencyDays: z
    .number()
    .min(1)
    .max(30)
    .default(7)
    .describe('Only return news from the last N days (1–30)')
});

export type GetNewsInput = z.infer<typeof GetNewsInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

const NewsItemSchema = z.object({
  title: z.string(),
  publisher: z.string().nullable(),
  url: z.string().nullable(),
  publishedAt: z.string(),
  source: z.string()
});

export const GetNewsDataSchema = z.object({
  symbol: z.string(),
  items: z.array(NewsItemSchema),
  returnedCount: z.number(),
  recencyDays: z.number()
});

export type GetNewsData = z.infer<typeof GetNewsDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetNewsOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: GetNewsDataSchema.optional(),
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

export type GetNewsOutput = z.infer<typeof GetNewsOutputSchema>;
