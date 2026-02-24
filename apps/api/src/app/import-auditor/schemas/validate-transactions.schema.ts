import { z } from 'zod';

import { VerificationResultSchema } from './verification.schema';

export const VALID_ACTIVITY_TYPES = [
  'BUY',
  'SELL',
  'DIVIDEND',
  'FEE',
  'INTEREST',
  'LIABILITY'
] as const;

export const MappedActivitySchema = z.object({
  account: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  dataSource: z.string().optional().nullable(),
  date: z.string().optional().nullable(),
  fee: z.number().optional().nullable(),
  quantity: z.number().optional().nullable(),
  symbol: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  unitPrice: z.number().optional().nullable()
});

export type MappedActivity = z.infer<typeof MappedActivitySchema>;

export const ValidationErrorCodeSchema = z.enum([
  'MISSING_REQUIRED_FIELD',
  'INVALID_TYPE',
  'NEGATIVE_VALUE',
  'INVALID_DATE',
  'FUTURE_DATE',
  'INVALID_CURRENCY',
  'PRICE_QUANTITY_COHERENCE',
  'BATCH_DUPLICATE'
]);

export const ValidationErrorSchema = z.object({
  row: z.number(),
  field: z.string(),
  code: ValidationErrorCodeSchema,
  message: z.string(),
  severity: z.enum(['error', 'warning'])
});

export type ValidationError = z.infer<typeof ValidationErrorSchema>;

export const ValidateTransactionsInputSchema = z.object({
  activities: z
    .array(MappedActivitySchema)
    .min(1)
    .describe('Array of mapped activities to validate')
});

export type ValidateTransactionsInput = z.infer<
  typeof ValidateTransactionsInputSchema
>;

export const ValidateTransactionsDataSchema = z.object({
  validActivities: z.array(MappedActivitySchema),
  errors: z.array(ValidationErrorSchema),
  warnings: z.array(ValidationErrorSchema),
  totalProcessed: z.number(),
  totalValid: z.number(),
  totalErrors: z.number()
});

export const ValidateTransactionsOutputSchema = z.object({
  status: z.enum(['pass', 'fail', 'warnings']),
  data: ValidateTransactionsDataSchema,
  verification: VerificationResultSchema
});

export type ValidateTransactionsOutput = z.infer<
  typeof ValidateTransactionsOutputSchema
>;
