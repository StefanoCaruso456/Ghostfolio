/**
 * getPortfolioSummary — Deterministic tool that returns portfolio overview.
 *
 * Atomic: single purpose (summary only)
 * Idempotent: same user → same result (within data freshness window)
 * Error-handled: returns ToolResult(status=error), never throws
 * Verified: includes confidence scoring + source attribution
 */
import type { PortfolioDetails } from '@ghostfolio/common/interfaces';

import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type {
  GetPortfolioSummaryInput,
  GetPortfolioSummaryOutput,
  PortfolioSummaryData
} from './schemas/portfolio-summary.schema';
import type { QuoteMetadata } from './schemas/quote-metadata.schema';

const DOMAIN_RULES_CHECKED = [
  'portfolio-data-available',
  'holdings-non-empty',
  'allocation-sum-valid'
];

export function buildPortfolioSummary(
  details: PortfolioDetails & { hasErrors: boolean },
  input: GetPortfolioSummaryInput
): GetPortfolioSummaryOutput {
  try {
    const holdings = Object.values(details.holdings);

    if (holdings.length === 0) {
      // Distinguish between a genuinely empty portfolio and a failed data fetch.
      // When safeGetDetails() catches an error, it returns { holdings: {}, hasErrors: true }.
      const isDegraded = details.hasErrors;

      return {
        status: isDegraded ? 'error' : 'success',
        data: {
          holdingsCount: 0,
          cashPct: null,
          investedPct: null,
          topHoldingsByAllocation: [],
          accountsCount: Object.keys(details.accounts).length,
          baseCurrency: input.userCurrency
        },
        message: isDegraded
          ? 'Unable to retrieve portfolio data — the portfolio service encountered an error. The user may have holdings that could not be loaded.'
          : 'Portfolio is empty — no holdings found.',
        verification: createVerificationResult({
          passed: !isDegraded,
          confidence: isDegraded ? 0.1 : 1.0,
          warnings: isDegraded
            ? [
                'Portfolio data fetch failed — holdings may exist but could not be loaded',
                'Recommend retrying or checking portfolio service health'
              ]
            : ['Portfolio has zero holdings'],
          errors: isDegraded
            ? [
                'Portfolio service returned an error — empty result is not reliable'
              ]
            : undefined,
          sources: ['ghostfolio-portfolio-service'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          verificationType: 'confidence_scoring'
        })
      };
    }

    // Sort by allocation descending, take top 10
    const sorted = [...holdings].sort(
      (a, b) => b.allocationInPercentage - a.allocationInPercentage
    );

    const topHoldings: PortfolioSummaryData['topHoldingsByAllocation'] = sorted
      .slice(0, 10)
      .map((h) => ({
        name: h.name,
        symbol: h.symbol,
        allocationPct: Math.round(h.allocationInPercentage * 10000) / 100, // convert to %
        currency: h.currency,
        assetClass: h.assetClass ?? null,
        assetSubClass: h.assetSubClass ?? null
      }));

    // Calculate total allocation sum for validation
    const totalAllocation = holdings.reduce(
      (sum, h) => sum + h.allocationInPercentage,
      0
    );

    const warnings: string[] = [];

    if (details.hasErrors) {
      warnings.push(
        'Portfolio data may be incomplete — some market data errors detected'
      );
    }

    // Allocation sum should be close to 1.0 (100%)
    if (Math.abs(totalAllocation - 1.0) > 0.05) {
      warnings.push(
        `Holdings allocation sum is ${(totalAllocation * 100).toFixed(1)}% — expected ~100%`
      );
    }

    const data: PortfolioSummaryData = {
      holdingsCount: holdings.length,
      cashPct: null, // Cash % not directly available from holdings
      investedPct: null, // Would need summary data
      topHoldingsByAllocation: topHoldings,
      accountsCount: Object.keys(details.accounts).length,
      baseCurrency: input.userCurrency
    };

    const quoteMetadata: QuoteMetadata = details.hasErrors
      ? {
          quoteStatus: 'partial',
          quotesAsOf: new Date().toISOString(),
          message:
            'Some market data was unavailable — prices may use last-known values'
        }
      : { quoteStatus: 'fresh', quotesAsOf: new Date().toISOString() };

    return {
      status: 'success',
      data,
      message: details.hasErrors
        ? `Portfolio has ${holdings.length} holdings across ${data.accountsCount} accounts. Note: some prices may be stale due to market data provider issues.`
        : `Portfolio has ${holdings.length} holdings across ${data.accountsCount} accounts.`,
      verification: createVerificationResult({
        passed: true,
        confidence: details.hasErrors ? 0.7 : 0.95,
        warnings,
        sources: ['ghostfolio-portfolio-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'confidence_scoring'
      }),
      quoteMetadata
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to build portfolio summary',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in getPortfolioSummary'
        ],
        sources: ['ghostfolio-portfolio-service']
      })
    };
  }
}
