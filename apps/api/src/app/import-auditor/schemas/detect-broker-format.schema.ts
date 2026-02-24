import { z } from 'zod';

import { VerificationResultSchema } from './verification.schema';

/**
 * Tool 4: Detect Broker Format
 *
 * Purpose: Auto-detect which broker produced the CSV based on header patterns,
 * data shapes, and known broker signatures. This informs mapBrokerFields
 * with a brokerHint for better mapping accuracy.
 */

export const KNOWN_BROKERS = [
  'interactive_brokers',
  'degiro',
  'trading212',
  'swissquote',
  'ghostfolio',
  'generic'
] as const;

export type KnownBroker = (typeof KNOWN_BROKERS)[number];

export const DetectBrokerFormatInputSchema = z.object({
  headers: z.array(z.string()).min(1).describe('CSV column headers'),
  sampleRows: z
    .array(z.record(z.unknown()))
    .min(1)
    .max(5)
    .describe('1-5 sample data rows for pattern matching'),
  fileName: z
    .string()
    .optional()
    .describe('Original file name (may contain broker hints)')
});

export type DetectBrokerFormatInput = z.infer<
  typeof DetectBrokerFormatInputSchema
>;

export const BrokerMatchSchema = z.object({
  broker: z.enum(KNOWN_BROKERS),
  confidence: z.number().min(0).max(1),
  matchedSignatures: z.array(z.string()),
  unmatchedExpected: z.array(z.string())
});

export type BrokerMatch = z.infer<typeof BrokerMatchSchema>;

export const DetectBrokerFormatDataSchema = z.object({
  detectedBroker: z.enum(KNOWN_BROKERS),
  confidence: z.number().min(0).max(1),
  allMatches: z.array(BrokerMatchSchema),
  explanation: z.string()
});

export const DetectBrokerFormatOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  data: DetectBrokerFormatDataSchema,
  verification: VerificationResultSchema
});

export type DetectBrokerFormatOutput = z.infer<
  typeof DetectBrokerFormatOutputSchema
>;
