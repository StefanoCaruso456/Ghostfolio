import { z } from 'zod';

import { VerificationResultSchema } from './verification.schema';

export const ParseCsvInputSchema = z.object({
  csvContent: z.string().min(1),
  delimiter: z.enum([',', ';', '\t', '|']).default(',')
});

export type ParseCsvInput = z.infer<typeof ParseCsvInputSchema>;

export const ParseCsvErrorSchema = z.object({
  row: z.number(),
  message: z.string()
});

export const ParseCsvDataSchema = z.object({
  rows: z.array(z.record(z.unknown())),
  headers: z.array(z.string()),
  rowCount: z.number(),
  errors: z.array(ParseCsvErrorSchema)
});

export const ParseCsvOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: ParseCsvDataSchema,
  verification: VerificationResultSchema
});

export type ParseCsvOutput = z.infer<typeof ParseCsvOutputSchema>;
