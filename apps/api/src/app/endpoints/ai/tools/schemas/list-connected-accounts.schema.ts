import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const ListConnectedAccountsInputSchema = z.object({});

export type ListConnectedAccountsInput = z.infer<
  typeof ListConnectedAccountsInputSchema
>;

// ─── Data ────────────────────────────────────────────────────────────

const ConnectedAccountSchema = z.object({
  id: z.string(),
  type: z.enum(['snaptrade', 'plaid']),
  brokerageName: z.string().nullable(),
  institutionName: z.string().nullable(),
  status: z.string(),
  lastSyncedAt: z.string().nullable(),
  accountCount: z.number()
});

export const ListConnectedAccountsDataSchema = z.object({
  accounts: z.array(ConnectedAccountSchema),
  totalCount: z.number()
});

export type ListConnectedAccountsData = z.infer<
  typeof ListConnectedAccountsDataSchema
>;

// ─── Output ──────────────────────────────────────────────────────────

export const ListConnectedAccountsOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: ListConnectedAccountsDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type ListConnectedAccountsOutput = z.infer<
  typeof ListConnectedAccountsOutputSchema
>;
