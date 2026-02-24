import { z } from 'zod';

import { VerificationResultSchema } from './verification.schema';

export const GHOSTFOLIO_TARGET_FIELDS = [
  'account',
  'comment',
  'currency',
  'dataSource',
  'date',
  'fee',
  'quantity',
  'symbol',
  'type',
  'unitPrice'
] as const;

export const REQUIRED_TARGET_FIELDS = [
  'currency',
  'date',
  'fee',
  'quantity',
  'symbol',
  'type',
  'unitPrice'
] as const;

export const FieldMappingSchema = z.object({
  sourceHeader: z.string(),
  targetField: z.enum(GHOSTFOLIO_TARGET_FIELDS),
  confidence: z.number().min(0).max(1),
  transformRule: z.string().optional()
});

export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export const MapBrokerFieldsInputSchema = z.object({
  headers: z.array(z.string()).min(1).describe('CSV column headers to map'),
  sampleRows: z
    .array(z.record(z.unknown()))
    .min(1)
    .max(5)
    .describe('1-5 sample data rows for context'),
  brokerHint: z
    .string()
    .optional()
    .describe('Optional hint about the broker (e.g., "Interactive Brokers")')
});

export type MapBrokerFieldsInput = z.infer<typeof MapBrokerFieldsInputSchema>;

export const MapBrokerFieldsDataSchema = z.object({
  mappings: z.array(FieldMappingSchema),
  unmappedHeaders: z.array(z.string()),
  unmappedRequiredFields: z.array(z.string()),
  overallConfidence: z.number().min(0).max(1),
  explanation: z.string()
});

export const MapBrokerFieldsOutputSchema = z.object({
  status: z.enum(['success', 'partial', 'error']),
  data: MapBrokerFieldsDataSchema,
  verification: VerificationResultSchema
});

export type MapBrokerFieldsOutput = z.infer<typeof MapBrokerFieldsOutputSchema>;
