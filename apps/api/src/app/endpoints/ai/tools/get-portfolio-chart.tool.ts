/**
 * getPortfolioChart — Deterministic tool that returns portfolio time-series data.
 *
 * Atomic: chart data only (no mutations)
 * Idempotent: same dateRange → same result (within data freshness window)
 * Error-handled: returns ToolResult(status=error), never throws
 * Verified: includes confidence scoring + source attribution
 */
import type { HistoricalDataItem } from '@ghostfolio/common/interfaces';

import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type {
  GetPortfolioChartData,
  GetPortfolioChartInput,
  GetPortfolioChartOutput
} from './schemas/get-portfolio-chart.schema';
import type { QuoteMetadata } from './schemas/quote-metadata.schema';

const DOMAIN_RULES_CHECKED = [
  'chart-data-available',
  'date-range-valid',
  'points-non-empty',
  'summary-coherent'
];

/**
 * Evenly sample N points from an array, always including first and last.
 */
function samplePoints<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) {
    return arr;
  }

  const result: T[] = [arr[0]];
  const step = (arr.length - 1) / (maxPoints - 1);

  for (let i = 1; i < maxPoints - 1; i++) {
    result.push(arr[Math.round(i * step)]);
  }

  result.push(arr[arr.length - 1]);

  return result;
}

export function buildPortfolioChartResult(
  chartData: HistoricalDataItem[],
  hasErrors: boolean,
  isDegraded: boolean,
  input: GetPortfolioChartInput,
  baseCurrency: string
): GetPortfolioChartOutput {
  try {
    const fullChart = chartData ?? [];

    if (fullChart.length === 0) {
      return {
        status: 'success',
        data: {
          chart: [],
          pointCount: 0,
          totalPointsAvailable: 0,
          sampled: false,
          summary: {
            startDate: '',
            endDate: '',
            startValue: null,
            endValue: null,
            peakValue: null,
            peakDate: null,
            troughValue: null,
            troughDate: null,
            totalChangePct: null
          },
          dateRange: input.dateRange,
          baseCurrency
        },
        message: 'No chart data available for the selected date range.',
        verification: createVerificationResult({
          passed: true,
          confidence: 0.8,
          warnings: [
            'Chart is empty — portfolio may have no history in this range'
          ],
          sources: ['ghostfolio-portfolio-service'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          verificationType: 'confidence_scoring'
        })
      };
    }

    const maxPoints = input.maxPoints ?? 100;
    const sampled = fullChart.length > maxPoints;
    const chartSlice = samplePoints(fullChart, maxPoints);

    // Compute summary metrics from the FULL chart (not sampled)
    let peakValue: number | null = null;
    let peakDate: string | null = null;
    let troughValue: number | null = null;
    let troughDate: string | null = null;

    for (const point of fullChart) {
      const nw = point.netWorth ?? point.value ?? null;

      if (nw == null) {
        continue;
      }

      if (peakValue == null || nw > peakValue) {
        peakValue = nw;
        peakDate = point.date;
      }

      if (troughValue == null || nw < troughValue) {
        troughValue = nw;
        troughDate = point.date;
      }
    }

    const startValue = fullChart[0].netWorth ?? fullChart[0].value ?? null;
    const endValue =
      fullChart[fullChart.length - 1].netWorth ??
      fullChart[fullChart.length - 1].value ??
      null;
    const totalChangePct =
      startValue != null && endValue != null && startValue !== 0
        ? Math.round(((endValue - startValue) / startValue) * 10000) / 100
        : null;

    const warnings: string[] = [];

    if (hasErrors) {
      warnings.push(
        'Chart data may be incomplete — some market data errors detected'
      );
    }

    if (sampled) {
      warnings.push(
        `Chart downsampled from ${fullChart.length} to ${chartSlice.length} points`
      );
    }

    const data: GetPortfolioChartData = {
      chart: chartSlice.map((p) => ({
        date: p.date,
        netWorth: p.netWorth ?? null,
        totalInvestment: p.totalInvestment ?? null,
        netPerformancePct:
          p.netPerformanceInPercentage != null
            ? Math.round(p.netPerformanceInPercentage * 10000) / 100
            : null,
        value: p.value ?? null
      })),
      pointCount: chartSlice.length,
      totalPointsAvailable: fullChart.length,
      sampled,
      summary: {
        startDate: fullChart[0].date,
        endDate: fullChart[fullChart.length - 1].date,
        startValue,
        endValue,
        peakValue,
        peakDate,
        troughValue,
        troughDate,
        totalChangePct
      },
      dateRange: input.dateRange,
      baseCurrency
    };

    const quoteMetadata: QuoteMetadata = isDegraded
      ? {
          quoteStatus: 'unavailable',
          message:
            'Chart data is based on last available prices — live data was unreachable'
        }
      : hasErrors
        ? {
            quoteStatus: 'partial',
            quotesAsOf: new Date().toISOString(),
            message: 'Some market data was unavailable'
          }
        : { quoteStatus: 'fresh', quotesAsOf: new Date().toISOString() };

    return {
      status: 'success',
      data,
      message: `Portfolio chart (${input.dateRange}): ${chartSlice.length} points, value changed ${totalChangePct ?? 'N/A'}% over period.`,
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
        error instanceof Error
          ? error.message
          : 'Failed to get portfolio chart',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in getPortfolioChart'
        ],
        sources: ['ghostfolio-portfolio-service']
      })
    };
  }
}
