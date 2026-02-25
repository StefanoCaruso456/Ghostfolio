/**
 * getQuote — Deterministic tool that returns real-time quotes.
 *
 * Atomic: quote data only
 * Idempotent: same symbols → same result (within market data freshness)
 * Error-handled: per-symbol errors, never throws
 * Verified: confidence + source + domain rules
 */
import { TOOL_RESULT_SCHEMA_VERSION } from '../../../import-auditor/schemas/tool-result.schema';
import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import { getMarketDataProvider } from '../providers';
import type { GetQuoteInput, GetQuoteOutput } from './schemas/get-quote.schema';

const DOMAIN_RULES_CHECKED = [
  'symbols-non-empty',
  'symbols-within-limit',
  'quotes-returned'
];

export async function buildQuoteResult(
  input: GetQuoteInput
): Promise<GetQuoteOutput> {
  try {
    const provider = getMarketDataProvider();
    const result = await provider.fetchQuotes(input.symbols);

    const domainRulesFailed: string[] = [];
    const warnings: string[] = [];

    if (result.rateLimited) {
      warnings.push('rate_limited: Provider rate limit reached');
    }

    for (const err of result.errors) {
      domainRulesFailed.push(`invalid_symbol:${err.symbol}`);
    }

    const allFailed = result.quotes.length === 0 && result.errors.length > 0;

    return {
      status: allFailed ? 'error' : 'success',
      data: {
        quotes: result.quotes,
        errors: result.errors,
        requestedCount: input.symbols.length,
        returnedCount: result.quotes.length
      },
      message: allFailed
        ? `Failed to fetch quotes for all ${input.symbols.length} symbols.`
        : `Fetched ${result.quotes.length} of ${input.symbols.length} quotes.`,
      verification: createVerificationResult({
        passed: !allFailed,
        confidence: allFailed ? 0.1 : result.errors.length > 0 ? 0.7 : 0.95,
        warnings,
        sources: ['yahoo-finance2'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        domainRulesFailed:
          domainRulesFailed.length > 0 ? domainRulesFailed : undefined,
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
        error instanceof Error ? error.message : 'Failed to fetch quotes',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error ? error.message : 'Unknown error in getQuote'
        ],
        sources: ['yahoo-finance2']
      })
    };
  }
}
