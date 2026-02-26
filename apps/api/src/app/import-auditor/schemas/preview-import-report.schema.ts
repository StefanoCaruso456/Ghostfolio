import { z } from 'zod';

import { MappedActivitySchema } from './validate-transactions.schema';
import { VerificationResultSchema } from './verification.schema';

export const PreviewImportReportInputSchema = z.object({
  activities: z.array(MappedActivitySchema).min(1),
  warningsCount: z.number().default(0),
  errorsCount: z.number().default(0)
});

export type PreviewImportReportInput = z.infer<
  typeof PreviewImportReportInputSchema
>;

export const TypeBreakdownSchema = z.object({
  type: z.string(),
  count: z.number(),
  estimatedValue: z.number()
});

export const PreviewImportReportDataSchema = z.object({
  totalCount: z.number(),
  typeBreakdown: z.array(TypeBreakdownSchema),
  dateRange: z.object({
    earliest: z.string(),
    latest: z.string()
  }),
  currencies: z.array(z.string()),
  estimatedTotalValue: z.number(),
  warningsCount: z.number(),
  errorsCount: z.number(),
  summary: z.string()
});

export const PreviewImportReportOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: PreviewImportReportDataSchema,
  verification: VerificationResultSchema
});

export type PreviewImportReportOutput = z.infer<
  typeof PreviewImportReportOutputSchema
>;
