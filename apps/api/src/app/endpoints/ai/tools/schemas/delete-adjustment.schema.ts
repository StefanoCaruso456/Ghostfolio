import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────
export const DeleteAdjustmentInputSchema = z.object({
  adjustmentId: z
    .string()
    .describe('ID of the adjustment to delete')
});

export type DeleteAdjustmentInput = z.infer<
  typeof DeleteAdjustmentInputSchema
>;

// ─── Data ────────────────────────────────────────────────────────────
export const DeleteAdjustmentDataSchema = z.object({
  deleted: z.literal(true),
  id: z.string()
});

export type DeleteAdjustmentData = z.infer<
  typeof DeleteAdjustmentDataSchema
>;

// ─── Output ──────────────────────────────────────────────────────────
export const DeleteAdjustmentOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: DeleteAdjustmentDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type DeleteAdjustmentOutput = z.infer<
  typeof DeleteAdjustmentOutputSchema
>;
