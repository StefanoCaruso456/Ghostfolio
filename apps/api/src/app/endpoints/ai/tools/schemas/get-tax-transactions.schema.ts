import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const GetTaxTransactionsInputSchema = z.object({
  symbol: z.string().optional().describe('Filter by ticker symbol'),
  startDate: z.string().optional().describe('ISO date string'),
  endDate: z.string().optional().describe('ISO date string'),
  limit: z
    .number()
    .optional()
    .default(50)
    .describe('Max transactions to return (default 50)')
});

export type GetTaxTransactionsInput = z.infer<
  typeof GetTaxTransactionsInputSchema
>;

// ─── Data ────────────────────────────────────────────────────────────

const TaxTransactionSchema = z.object({
  id: z.string(),
  date: z.string(),
  type: z.string(),
  symbol: z.string(),
  name: z.string().nullable(),
  quantity: z.number(),
  unitPrice: z.number(),
  fee: z.number(),
  currency: z.string().nullable(),
  accountName: z.string().nullable()
});

export const GetTaxTransactionsDataSchema = z.object({
  transactions: z.array(TaxTransactionSchema),
  totalCount: z.number()
});

export type GetTaxTransactionsData = z.infer<
  typeof GetTaxTransactionsDataSchema
>;

// ─── Output ──────────────────────────────────────────────────────────

export const GetTaxTransactionsOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: GetTaxTransactionsDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type GetTaxTransactionsOutput = z.infer<
  typeof GetTaxTransactionsOutputSchema
>;
