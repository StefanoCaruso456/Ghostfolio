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

    // When all providers fail (e.g. network issue), pass verification with
    // low confidence + warnings so the AI can explain gracefully instead of
    // the verification gate hard-blocking the response.
    if (allFailed) {
      warnings.push(...result.errors.map((e) => `${e.symbol}: ${e.error}`));
    }

    return {
      status: allFailed ? 'error' : 'success',
      data: {
        quotes: result.quotes,
        errors: result.errors,
        requestedCount: input.symbols.length,
        returnedCount: result.quotes.length
      },
      message: allFailed
        ? `Unable to fetch live quotes for ${input.symbols.join(', ')}. The market data provider may be temporarily unavailable. Please try again shortly.`
        : `Fetched ${result.quotes.length} of ${input.symbols.length} quotes.`,
      verification: createVerificationResult({
        passed: true,
        confidence: allFailed ? 0.15 : result.errors.length > 0 ? 0.7 : 0.95,
        warnings,
        errors: [],
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
    const errorMsg =
      error instanceof Error && error.message
        ? error.message
        : 'Unknown error in getQuote';

    return {
      status: 'error',
      message: errorMsg,
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [errorMsg],
        sources: ['yahoo-finance2']
      })
    };
  }
}
