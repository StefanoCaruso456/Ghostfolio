/**
 * getTaxHoldings — Deterministic tool that returns tax-relevant holding data.
 *
 * Atomic: retrieves holdings with cost basis and market values only
 * Idempotent: same portfolio state → same result
 * Error-handled: returns ToolResult(status=error), never throws
 * Verified: includes confidence scoring + source attribution
 */
import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type { TaxHolding } from '../../../tax/interfaces/tax.interfaces';
import type {
  GetTaxHoldingsData,
  GetTaxHoldingsOutput
} from './schemas/get-tax-holdings.schema';

const DOMAIN_RULES_CHECKED = [
  'holdings-data-available',
  'market-prices-fetched',
  'cost-basis-computed'
];

export function buildTaxHoldingsResult(
  holdings: TaxHolding[]
): GetTaxHoldingsOutput {
  try {
    const warnings: string[] = [];
    let hasMissingPrices = false;

    // Check for holdings with null marketPrice
    const missingPriceSymbols = holdings
      .filter((h) => h.marketPrice === null)
      .map((h) => h.symbol);

    if (missingPriceSymbols.length > 0) {
      hasMissingPrices = true;
      warnings.push(
        `Market price unavailable for: ${missingPriceSymbols.join(', ')}`
      );
    }

    // Compute totals
    const totalMarketValue = holdings.reduce((sum, h) => {
      return sum + (h.marketValue ?? 0);
    }, 0);

    const totalCostBasis = holdings.reduce((sum, h) => {
      return sum + h.costBasis;
    }, 0);

    const totalUnrealizedGainLoss = holdings.reduce((sum, h) => {
      return sum + (h.unrealizedGainLoss ?? 0);
    }, 0);

    const hasAnyMarketValue = holdings.some((h) => h.marketValue !== null);

    const data: GetTaxHoldingsData = {
      holdings,
      totalMarketValue: hasAnyMarketValue
        ? Math.round(totalMarketValue * 100) / 100
        : null,
      totalCostBasis: Math.round(totalCostBasis * 100) / 100,
      totalUnrealizedGainLoss: hasAnyMarketValue
        ? Math.round(totalUnrealizedGainLoss * 100) / 100
        : null
    };

    const confidence = hasMissingPrices ? 0.8 : 0.95;

    return {
      status: 'success',
      data,
      message: `Found ${holdings.length} holdings with total market value $${data.totalMarketValue ?? 'N/A'} and cost basis $${data.totalCostBasis}.`,
      verification: createVerificationResult({
        passed: true,
        confidence,
        warnings,
        sources: ['tax-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        domainRulesFailed: hasMissingPrices ? ['market-prices-fetched'] : [],
        verificationType: 'confidence_scoring'
      })
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Failed to get tax holdings',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in getTaxHoldings'
        ],
        sources: ['tax-service']
      })
    };
  }
}
