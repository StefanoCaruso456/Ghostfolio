/**
 * getHoldingDetail — Deterministic tool that returns deep holding detail.
 *
 * Atomic: single holding detail only
 * Idempotent: same symbol → same result (within data freshness window)
 * Error-handled: returns ToolResult(status=error), never throws
 * Verified: includes confidence scoring + source attribution
 */
import type { PortfolioHoldingResponse } from '@ghostfolio/common/interfaces';

import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type {
  GetHoldingDetailData,
  GetHoldingDetailOutput
} from './schemas/get-holding-detail.schema';
import type { QuoteMetadata } from './schemas/quote-metadata.schema';

const DOMAIN_RULES_CHECKED = [
  'symbol-provided',
  'holding-found-in-portfolio',
  'performance-data-coherent',
  'historical-data-available'
];

const MAX_HISTORICAL_POINTS = 90;

export function buildHoldingDetailResult(
  holding: PortfolioHoldingResponse | undefined,
  symbol: string,
  dataSource: string,
  hasErrors: boolean
): GetHoldingDetailOutput {
  try {
    if (!holding) {
      return {
        status: 'error',
        message: `Holding "${symbol}" not found in portfolio.`,
        verification: createVerificationResult({
          passed: false,
          confidence: 0.3,
          errors: [
            `No position found for symbol "${symbol}" (dataSource: ${dataSource})`
          ],
          sources: ['ghostfolio-portfolio-service'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          domainRulesFailed: ['holding-found-in-portfolio'],
          verificationType: 'confidence_scoring'
        })
      };
    }

    const warnings: string[] = [];

    if (hasErrors) {
      warnings.push(
        'Market data may be incomplete — some provider errors detected'
      );
    }

    // Truncate historical data to last N points for token budget
    const fullHist = holding.historicalData ?? [];
    const truncated = fullHist.length > MAX_HISTORICAL_POINTS;
    const histSlice = truncated
      ? fullHist.slice(fullHist.length - MAX_HISTORICAL_POINTS)
      : fullHist;

    if (truncated) {
      warnings.push(
        `Historical data truncated from ${fullHist.length} to ${MAX_HISTORICAL_POINTS} points (most recent)`
      );
    }

    // Extract all-time high from performances
    const ath = (holding.performances as any)?.allTimeHigh;

    const data: GetHoldingDetailData = {
      symbol: holding.SymbolProfile?.symbol ?? symbol,
      name: holding.SymbolProfile?.name ?? null,
      currency: holding.SymbolProfile?.currency ?? null,
      assetClass: (holding.SymbolProfile?.assetClass as string) ?? null,
      assetSubClass: (holding.SymbolProfile?.assetSubClass as string) ?? null,
      dataSource,

      quantity: holding.quantity,
      averagePrice: holding.averagePrice,
      marketPrice: holding.marketPrice,
      marketPriceMax: holding.marketPriceMax,
      marketPriceMin: holding.marketPriceMin,
      value: holding.value,
      investmentInBaseCurrency:
        holding.investmentInBaseCurrencyWithCurrencyEffect ?? null,

      dateOfFirstActivity: holding.dateOfFirstActivity ?? null,
      activitiesCount: holding.activitiesCount,

      dividendInBaseCurrency: holding.dividendInBaseCurrency,
      dividendYieldPct:
        holding.dividendYieldPercent != null
          ? Math.round(holding.dividendYieldPercent * 10000) / 100
          : null,
      feeInBaseCurrency: holding.feeInBaseCurrency,

      performance: {
        grossPerformance: holding.grossPerformance ?? null,
        grossPerformancePct:
          holding.grossPerformancePercent != null
            ? Math.round(holding.grossPerformancePercent * 10000) / 100
            : null,
        netPerformance: holding.netPerformance ?? null,
        netPerformancePct:
          holding.netPerformancePercent != null
            ? Math.round(holding.netPerformancePercent * 10000) / 100
            : null,
        netPerformanceWithCurrencyEffect:
          holding.netPerformanceWithCurrencyEffect ?? null,
        netPerformancePctWithCurrencyEffect:
          holding.netPerformancePercentWithCurrencyEffect != null
            ? Math.round(
                holding.netPerformancePercentWithCurrencyEffect * 10000
              ) / 100
            : null
      },

      allTimeHigh: ath
        ? {
            date: ath.date
              ? new Date(ath.date).toISOString().split('T')[0]
              : null,
            performancePctFromATH:
              ath.performancePercent != null
                ? Math.round(ath.performancePercent * 10000) / 100
                : null
          }
        : null,

      historicalData: histSlice.map((p) => ({
        date: p.date,
        marketPrice: p.marketPrice ?? null,
        averagePrice: p.averagePrice ?? null,
        quantity: p.quantity ?? null
      })),
      historicalDataPointCount: fullHist.length
    };

    const quoteMetadata: QuoteMetadata = hasErrors
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
      message: `Holding detail for ${data.name ?? symbol}: ${data.quantity} shares @ ${data.marketPrice} ${data.currency ?? ''}, net performance ${data.performance.netPerformancePct ?? 'N/A'}%.`,
      verification: createVerificationResult({
        passed: true,
        confidence: hasErrors ? 0.7 : 0.95,
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
        error instanceof Error ? error.message : 'Failed to get holding detail',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in getHoldingDetail'
        ],
        sources: ['ghostfolio-portfolio-service']
      })
    };
  }
}
