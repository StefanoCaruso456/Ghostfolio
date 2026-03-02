import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────
export const CreateAdjustmentInputSchema = z.object({
  symbol: z.string().describe('Ticker symbol for the adjustment'),
  adjustmentType: z
    .enum(['COST_BASIS_OVERRIDE', 'ADD_LOT', 'REMOVE_LOT'])
    .describe('Type of adjustment'),
  data: z
    .object({
      costBasis: z.number().optional(),
      quantity: z.number().optional(),
      acquiredDate: z.string().optional(),
      note: z.string().optional()
    })
    .describe('Adjustment data')
});

export type CreateAdjustmentInput = z.infer<typeof CreateAdjustmentInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────
export const CreateAdjustmentDataSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  adjustmentType: z.string(),
  data: z.record(z.any()),
  createdAt: z.string()
});

export type CreateAdjustmentData = z.infer<typeof CreateAdjustmentDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────
export const CreateAdjustmentOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: CreateAdjustmentDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type CreateAdjustmentOutput = z.infer<
  typeof CreateAdjustmentOutputSchema
>;
