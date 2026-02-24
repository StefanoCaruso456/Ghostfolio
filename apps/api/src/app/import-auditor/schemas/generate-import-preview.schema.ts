import { z } from 'zod';

import { MappedActivitySchema } from './validate-transactions.schema';
import { VerificationResultSchema } from './verification.schema';

/**
 * Tool 5: Generate Import Preview
 *
 * Purpose: Create a human-readable preview of what the import will produce,
 * including a summary of activities, total value, and any flags.
 * This is the final tool before committing — used for human-in-the-loop.
 */

export const GenerateImportPreviewInputSchema = z.object({
  validActivities: z
    .array(MappedActivitySchema)
    .min(1)
    .describe('Validated activities ready for import'),
  totalErrors: z
    .number()
    .describe('Number of validation errors from previous step'),
  totalWarnings: z
    .number()
    .describe('Number of validation warnings from previous step')
});

export type GenerateImportPreviewInput = z.infer<
  typeof GenerateImportPreviewInputSchema
>;

export const ImportSummarySchema = z.object({
  totalActivities: z.number(),
  byType: z.record(z.number()),
  byCurrency: z.record(z.number()),
  uniqueSymbols: z.array(z.string()),
  dateRange: z.object({
    earliest: z.string(),
    latest: z.string()
  }),
  totalEstimatedValue: z.number(),
  previewTable: z.string()
});

export const GenerateImportPreviewDataSchema = z.object({
  summary: ImportSummarySchema,
  canCommit: z.boolean(),
  commitBlockedReason: z.string().optional(),
  previewErrors: z.number(),
  previewWarnings: z.number()
});

export const GenerateImportPreviewOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: GenerateImportPreviewDataSchema,
  verification: VerificationResultSchema
});

export type GenerateImportPreviewOutput = z.infer<
  typeof GenerateImportPreviewOutputSchema
>;
