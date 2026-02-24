import { z } from 'zod';

/**
 * VerificationResult — AgentForge-grade verification layer.
 *
 * Implemented verification types:
 * 1. Confidence Scoring — 0-1 scale per result (all tools)
 * 2. Domain Constraints — hard business rules (validateTransactions, generateImportPreview)
 * 3. Human-in-the-Loop — escalation flag for low-confidence + high-stakes (detectBrokerFormat, generateImportPreview)
 * 4. Hallucination Detection — flags low-confidence broker claims as hallucination risk (detectBrokerFormat)
 *
 * Not yet implemented (schema-only, ready for future use):
 * 5. Fact Checking — cross-reference authoritative sources (requires external API)
 */

export const VerificationSourceSchema = z.object({
  name: z.string(),
  ref: z.string().optional()
});

export type VerificationSource = z.infer<typeof VerificationSourceSchema>;

export const VerificationResultSchema = z.object({
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  sources: z.array(z.string()),

  // Verification type flags
  verificationType: z
    .enum([
      'fact_check',
      'hallucination_detection',
      'confidence_scoring',
      'domain_constraint',
      'human_in_the_loop',
      'composite'
    ])
    .default('composite'),

  // Fact-checking: were claims cross-referenced?
  factCheckPassed: z.boolean().optional(),
  factCheckSources: z.array(VerificationSourceSchema).optional(),

  // Hallucination detection: any unsupported claims?
  hallucinationFlags: z.array(z.string()).optional(),
  allClaimsSupported: z.boolean().optional(),

  // Domain constraints: which rules were checked?
  domainRulesChecked: z.array(z.string()).optional(),
  domainRulesFailed: z.array(z.string()).optional(),

  // Human-in-the-loop escalation
  requiresHumanReview: z.boolean().default(false),
  escalationReason: z.string().optional()
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
    verificationType: 'composite',
    factCheckPassed: undefined,
    factCheckSources: undefined,
    hallucinationFlags: undefined,
    allClaimsSupported: undefined,
    domainRulesChecked: undefined,
    domainRulesFailed: undefined,
    requiresHumanReview: false,
    escalationReason: undefined,
    ...overrides
  };
}

/**
 * Escalation rule (from AgentForge spec):
 * If high_stakes AND confidence < threshold → require human confirm
 * If a domain constraint fails → block action (no override without human)
 */
export const CONFIDENCE_THRESHOLD = 0.7;
export const HIGH_STAKES_THRESHOLD = 0.5;

export function shouldEscalateToHuman(
  verification: VerificationResult,
  isHighStakes: boolean
): boolean {
  // Domain constraint failure → always escalate
  if (
    verification.domainRulesFailed &&
    verification.domainRulesFailed.length > 0
  ) {
    return true;
  }

  // High stakes + low confidence → escalate
  if (isHighStakes && verification.confidence < CONFIDENCE_THRESHOLD) {
    return true;
  }

  // Hallucination detected → escalate
  if (
    verification.hallucinationFlags &&
    verification.hallucinationFlags.length > 0
  ) {
    return true;
  }

  return false;
}

/**
 * Merge multiple verification results into a composite result.
 */
export function mergeVerificationResults(
  results: VerificationResult[]
): VerificationResult {
  if (results.length === 0) {
    return createVerificationResult();
  }

  const allPassed = results.every((r) => r.passed);
  const avgConfidence =
    results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
  const allWarnings = results.flatMap((r) => r.warnings);
  const allErrors = results.flatMap((r) => r.errors);
  const allSources = [...new Set(results.flatMap((r) => r.sources))];
  const anyRequiresHuman = results.some((r) => r.requiresHumanReview);

  return createVerificationResult({
    passed: allPassed,
    confidence: avgConfidence,
    warnings: allWarnings,
    errors: allErrors,
    sources: allSources,
    verificationType: 'composite',
    requiresHumanReview: anyRequiresHuman,
    escalationReason: anyRequiresHuman
      ? results
          .filter((r) => r.escalationReason)
          .map((r) => r.escalationReason)
          .join('; ')
      : undefined,
    domainRulesChecked: results.flatMap((r) => r.domainRulesChecked ?? []),
    domainRulesFailed: results.flatMap((r) => r.domainRulesFailed ?? []),
    hallucinationFlags: results.flatMap((r) => r.hallucinationFlags ?? []),
    allClaimsSupported: results.every((r) => r.allClaimsSupported !== false)
  });
}
