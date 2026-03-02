import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────
export const WashSaleCheckInputSchema = z.object({
  symbol: z
    .string()
    .optional()
    .describe(
      'Check a specific symbol. Omit to scan all holdings with recent loss sales.'
    ),
  lookbackDays: z
    .number()
    .int()
    .min(1)
    .max(90)
    .optional()
    .describe(
      'Number of days to look back for wash sale window. Default 61 (30 days before + sale day + 30 days after).'
    )
});

export type WashSaleCheckInput = z.infer<typeof WashSaleCheckInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────
export const WashSaleConflictSchema = z.object({
  type: z.enum(['BUY', 'SELL']),
  date: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  daysFromSale: z.number()
});

export const WashSaleCheckSchema = z.object({
  symbol: z.string(),
  status: z.enum(['CLEAR', 'WASH_SALE', 'AT_RISK']),
  detail: z.string(),
  conflictingTransactions: z.array(WashSaleConflictSchema)
});

export const WashSaleDataSchema = z.object({
  checks: z.array(WashSaleCheckSchema),
  assumptions: z.array(z.string())
});

export type WashSaleData = z.infer<typeof WashSaleDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────
export const WashSaleOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: WashSaleDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type WashSaleOutput = z.infer<typeof WashSaleOutputSchema>;
