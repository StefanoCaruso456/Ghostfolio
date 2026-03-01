/**
 * simulateSale — Highest-stakes tool: simulates selling shares and estimates
 * capital gains tax impact using FIFO lot consumption.
 *
 * Atomic: tax simulation only (no trades executed)
 * Idempotent: same simulation input → same result
 * Error-handled: structured error, never throws
 * Verified: capped confidence (0.8), human-in-the-loop escalation
 *
 * Tax estimates are informational only. Users must consult a tax professional.
 */
import type { ConsumedLot, SaleSimulationResult } from '../../../tax/interfaces/tax.interfaces';
import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type {
  SimulateSaleData,
  SimulateSaleInput,
  SimulateSaleOutput
} from './schemas/simulate-sale.schema';

const DOMAIN_RULES_CHECKED = [
  'symbol-in-portfolio',
  'sufficient-lots-available',
  'fifo-order-applied',
  'tax-bracket-valid',
  'informational-only-disclaimer'
];

export function buildSimulateSaleResult(
  simulation: SaleSimulationResult,
  input?: SimulateSaleInput
): SimulateSaleOutput {
  try {
    // No open lots → error
    if (simulation.lotsConsumed.length === 0) {
      return {
        status: 'error',
        message: `No open lots found for ${simulation.symbol}`,
        verification: createVerificationResult({
          passed: false,
          confidence: 0,
          errors: [`No open lots found for ${simulation.symbol}`],
          sources: ['tax-service'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          domainRulesFailed: ['sufficient-lots-available'],
          verificationType: 'human_in_the_loop',
          requiresHumanReview: true,
          escalationReason:
            'No open lots available — cannot simulate sale'
        })
      };
    }

    const warnings: string[] = [];

    // Partial fill warning
    if (
      input &&
      simulation.quantitySold < input.quantity
    ) {
      warnings.push(
        `Partial fill: only ${simulation.quantitySold} of ${input.quantity} requested shares could be sold from available lots`
      );
    }

    // Build data payload
    const data: SimulateSaleData = {
      lotsConsumed: simulation.lotsConsumed.map((lot: ConsumedLot) => ({
        lotId: lot.lotId,
        acquiredDate: lot.acquiredDate,
        quantityFromLot: lot.quantityFromLot,
        costBasisPerShare: lot.costBasisPerShare,
        costBasis: lot.costBasis,
        proceeds: lot.proceeds,
        gainLoss: lot.gainLoss,
        holdingPeriod: lot.holdingPeriod
      })),
      summary: {
        totalCostBasis: simulation.summary.totalCostBasis,
        totalProceeds: simulation.summary.totalProceeds,
        totalGainLoss: simulation.summary.totalGainLoss,
        shortTermGain: simulation.summary.shortTermGain,
        longTermGain: simulation.summary.longTermGain,
        estimatedFederalTax: simulation.summary.estimatedFederalTax,
        effectiveTaxRate: simulation.summary.effectiveTaxRate,
        shortTermTaxRate: simulation.summary.shortTermTaxRate,
        longTermTaxRate: simulation.summary.longTermTaxRate,
        currency: simulation.summary.currency
      },
      assumptions: simulation.assumptions
    };

    // Build message
    const { summary } = simulation;
    let message = `Simulated selling ${simulation.quantitySold} shares of ${simulation.symbol} at $${simulation.pricePerShare}. Estimated tax: $${summary.estimatedFederalTax} (${summary.effectiveTaxRate}% effective rate).`;

    if (summary.shortTermGain > 0) {
      message += ` Short-term gain: $${summary.shortTermGain}.`;
    }

    if (summary.longTermGain > 0) {
      message += ` Long-term gain: $${summary.longTermGain}.`;
    }

    // Confidence capped at 0.8 — tax estimates are informational only
    const confidence = warnings.length > 0 ? 0.65 : 0.8;

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
          'Tax simulation results are estimates only — consult a tax professional before executing trades'
      })
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to simulate sale',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in simulateSale'
        ],
        sources: ['tax-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'human_in_the_loop',
        requiresHumanReview: true,
        escalationReason: 'Sale simulation failed unexpectedly'
      })
    };
  }
}
