/**
 * taxLossHarvest — Identifies holdings with unrealized losses that could be
 * sold to offset capital gains (tax-loss harvesting).
 *
 * Atomic: read-only analysis (no trades executed)
 * Idempotent: same portfolio state → same result
 * Error-handled: structured error, never throws
 * Verified: capped confidence (0.8), human-in-the-loop escalation
 */
import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type { TaxLossHarvestResult } from '../../../tax/interfaces/tax.interfaces';
import type {
  TaxLossHarvestData,
  TaxLossHarvestOutput
} from './schemas/tax-loss-harvest.schema';

const DOMAIN_RULES_CHECKED = [
  'holdings-data-available',
  'market-prices-fetched',
  'unrealized-losses-computed',
  'wash-sale-risk-flagged',
  'informational-only-disclaimer'
];

export function buildTaxLossHarvestResult(
  result: TaxLossHarvestResult
): TaxLossHarvestOutput {
  try {
    if (result.candidates.length === 0) {
      return {
        status: 'success',
        data: {
          candidates: [],
          totalHarvestableShortTerm: 0,
          totalHarvestableLongTerm: 0,
          totalHarvestable: 0,
          potentialTaxSavings: 0,
          assumptions: result.assumptions
        },
        message:
          'No tax-loss harvesting candidates found — all holdings are at a gain or below the minimum loss threshold.',
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
    const washSaleCount = result.candidates.filter(
      (c) => c.washSaleRisk
    ).length;

    if (washSaleCount > 0) {
      warnings.push(
        `${washSaleCount} candidate(s) flagged with wash sale risk — review before selling`
      );
    }

    const data: TaxLossHarvestData = {
      candidates: result.candidates,
      totalHarvestableShortTerm: result.totalHarvestableShortTerm,
      totalHarvestableLongTerm: result.totalHarvestableLongTerm,
      totalHarvestable: result.totalHarvestable,
      potentialTaxSavings: result.potentialTaxSavings,
      assumptions: result.assumptions
    };

    let message = `Found ${result.candidates.length} tax-loss harvesting candidate(s).`;
    message += ` Total harvestable loss: $${Math.abs(result.totalHarvestable).toLocaleString()}.`;
    message += ` Potential tax savings: ~$${result.potentialTaxSavings.toLocaleString()}.`;

    if (washSaleCount > 0) {
      message += ` ${washSaleCount} with wash sale risk.`;
    }

    const confidence = washSaleCount > 0 ? 0.7 : 0.8;

    return {
      status: 'success',
      data,
      message,
      verification: createVerificationResult({
        passed: true,
        confidence,
        warnings,
        sources: ['tax-service', 'ghostfolio-portfolio-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'human_in_the_loop',
        requiresHumanReview: true,
        escalationReason:
          'Tax-loss harvesting involves selling securities — consult a tax professional before executing'
      })
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to find tax-loss harvesting candidates',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in taxLossHarvest'
        ],
        sources: ['tax-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'human_in_the_loop',
        requiresHumanReview: true,
        escalationReason: 'Tax-loss harvesting analysis failed unexpectedly'
      })
    };
  }
}
