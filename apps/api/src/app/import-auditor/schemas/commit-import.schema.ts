import { z } from 'zod';

import { MappedActivitySchema } from './validate-transactions.schema';
import { VerificationResultSchema } from './verification.schema';

export const CommitImportInputSchema = z.object({
  activities: z.array(MappedActivitySchema).min(1),
  isDryRun: z.boolean().default(false)
});

export type CommitImportInput = z.infer<typeof CommitImportInputSchema>;

export const CommitImportErrorSchema = z.object({
  row: z.number(),
  message: z.string()
});

export const CommitImportDataSchema = z.object({
  importedCount: z.number(),
  skippedCount: z.number(),
  errors: z.array(CommitImportErrorSchema),
  isDryRun: z.boolean()
});

export const CommitImportOutputSchema = z.object({
  status: z.enum(['success', 'partial', 'error']),
  data: CommitImportDataSchema,
  verification: VerificationResultSchema
});

export type CommitImportOutput = z.infer<typeof CommitImportOutputSchema>;
