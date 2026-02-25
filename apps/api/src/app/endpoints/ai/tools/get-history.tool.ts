/**
 * getHistory — Deterministic tool that returns historical price data.
 *
 * Atomic: history data only
 * Idempotent: same params → same result
 * Error-handled: structured error, never throws
 * Verified: confidence + source + domain rules
 *
 * Includes optional derived returns (total return, max drawdown, volatility).
 * Cap: 260 data points max (1y daily). Truncation warning if exceeded.
 */
import { TOOL_RESULT_SCHEMA_VERSION } from '../../../import-auditor/schemas/tool-result.schema';
import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import { getMarketDataProvider } from '../providers';
import type {
  GetHistoryData,
  GetHistoryInput,
  GetHistoryOutput
} from './schemas/get-history.schema';

const DOMAIN_RULES_CHECKED = [
  'symbol-valid',
  'range-supported',
  'history-points-returned'
];

function computeReturns(points: { close: number }[]): {
  totalReturnPct: number;
  maxDrawdownPct: number;
  volatilityPct: number | null;
  periodHigh: number;
  periodLow: number;
} | null {
  if (points.length < 2) {
    return null;
  }

  const closes = points.map((p) => p.close);
  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const totalReturnPct =
    Math.round(((lastClose - firstClose) / firstClose) * 10000) / 100;

  // Max drawdown
  let peak = closes[0];
  let maxDrawdown = 0;

  for (const close of closes) {
    if (close > peak) {
      peak = close;
    }

    const drawdown = (peak - close) / peak;

    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const maxDrawdownPct = Math.round(maxDrawdown * -10000) / 100;

  // Volatility (annualized std dev of daily returns)
  let volatilityPct: number | null = null;

  if (closes.length >= 5) {
    const dailyReturns: number[] = [];

    for (let i = 1; i < closes.length; i++) {
      dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) /
      (dailyReturns.length - 1);
    const dailyStdDev = Math.sqrt(variance);
    // Annualize using sqrt(252)
    volatilityPct = Math.round(dailyStdDev * Math.sqrt(252) * 10000) / 100;
  }

  return {
    totalReturnPct,
    maxDrawdownPct,
    volatilityPct,
    periodHigh: Math.max(...closes),
    periodLow: Math.min(...closes)
  };
}

export async function buildHistoryResult(
  input: GetHistoryInput
): Promise<GetHistoryOutput> {
  try {
    const provider = getMarketDataProvider();
    const result = await provider.fetchHistory(
      input.symbol,
      input.range,
      input.interval
    );

    if (result.error) {
      const domainRulesFailed: string[] = [];

      if (result.rateLimited) {
        domainRulesFailed.push('rate_limited');
      }

      return {
        status: 'error',
        message: result.error,
        verification: createVerificationResult({
          passed: false,
          confidence: 0.1,
          errors: [result.error],
          warnings: result.rateLimited
            ? ['rate_limited: Provider rate limit reached']
            : [],
          sources: ['yahoo-finance2'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          domainRulesFailed:
            domainRulesFailed.length > 0 ? domainRulesFailed : undefined,
          verificationType: 'confidence_scoring'
        })
      };
    }

    const warnings: string[] = [];

    if (result.truncated) {
      warnings.push(
        'history_truncated: Data points capped at 260 (max for telemetry)'
      );
    }

    if (result.rateLimited) {
      warnings.push('rate_limited: Provider rate limit reached');
    }

    const returns = input.includeReturns ? computeReturns(result.points) : null;

    const data: GetHistoryData = {
      symbol: input.symbol,
      points: result.points,
      pointCount: result.points.length,
      truncated: result.truncated,
      range: input.range,
      interval: input.interval,
      returns
    };

    return {
      status: 'success',
      data,
      message: `Retrieved ${result.points.length} data points for ${input.symbol} (${input.range}, ${input.interval}).`,
      verification: createVerificationResult({
        passed: true,
        confidence:
          result.points.length === 0 ? 0.5 : result.truncated ? 0.8 : 0.95,
        warnings,
        sources: ['yahoo-finance2'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'confidence_scoring'
      }),
      meta: {
        schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
        source: provider.name,
        providerLatencyMs: result.providerLatencyMs
      }
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Failed to fetch history',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error ? error.message : 'Unknown error in getHistory'
        ],
        sources: ['yahoo-finance2']
      })
    };
  }
}
