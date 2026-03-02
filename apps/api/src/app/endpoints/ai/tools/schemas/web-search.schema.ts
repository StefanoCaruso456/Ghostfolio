import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const WebSearchInputSchema = z.object({
  query: z
    .string()
    .describe(
      'The search query. Be specific and include relevant context (e.g. "AAPL Q4 2024 earnings results" instead of just "AAPL earnings").'
    ),
  maxResults: z
    .number()
    .min(1)
    .max(10)
    .optional()
    .describe(
      'Number of results to return (1-10). Default is 5. Use fewer for simple fact lookups, more for research.'
    ),
  topic: z
    .enum(['general', 'news'])
    .optional()
    .describe(
      'Search topic. Use "news" for current events and time-sensitive queries, "general" for everything else. Default is "general".'
    ),
  timeRange: z
    .enum(['day', 'week', 'month', 'year'])
    .optional()
    .describe(
      'Filter results by recency. Use "day" for breaking news, "week" for recent events, etc. Omit for all-time results.'
    )
});

export type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

const WebSearchResultItemSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  score: z.number()
});

export const WebSearchDataSchema = z.object({
  query: z.string(),
  answer: z.string().nullable(),
  results: z.array(WebSearchResultItemSchema),
  resultCount: z.number(),
  responseTimeMs: z.number()
});

export type WebSearchData = z.infer<typeof WebSearchDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const WebSearchOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: WebSearchDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type WebSearchOutput = z.infer<typeof WebSearchOutputSchema>;
