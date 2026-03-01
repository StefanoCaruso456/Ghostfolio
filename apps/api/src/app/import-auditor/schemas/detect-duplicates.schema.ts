import { z } from 'zod';

import { MappedActivitySchema } from './validate-transactions.schema';
import { VerificationResultSchema } from './verification.schema';

export const ExistingActivitySchema = z.object({
  accountId: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  dataSource: z.string().optional().nullable(),
  date: z.string(),
  fee: z.number().optional().nullable(),
  quantity: z.number().optional().nullable(),
  symbol: z.string(),
  type: z.string(),
  unitPrice: z.number().optional().nullable()
});

export type ExistingActivity = z.infer<typeof ExistingActivitySchema>;

export const DuplicatePairSchema = z.object({
  csvRowIndex: z.number(),
  matchType: z.enum(['batch', 'database']),
  matchedWith: z.union([
    z.object({ csvRowIndex: z.number() }),
    z.object({ existingActivityIndex: z.number() })
  ]),
  confidence: z.number().min(0).max(1),
  compositeKey: z.string()
});

export type DuplicatePair = z.infer<typeof DuplicatePairSchema>;

export const DetectDuplicatesInputSchema = z.object({
  activities: z.array(MappedActivitySchema).min(1),
  existingActivities: z.array(ExistingActivitySchema).optional().default([])
});

export type DetectDuplicatesInput = z.infer<typeof DetectDuplicatesInputSchema>;

export const DetectDuplicatesDataSchema = z.object({
  duplicates: z.array(DuplicatePairSchema),
  cleanActivities: z.array(MappedActivitySchema),
  totalChecked: z.number(),
  batchDuplicatesFound: z.number(),
  databaseDuplicatesFound: z.number()
});

export const DetectDuplicatesOutputSchema = z.object({
  status: z.enum(['clean', 'duplicates_found', 'error']),
  data: DetectDuplicatesDataSchema,
  verification: VerificationResultSchema
});

export type DetectDuplicatesOutput = z.infer<
  typeof DetectDuplicatesOutputSchema
>;
