import type { GenerateImportPreviewOutput } from '../schemas/generate-import-preview.schema';
import type { MappedActivity } from '../schemas/validate-transactions.schema';
import { createVerificationResult } from '../schemas/verification.schema';

/**
 * Tool 5: Generate Import Preview
 *
 * Atomic: Single purpose — produce a summary preview before committing.
 * Idempotent: Same activities → same preview.
 * Documented: Outputs include summary stats, preview table, and commit decision.
 * Error-handled: Returns structured errors, never throws.
 * Verified: Human-in-the-loop escalation for large imports or mixed results.
 */

/** Threshold above which we flag as high-value and require review */
const HIGH_VALUE_THRESHOLD = 100_000;
const LARGE_BATCH_THRESHOLD = 50;

export function generateImportPreview(input: {
  validActivities: MappedActivity[];
  totalErrors: number;
  totalWarnings: number;
}): GenerateImportPreviewOutput {
  const { validActivities, totalErrors, totalWarnings } = input;

  if (!validActivities || validActivities.length === 0) {
    return {
      status: 'error',
      data: {
        summary: {
          totalActivities: 0,
          byType: {},
          byCurrency: {},
          uniqueSymbols: [],
          dateRange: { earliest: '', latest: '' },
          totalEstimatedValue: 0,
          previewTable: 'No valid activities to preview.'
        },
        canCommit: false,
        commitBlockedReason: 'No valid activities to import',
        previewErrors: totalErrors,
        previewWarnings: totalWarnings
      },
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: ['No valid activities to preview'],
        sources: ['import-preview-generator'],
        verificationType: 'domain_constraint'
      })
    };
  }

  // Count by type
  const byType: Record<string, number> = {};

  for (const a of validActivities) {
    const type = (a.type ?? 'UNKNOWN').toUpperCase();
    byType[type] = (byType[type] ?? 0) + 1;
  }

  // Count by currency
  const byCurrency: Record<string, number> = {};

  for (const a of validActivities) {
    const currency = (a.currency ?? 'UNKNOWN').toUpperCase();
    byCurrency[currency] = (byCurrency[currency] ?? 0) + 1;
  }

  // Unique symbols
  const uniqueSymbols = [
    ...new Set(
      validActivities
        .map((a) => a.symbol)
        .filter((s): s is string => s !== null && s !== undefined)
    )
  ].sort();

  // Date range
  const dates = validActivities
    .map((a) => a.date)
    .filter((d): d is string => d !== null && d !== undefined)
    .map((d) => new Date(d))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const dateRange = {
    earliest: dates[0]?.toISOString().split('T')[0] ?? 'N/A',
    latest: dates[dates.length - 1]?.toISOString().split('T')[0] ?? 'N/A'
  };

  // Estimated total value (quantity * unitPrice for BUY/SELL)
  let totalEstimatedValue = 0;

  for (const a of validActivities) {
    const qty = typeof a.quantity === 'number' ? a.quantity : 0;
    const price = typeof a.unitPrice === 'number' ? a.unitPrice : 0;
    totalEstimatedValue += qty * price;
  }

  // Build preview table (first 10 rows)
  const previewRows = validActivities.slice(0, 10);
  const tableHeader =
    '| # | Date | Symbol | Type | Qty | Price | Currency | Fee |';
  const tableSep =
    '|---|------|--------|------|-----|-------|----------|-----|';
  const tableRows = previewRows.map((a, i) => {
    return `| ${i + 1} | ${a.date ?? 'N/A'} | ${a.symbol ?? 'N/A'} | ${a.type ?? 'N/A'} | ${a.quantity ?? 0} | ${a.unitPrice ?? 0} | ${a.currency ?? 'N/A'} | ${a.fee ?? 0} |`;
  });

  let previewTable = [tableHeader, tableSep, ...tableRows].join('\n');

  if (validActivities.length > 10) {
    previewTable += `\n... and ${validActivities.length - 10} more rows`;
  }

  // Commit decision
  const canCommit = totalErrors === 0;
  const commitBlockedReason =
    totalErrors > 0
      ? `${totalErrors} validation error(s) must be resolved before import`
      : undefined;

  // Determine if human review is needed
  const isHighValue = totalEstimatedValue >= HIGH_VALUE_THRESHOLD;
  const isLargeBatch = validActivities.length >= LARGE_BATCH_THRESHOLD;
  const hasWarnings = totalWarnings > 0;
  const requiresHumanReview = isHighValue || isLargeBatch || hasWarnings;

  const escalationReasons: string[] = [];

  if (isHighValue) {
    escalationReasons.push(
      `High estimated value: $${totalEstimatedValue.toLocaleString()}`
    );
  }

  if (isLargeBatch) {
    escalationReasons.push(`Large batch: ${validActivities.length} activities`);
  }

  if (hasWarnings) {
    escalationReasons.push(`${totalWarnings} warning(s) present`);
  }

  const domainRulesChecked = [
    'batch-size-limit',
    'high-value-detection',
    'error-free-commit-gate'
  ];

  const domainRulesFailed: string[] = [];

  if (totalErrors > 0) {
    domainRulesFailed.push('error-free-commit-gate');
  }

  const confidence =
    totalErrors === 0
      ? totalWarnings === 0
        ? 1.0
        : Math.max(0.5, 1 - totalWarnings * 0.1)
      : 0;

  return {
    status: 'success',
    data: {
      summary: {
        totalActivities: validActivities.length,
        byType,
        byCurrency,
        uniqueSymbols,
        dateRange,
        totalEstimatedValue,
        previewTable
      },
      canCommit,
      commitBlockedReason,
      previewErrors: totalErrors,
      previewWarnings: totalWarnings
    },
    verification: createVerificationResult({
      passed: canCommit,
      confidence,
      warnings: escalationReasons,
      errors: commitBlockedReason ? [commitBlockedReason] : [],
      sources: ['import-preview-generator'],
      verificationType: 'domain_constraint',
      domainRulesChecked,
      domainRulesFailed,
      requiresHumanReview,
      escalationReason:
        escalationReasons.length > 0 ? escalationReasons.join('; ') : undefined
    })
  };
}
