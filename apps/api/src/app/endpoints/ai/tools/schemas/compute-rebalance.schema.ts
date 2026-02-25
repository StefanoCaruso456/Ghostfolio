import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const ComputeRebalanceInputSchema = z.object({
  baseCurrency: z
    .string()
    .optional()
    .describe('Base currency (defaults to portfolio currency)'),
  targetAllocations: z
    .object({
      assetClass: z
        .record(z.string(), z.number())
        .optional()
        .describe(
          'Target % by asset class, e.g. {"Equity": 60, "Bond": 30, "Cash": 10}'
        ),
      sector: z
        .record(z.string(), z.number())
        .optional()
        .describe(
          'Target % by sector, e.g. {"Technology": 30, "Healthcare": 20}'
        ),
      symbols: z
        .record(z.string(), z.number())
        .optional()
        .describe('Target % by symbol, e.g. {"AAPL": 10, "MSFT": 10}')
    })
    .describe('Target allocation percentages (must sum to <= 100)'),
  constraints: z
    .object({
      maxSingleNamePct: z
        .number()
        .optional()
        .describe('Max % for any single holding (e.g. 10)'),
      minCashPct: z
        .number()
        .optional()
        .describe('Minimum cash percentage to maintain'),
      ignoreSymbols: z
        .array(z.string())
        .optional()
        .describe('Symbols to exclude from rebalance suggestions')
    })
    .optional()
    .describe('Rebalancing constraints')
});

export type ComputeRebalanceInput = z.infer<typeof ComputeRebalanceInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

const AllocationEntrySchema = z.object({
  bucket: z.string(),
  currentPct: z.number(),
  targetPct: z.number(),
  deltaPct: z.number()
});

const SuggestedMoveSchema = z.object({
  action: z.enum(['buy', 'sell', 'hold']),
  symbol: z.string().nullable(),
  bucket: z.string().nullable(),
  deltaPct: z.number(),
  rationale: z.string()
});

const ConstraintViolationSchema = z.object({
  type: z.string(),
  description: z.string()
});

export const ComputeRebalanceDataSchema = z.object({
  allocationType: z.enum(['assetClass', 'sector', 'symbols']),
  currentAllocations: z.array(AllocationEntrySchema),
  suggestedMoves: z.array(SuggestedMoveSchema),
  constraintViolations: z.array(ConstraintViolationSchema),
  note: z.string()
});

export type ComputeRebalanceData = z.infer<typeof ComputeRebalanceDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const ComputeRebalanceOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: ComputeRebalanceDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema,
  meta: z
    .object({
      schemaVersion: z.string(),
      source: z.string(),
      cacheHit: z.boolean().optional(),
      providerLatencyMs: z.number().optional()
    })
    .optional()
});

export type ComputeRebalanceOutput = z.infer<
  typeof ComputeRebalanceOutputSchema
>;
