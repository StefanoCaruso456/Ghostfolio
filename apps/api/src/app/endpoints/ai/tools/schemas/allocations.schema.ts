import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetAllocationsInputSchema = z.object({
  userCurrency: z
    .string()
    .describe('Base currency of the user (e.g. USD, EUR, CHF)')
});

export type GetAllocationsInput = z.infer<typeof GetAllocationsInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

const AllocationBucketSchema = z.object({
  name: z.string(),
  valuePct: z.number()
});

export const AllocationsDataSchema = z.object({
  byAssetClass: z.array(AllocationBucketSchema),
  byAssetSubClass: z.array(AllocationBucketSchema),
  byCurrency: z.array(AllocationBucketSchema),
  bySector: z.array(AllocationBucketSchema),
  holdingsCount: z.number()
});

export type AllocationsData = z.infer<typeof AllocationsDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetAllocationsOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: AllocationsDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type GetAllocationsOutput = z.infer<typeof GetAllocationsOutputSchema>;
