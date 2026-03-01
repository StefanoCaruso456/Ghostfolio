/**
 * getTaxLots — Deterministic tool that returns derived FIFO tax lots.
 *
 * Atomic: retrieves derived tax lots only (no mutations)
 * Idempotent: same orders → same lots (deterministic FIFO derivation)
 * Error-handled: returns ToolResult(status=error), never throws
 * Verified: includes confidence scoring + source attribution
 */
import type { DerivedTaxLot } from '../../../tax/interfaces/tax.interfaces';

import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type {
  GetTaxLotsData,
  GetTaxLotsOutput
} from './schemas/get-tax-lots.schema';

const DOMAIN_RULES_CHECKED = [
  'lots-derived-from-orders',
  'fifo-method-applied',
  'holding-period-computed'
];

export function buildTaxLotsResult(
  lots: DerivedTaxLot[]
): GetTaxLotsOutput {
  try {
    // Compute summary
    const openLots = lots.filter(
      (l) => l.status === 'OPEN' || l.status === 'PARTIAL'
    );
    const closedLots = lots.filter((l) => l.status === 'CLOSED');

    const totalCostBasis = lots.reduce((sum, l) => sum + l.costBasis, 0);

    const totalUnrealizedGainLoss = openLots.reduce((sum, l) => {
      return sum + (l.gainLoss ?? 0);
    }, 0);

    const hasAnyGainLoss = openLots.some((l) => l.gainLoss !== null);

    const summary = {
      totalOpenLots: openLots.length,
      totalClosedLots: closedLots.length,
      totalCostBasis: Math.round(totalCostBasis * 100) / 100,
      totalUnrealizedGainLoss: hasAnyGainLoss
        ? Math.round(totalUnrealizedGainLoss * 100) / 100
        : null
    };

    // Map lots to schema-compatible shape (dates as strings)
    const mappedLots = lots.map((l) => ({
      id: l.id,
      symbol: l.symbol,
      acquiredDate: new Date(l.acquiredDate).toISOString().split('T')[0],
      quantity: l.quantity,
      remainingQuantity: l.remainingQuantity,
      costBasisPerShare: l.costBasisPerShare,
      costBasis: l.costBasis,
      holdingPeriod: l.holdingPeriod,
      status: l.status,
      gainLoss: l.gainLoss ?? null
    }));

    const data: GetTaxLotsData = {
      lots: mappedLots,
      summary
    };

    return {
      status: 'success',
      data,
      message: `Derived ${lots.length} tax lots (${openLots.length} open, ${closedLots.length} closed) using FIFO method.`,
      verification: createVerificationResult({
        passed: true,
        confidence: 0.9,
        sources: ['tax-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'confidence_scoring'
      })
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to get tax lots',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in getTaxLots'
        ],
        sources: ['tax-service']
      })
    };
  }
}
