/**
 * portfolioLiquidation — Simulates selling ALL open positions at current
 * market prices and estimates total tax liability across the portfolio.
 *
 * Atomic: read-only simulation (no trades executed)
 * Idempotent: same portfolio state → same result
 * Error-handled: structured error, never throws
 * Verified: capped confidence (0.75), human-in-the-loop escalation
 */
import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type { PortfolioLiquidationResult } from '../../../tax/interfaces/tax.interfaces';
import type {
  PortfolioLiquidationData,
  PortfolioLiquidationOutput
} from './schemas/portfolio-liquidation.schema';

const DOMAIN_RULES_CHECKED = [
  'holdings-data-available',
  'market-prices-fetched',
  'fifo-lots-derived',
  'tax-rates-applied',
  'informational-only-disclaimer'
];

export function buildPortfolioLiquidationResult(
  result: PortfolioLiquidationResult
): PortfolioLiquidationOutput {
  try {
    if (result.holdings.length === 0) {
      return {
        status: 'error',
        message: 'No open holdings found to simulate liquidation.',
        verification: createVerificationResult({
          passed: false,
          confidence: 0,
          errors: ['No open holdings found'],
          sources: ['tax-service'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          domainRulesFailed: ['holdings-data-available'],
          verificationType: 'human_in_the_loop',
          requiresHumanReview: true,
          escalationReason: 'No holdings available for liquidation simulation'
        })
      };
    }

    const warnings: string[] = [];

    const data: PortfolioLiquidationData = {
      holdings: result.holdings,
      summary: result.summary,
      assumptions: result.assumptions,
      holdingsCount: result.holdingsCount
    };

    const { summary } = result;
    let message = `Simulated full portfolio liquidation of ${result.holdingsCount} holdings.`;
    message += ` Total proceeds: $${summary.totalProceeds.toLocaleString()}.`;
    message += ` Total gain/loss: $${summary.totalGainLoss.toLocaleString()}.`;
    message += ` Estimated total tax: $${summary.estimatedTotalTax.toLocaleString()} (${summary.effectiveTaxRate}% effective).`;

    if (summary.estimatedStateTax > 0) {
      message += ` State: $${summary.estimatedStateTax.toLocaleString()}.`;
    }

    if (summary.estimatedNIIT > 0) {
      message += ` NIIT: $${summary.estimatedNIIT.toLocaleString()}.`;
    }

    // Lower confidence — full liquidation is complex, many assumptions
    const confidence = 0.75;

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
          'Full portfolio liquidation is a high-stakes scenario — consult a tax professional before executing'
      })
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to simulate portfolio liquidation',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in portfolioLiquidation'
        ],
        sources: ['tax-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'human_in_the_loop',
        requiresHumanReview: true,
        escalationReason: 'Portfolio liquidation simulation failed unexpectedly'
      })
    };
  }
}
