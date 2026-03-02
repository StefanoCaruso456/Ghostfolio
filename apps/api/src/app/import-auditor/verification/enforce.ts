/**
 * Central verification gate — decides whether the agent may proceed,
 * must stop, or must request human review.
 *
 * Called after EACH tool result in the ReAct loop.
 * Ensures safety is enforced even if the model tries to bypass tool 5.
 */
import type { VerificationResult } from '../schemas/verification.schema';

export type GateDecision =
  | { decision: 'continue' }
  | { decision: 'block'; reason: string }
  | { decision: 'human_review'; reason: string };

export function enforceVerificationGate(
  v: VerificationResult,
  opts: { highStakes: boolean; minConfidence: number }
): GateDecision {
  if (!v.passed || (v.errors?.length ?? 0) > 0) {
    const errorDetail =
      v.errors && v.errors.length > 0
        ? v.errors.join('; ')
        : 'no details provided (passed=false)';

    return {
      decision: 'block',
      reason: `Verification failed: ${errorDetail}`
    };
  }

  if ((v.domainRulesFailed?.length ?? 0) > 0 && !v.passed) {
    return {
      decision: 'block',
      reason: `Domain rules failed: ${v.domainRulesFailed!.join(', ')}`
    };
  }

  if ((v.hallucinationFlags?.length ?? 0) > 0) {
    return {
      decision: 'human_review',
      reason: `Hallucination flags: ${v.hallucinationFlags!.join(', ')}`
    };
  }

  if (opts.highStakes && v.confidence < opts.minConfidence) {
    return {
      decision: 'human_review',
      reason: `High-stakes + low confidence (${v.confidence})`
    };
  }

  if (v.requiresHumanReview) {
    return {
      decision: 'human_review',
      reason: 'Tool requested human review'
    };
  }

  if ((v.warnings?.length ?? 0) > 0 && opts.highStakes) {
    return {
      decision: 'human_review',
      reason: 'Warnings present in high-stakes flow'
    };
  }

  return { decision: 'continue' };
}
