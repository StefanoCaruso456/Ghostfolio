/**
 * QuoteMetadata — Shared schema for portfolio tool outputs that
 * indicates the freshness of underlying market data.
 *
 * Used for graceful degradation: when live market data is unavailable,
 * portfolio tools return stale/partial data with this metadata.
 */
import { z } from 'zod';

export const QuoteMetadataSchema = z
  .object({
    quoteStatus: z.enum(['fresh', 'stale', 'partial', 'unavailable']),
    quotesAsOf: z.string().nullable().optional(),
    staleSymbolCount: z.number().optional(),
    missingSymbols: z.array(z.string()).optional(),
    message: z.string().optional()
  })
  .optional();

export type QuoteMetadata = z.infer<typeof QuoteMetadataSchema>;
