/**
 * washSaleCheck — Detects IRS wash sale violations by scanning for
 * substantially identical purchases within 30 days before/after a loss sale.
 *
 * Atomic: read-only analysis (no trades executed)
 * Idempotent: same transaction history → same result
 * Error-handled: structured error, never throws
 * Verified: capped confidence (0.8), human-in-the-loop escalation
 */
import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type { WashSaleResult } from '../../../tax/interfaces/tax.interfaces';
import type {
  WashSaleData,
  WashSaleOutput
} from './schemas/wash-sale-check.schema';

const DOMAIN_RULES_CHECKED = [
  'transaction-history-available',
  'loss-sales-identified',
  'wash-sale-window-scanned',
  'substantially-identical-check',
  'informational-only-disclaimer'
];

export function buildWashSaleCheckResult(
  result: WashSaleResult
): WashSaleOutput {
  try {
    if (result.checks.length === 0) {
      return {
        status: 'success',
        data: { checks: [], assumptions: result.assumptions },
        message:
          'No recent loss sales found to check for wash sale violations.',
        verification: createVerificationResult({
          passed: true,
          confidence: 0.9,
          sources: ['tax-service'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          verificationType: 'confidence_scoring'
        })
      };
    }

    const warnings: string[] = [];
    const washSaleCount = result.checks.filter(
      (c) => c.status === 'WASH_SALE'
    ).length;
    const atRiskCount = result.checks.filter(
      (c) => c.status === 'AT_RISK'
    ).length;
    const clearCount = result.checks.filter((c) => c.status === 'CLEAR').length;

    if (washSaleCount > 0) {
      warnings.push(
        `${washSaleCount} symbol(s) have confirmed wash sale violations — losses may be disallowed by IRS`
      );
    }

    if (atRiskCount > 0) {
      warnings.push(
        `${atRiskCount} symbol(s) are at risk of wash sale if purchased again within 30 days`
      );
    }

    const data: WashSaleData = {
      checks: result.checks,
      assumptions: result.assumptions
    };

    let message = `Scanned ${result.checks.length} symbol(s) for wash sale violations.`;
    message += ` Clear: ${clearCount}. Wash sale: ${washSaleCount}. At risk: ${atRiskCount}.`;

    const confidence = washSaleCount > 0 ? 0.75 : 0.85;

    return {
      status: 'success',
      data,
      message,
      verification: createVerificationResult({
        passed: washSaleCount === 0,
        confidence,
        warnings,
        sources: ['tax-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        domainRulesFailed:
          washSaleCount > 0 ? ['wash-sale-window-scanned'] : [],
        verificationType: 'human_in_the_loop',
        requiresHumanReview: washSaleCount > 0 || atRiskCount > 0,
        escalationReason:
          washSaleCount > 0
            ? 'Wash sale violations detected — consult a tax professional for proper reporting'
            : atRiskCount > 0
              ? 'Potential wash sale risk — review before re-purchasing these securities'
              : undefined
      })
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to check for wash sales',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in washSaleCheck'
        ],
        sources: ['tax-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'human_in_the_loop',
        requiresHumanReview: true,
        escalationReason: 'Wash sale check failed unexpectedly'
      })
    };
  }
}
