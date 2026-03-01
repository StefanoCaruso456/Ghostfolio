import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const SyncAccountInputSchema = z.object({
  connectionId: z.string().describe('ID of the connected account to sync'),
  type: z.enum(['snaptrade', 'plaid']).describe('Type of connection to sync')
});

export type SyncAccountInput = z.infer<typeof SyncAccountInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

export const SyncAccountDataSchema = z.object({
  syncedAt: z.string(),
  holdingsCount: z.number(),
  transactionsCount: z.number(),
  status: z.enum(['success', 'error']),
  message: z.string().optional()
});

export type SyncAccountData = z.infer<typeof SyncAccountDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const SyncAccountOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: SyncAccountDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type SyncAccountOutput = z.infer<typeof SyncAccountOutputSchema>;
