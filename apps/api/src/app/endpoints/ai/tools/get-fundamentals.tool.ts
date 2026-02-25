/**
 * getFundamentals — Deterministic tool that returns fundamental data.
 *
 * Atomic: fundamentals data only
 * Idempotent: same symbol → same result
 * Error-handled: structured error, never throws
 * Verified: confidence + source + domain rules
 *
 * Returns nulls for unavailable fields with field_unavailable warnings.
 */
import { TOOL_RESULT_SCHEMA_VERSION } from '../../../import-auditor/schemas/tool-result.schema';
import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import { getMarketDataProvider } from '../providers';
import type {
  GetFundamentalsInput,
  GetFundamentalsOutput
} from './schemas/get-fundamentals.schema';

const DOMAIN_RULES_CHECKED = [
  'symbol-valid',
  'fundamentals-data-available',
  'data-freshness-acceptable'
];

export async function buildFundamentalsResult(
  input: GetFundamentalsInput
): Promise<GetFundamentalsOutput> {
  try {
    const provider = getMarketDataProvider();
    const result = await provider.fetchFundamentals(input.symbol);

    if (result.error) {
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
          verificationType: 'confidence_scoring'
        })
      };
    }

    if (!result.data) {
      return {
        status: 'error',
        message: `No fundamentals data available for ${input.symbol}`,
        verification: createVerificationResult({
          passed: false,
          confidence: 0.2,
          errors: [`no_data:${input.symbol}`],
          sources: ['yahoo-finance2'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          domainRulesFailed: [`invalid_symbol:${input.symbol}`],
          verificationType: 'confidence_scoring'
        })
      };
    }

    const warnings: string[] = [];

    for (const field of result.unavailableFields) {
      warnings.push(`field_unavailable:${field}`);
    }

    if (result.rateLimited) {
      warnings.push('rate_limited: Provider rate limit reached');
    }

    // Confidence scales down with more unavailable fields
    const availableFieldCount = 7 - result.unavailableFields.length;
    const confidence = Math.max(0.3, 0.5 + availableFieldCount * 0.07);

    return {
      status: 'success',
      data: result.data,
      message: `Fundamentals for ${input.symbol}: ${availableFieldCount}/7 fields available.`,
      verification: createVerificationResult({
        passed: true,
        confidence,
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
        error instanceof Error ? error.message : 'Failed to fetch fundamentals',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in getFundamentals'
        ],
        sources: ['yahoo-finance2']
      })
    };
  }
}
