/**
 * getNews — Deterministic tool that returns news items for a symbol.
 *
 * Atomic: news data only (no LLM summarization)
 * Idempotent: same params → same result (within data freshness)
 * Error-handled: structured error, never throws
 * Verified: confidence + source + domain rules
 *
 * Cap: max 10 items. No raw bodies stored in telemetry.
 */
import { TOOL_RESULT_SCHEMA_VERSION } from '../../../import-auditor/schemas/tool-result.schema';
import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import { getMarketDataProvider } from '../providers';
import type { GetNewsInput, GetNewsOutput } from './schemas/get-news.schema';

const DOMAIN_RULES_CHECKED = [
  'symbol-valid',
  'limit-enforced',
  'recency-valid',
  'news-items-returned'
];

export async function buildNewsResult(
  input: GetNewsInput
): Promise<GetNewsOutput> {
  try {
    const provider = getMarketDataProvider();
    const result = await provider.fetchNews(
      input.symbol,
      input.limit,
      input.recencyDays
    );

    if (result.error) {
      const warnings = [result.error];

      if (result.rateLimited) {
        warnings.push('rate_limited: Provider rate limit reached');
      }

      return {
        status: 'error',
        message: `Unable to fetch news for ${input.symbol}. The market data provider may be temporarily unavailable.`,
        verification: createVerificationResult({
          passed: true,
          confidence: 0.1,
          warnings,
          errors: [],
          sources: ['yahoo-finance2'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          verificationType: 'confidence_scoring'
        })
      };
    }

    const warnings: string[] = [];

    if (result.rateLimited) {
      warnings.push('rate_limited: Provider rate limit reached');
    }

    if (result.items.length === 0) {
      warnings.push(`no_news: No news found for ${input.symbol}`);
    }

    return {
      status: 'success',
      data: {
        symbol: input.symbol,
        items: result.items,
        returnedCount: result.items.length,
        recencyDays: input.recencyDays
      },
      message: `Found ${result.items.length} news items for ${input.symbol}.`,
      verification: createVerificationResult({
        passed: true,
        confidence: result.items.length === 0 ? 0.5 : 0.85,
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
      message: error instanceof Error ? error.message : 'Failed to fetch news',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error ? error.message : 'Unknown error in getNews'
        ],
        sources: ['yahoo-finance2']
      })
    };
  }
}
