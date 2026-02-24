import { z } from 'zod';

import { ActivityImportDTOSchema } from './activity-import-dto.schema';
import { MappedActivitySchema } from './validate-transactions.schema';
import { VerificationResultSchema } from './verification.schema';

/**
 * Tool 6: Normalize to ActivityImportDTO
 *
 * Input/output schemas for the normalization layer that sits between
 * validateTransactions and generateImportPreview.
 */

export const NormalizeActivitiesInputSchema = z.object({
  activities: z
    .array(MappedActivitySchema)
    .min(1)
    .describe('Validated activities to normalize into import DTO format'),
  accountId: z
    .string()
    .optional()
    .describe('Optional account ID to inject into all activities')
});

export type NormalizeActivitiesInput = z.infer<
  typeof NormalizeActivitiesInputSchema
>;

export const NormalizationErrorSchema = z.object({
  row: z.number(),
  field: z.string(),
  message: z.string()
});

export const NormalizeActivitiesDataSchema = z.object({
  dtos: z.array(ActivityImportDTOSchema),
  normalizationErrors: z.array(NormalizationErrorSchema),
  totalInput: z.number(),
  totalNormalized: z.number(),
  totalFailed: z.number()
});

export const NormalizeActivitiesOutputSchema = z.object({
  status: z.enum(['success', 'partial', 'error']),
  data: NormalizeActivitiesDataSchema,
  verification: VerificationResultSchema
});

export type NormalizeActivitiesOutput = z.infer<
  typeof NormalizeActivitiesOutputSchema
>;
