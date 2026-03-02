import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────
export const UpdateAdjustmentInputSchema = z.object({
  adjustmentId: z.string().describe('ID of the adjustment to update'),
  data: z
    .object({
      costBasis: z.number().optional(),
      quantity: z.number().optional(),
      acquiredDate: z.string().optional(),
      note: z.string().optional()
    })
    .describe('Updated adjustment data')
});

export type UpdateAdjustmentInput = z.infer<typeof UpdateAdjustmentInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────
export const UpdateAdjustmentDataSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  adjustmentType: z.string(),
  data: z.record(z.any()),
  updatedAt: z.string()
});

export type UpdateAdjustmentData = z.infer<typeof UpdateAdjustmentDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────
export const UpdateAdjustmentOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: UpdateAdjustmentDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type UpdateAdjustmentOutput = z.infer<
  typeof UpdateAdjustmentOutputSchema
>;
