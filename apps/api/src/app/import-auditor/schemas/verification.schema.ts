import { z } from 'zod';

export const VerificationResultSchema = z.object({
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  sources: z.array(z.string())
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export function createVerificationResult(
  overrides: Partial<VerificationResult> = {}
): VerificationResult {
  return {
    passed: true,
    confidence: 1.0,
    warnings: [],
    errors: [],
    sources: [],
    ...overrides
  };
}
