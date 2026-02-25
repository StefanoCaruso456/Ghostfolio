import { z } from 'zod';

import { VerificationResultSchema } from '../../../../import-auditor/schemas/verification.schema';

// ─── Input ───────────────────────────────────────────────────────────

export const ListActivitiesInputSchema = z.object({
  startDate: z
    .string()
    .optional()
    .describe('ISO 8601 start date for filtering activities (e.g. 2024-01-01)'),
  endDate: z
    .string()
    .optional()
    .describe('ISO 8601 end date for filtering activities (e.g. 2024-12-31)'),
  types: z
    .array(z.enum(['BUY', 'SELL', 'DIVIDEND', 'FEE', 'INTEREST', 'LIABILITY']))
    .optional()
    .describe(
      'Activity types to filter by. If omitted, all types are returned.'
    ),
  symbol: z.string().optional().describe('Filter by specific ticker symbol'),
  limit: z
    .number()
    .max(100)
    .default(50)
    .describe('Maximum number of activities to return (max 100)')
});

export type ListActivitiesInput = z.infer<typeof ListActivitiesInputSchema>;

// ─── Data ────────────────────────────────────────────────────────────

const ActivityRowSchema = z.object({
  date: z.string(),
  type: z.string(),
  symbol: z.string(),
  name: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  fee: z.number(),
  currency: z.string(),
  valueInBaseCurrency: z.number()
});

export const ListActivitiesDataSchema = z.object({
  activities: z.array(ActivityRowSchema),
  totalCount: z.number(),
  returnedCount: z.number(),
  totalFees: z.number(),
  totalDividends: z.number(),
  dateRange: z.object({
    from: z.string().nullable(),
    to: z.string().nullable()
  })
});

export type ListActivitiesData = z.infer<typeof ListActivitiesDataSchema>;

// ─── Output ──────────────────────────────────────────────────────────

export const ListActivitiesOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: ListActivitiesDataSchema.optional(),
  message: z.string(),
  verification: VerificationResultSchema
});

export type ListActivitiesOutput = z.infer<typeof ListActivitiesOutputSchema>;
