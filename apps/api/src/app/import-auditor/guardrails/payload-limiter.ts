/**
 * Payload Limiter — Reject oversized CSV inputs early.
 *
 * Prevents cost/time blowups from giant files.
 */

/** Max CSV payload size in bytes (5 MB) */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;

/** Max row count after parsing (10,000 rows) */
export const MAX_CSV_ROWS = 10_000;

export interface PayloadCheckResult {
  ok: boolean;
  reason?: string;
}

export function checkPayloadLimits(
  csvContent: string | undefined
): PayloadCheckResult {
  if (!csvContent) {
    return { ok: true };
  }

  const byteLength = Buffer.byteLength(csvContent, 'utf8');

  if (byteLength > MAX_CSV_BYTES) {
    return {
      ok: false,
      reason: `CSV payload is ${(byteLength / (1024 * 1024)).toFixed(1)} MB, exceeding the ${MAX_CSV_BYTES / (1024 * 1024)} MB limit`
    };
  }

  // Quick line count estimate (cheap pre-check before parsing)
  const lineCount = csvContent.split('\n').length;

  if (lineCount > MAX_CSV_ROWS + 1) {
    // +1 for header row
    return {
      ok: false,
      reason: `CSV has ~${lineCount} lines, exceeding the ${MAX_CSV_ROWS} row limit`
    };
  }

  return { ok: true };
}
