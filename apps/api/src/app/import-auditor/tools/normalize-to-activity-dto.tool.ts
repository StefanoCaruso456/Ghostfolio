import {
  ActivityImportDTO,
  ActivityImportDTOSchema,
  VALID_IMPORT_TYPES,
  ValidImportType
} from '../schemas/activity-import-dto.schema';
import type { MappedActivity } from '../schemas/validate-transactions.schema';
import { createVerificationResult } from '../schemas/verification.schema';

/**
 * Tool 6: Normalize to ActivityImportDTO
 *
 * Sits between validateTransactions and generateImportPreview.
 * Takes validated MappedActivity[] and produces strict ActivityImportDTO[].
 *
 * Normalization rules:
 * 1. Type: uppercase + alias resolution (buy→BUY, sell→SELL, etc.)
 * 2. Date: coerce to ISO YYYY-MM-DD
 * 3. Numerics: coerce strings to numbers, enforce >= 0
 * 4. Currency: uppercase 3-char
 * 5. AccountId: injected from external context if provided
 *
 * Atomic: single purpose — normalize to DTO.
 * Idempotent: same input → same output.
 * Deterministic: no external calls, no randomness.
 */

// ─── Type Alias Map ──────────────────────────────────────────────────

const TYPE_ALIASES: Record<string, ValidImportType> = {
  // Standard
  BUY: 'BUY',
  SELL: 'SELL',
  DIVIDEND: 'DIVIDEND',
  FEE: 'FEE',
  INTEREST: 'INTEREST',
  LIABILITY: 'LIABILITY',
  // Common CSV variations
  buy: 'BUY',
  sell: 'SELL',
  dividend: 'DIVIDEND',
  fee: 'FEE',
  interest: 'INTEREST',
  liability: 'LIABILITY',
  // Broker-specific aliases
  'Market buy': 'BUY',
  'Market sell': 'SELL',
  'Limit buy': 'BUY',
  'Limit sell': 'SELL',
  PURCHASE: 'BUY',
  Purchase: 'BUY',
  SALE: 'SELL',
  Sale: 'SELL',
  DIV: 'DIVIDEND',
  Div: 'DIVIDEND',
  COMMISSION: 'FEE',
  Commission: 'FEE'
};

// ─── Output Types ────────────────────────────────────────────────────

export interface NormalizeResult {
  status: 'success' | 'partial' | 'error';
  data: {
    dtos: ActivityImportDTO[];
    normalizationErrors: NormalizationError[];
    totalInput: number;
    totalNormalized: number;
    totalFailed: number;
  };
  verification: ReturnType<typeof createVerificationResult>;
}

export interface NormalizationError {
  row: number;
  field: string;
  message: string;
}

// ─── Main Function ───────────────────────────────────────────────────

export function normalizeToActivityDTO(input: {
  activities: MappedActivity[];
  accountId?: string;
}): NormalizeResult {
  const { activities, accountId } = input;

  if (!activities || activities.length === 0) {
    return {
      status: 'error',
      data: {
        dtos: [],
        normalizationErrors: [],
        totalInput: 0,
        totalNormalized: 0,
        totalFailed: 0
      },
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: ['No activities to normalize'],
        sources: ['normalize-to-activity-dto']
      })
    };
  }

  const dtos: ActivityImportDTO[] = [];
  const normalizationErrors: NormalizationError[] = [];

  for (const [index, activity] of activities.entries()) {
    // 1. Normalize type
    const rawType = (activity.type ?? '').trim();
    const normalizedType = resolveType(rawType);

    if (!normalizedType) {
      normalizationErrors.push({
        row: index,
        field: 'type',
        message: `Cannot normalize type "${rawType}" to a valid import type`
      });
      continue;
    }

    // 2. Normalize date to YYYY-MM-DD
    const normalizedDate = normalizeDate(activity.date);

    if (!normalizedDate) {
      normalizationErrors.push({
        row: index,
        field: 'date',
        message: `Cannot normalize date "${activity.date}" to YYYY-MM-DD`
      });
      continue;
    }

    // 3. Coerce numerics
    const fee = coerceNonNegativeNumber(activity.fee);
    const quantity = coerceNonNegativeNumber(activity.quantity);
    const unitPrice = coerceNonNegativeNumber(activity.unitPrice);

    // 4. Normalize currency
    const currency = (activity.currency ?? '').trim().toUpperCase();

    // 5. Build candidate DTO
    const candidate = {
      type: normalizedType,
      symbol: (activity.symbol ?? '').trim(),
      date: normalizedDate,
      quantity,
      unitPrice,
      fee,
      currency,
      accountId: accountId ?? undefined,
      dataSource: activity.dataSource ?? undefined,
      comment: activity.comment ?? undefined
    };

    // 6. Validate against canonical schema
    const parsed = ActivityImportDTOSchema.safeParse(candidate);

    if (parsed.success) {
      dtos.push(parsed.data);
    } else {
      const issues = parsed.error.issues.map((i) => i.message).join('; ');
      normalizationErrors.push({
        row: index,
        field: 'dto_validation',
        message: `DTO validation failed for row ${index}: ${issues}`
      });
    }
  }

  const totalInput = activities.length;
  const totalNormalized = dtos.length;
  const totalFailed = normalizationErrors.length;

  const status =
    totalFailed === 0 ? 'success' : totalNormalized > 0 ? 'partial' : 'error';

  const confidence = totalInput > 0 ? totalNormalized / totalInput : 0;

  return {
    status,
    data: {
      dtos,
      normalizationErrors,
      totalInput,
      totalNormalized,
      totalFailed
    },
    verification: createVerificationResult({
      passed: totalFailed === 0,
      confidence,
      warnings: normalizationErrors.map((e) => e.message),
      errors:
        totalNormalized === 0
          ? ['All activities failed DTO normalization']
          : [],
      sources: ['normalize-to-activity-dto'],
      domainRulesChecked: [
        'type-normalization',
        'date-iso-format',
        'numeric-coercion',
        'currency-uppercase',
        'dto-schema-validation'
      ],
      domainRulesFailed: totalFailed > 0 ? ['dto-schema-validation'] : []
    })
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function resolveType(raw: string): ValidImportType | null {
  // Direct alias lookup
  if (raw in TYPE_ALIASES) {
    return TYPE_ALIASES[raw];
  }

  // Uppercase fallback
  const upper = raw.toUpperCase().trim();

  if (VALID_IMPORT_TYPES.includes(upper as ValidImportType)) {
    return upper as ValidImportType;
  }

  return null;
}

/**
 * Normalize various date formats to YYYY-MM-DD.
 * Handles: ISO 8601 (with or without time), DD-MM-YYYY, MM/DD/YYYY, YYYYMMDD.
 */
function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return isValidDate(trimmed) ? trimmed : null;
  }

  // ISO 8601 with time component (e.g., 2023-01-15T00:00:00.000Z)
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const datePart = trimmed.split('T')[0];
    return isValidDate(datePart) ? datePart : null;
  }

  // YYYYMMDD (e.g., Interactive Brokers format)
  if (/^\d{8}$/.test(trimmed)) {
    const y = trimmed.slice(0, 4);
    const m = trimmed.slice(4, 6);
    const d = trimmed.slice(6, 8);
    const candidate = `${y}-${m}-${d}`;
    return isValidDate(candidate) ? candidate : null;
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const ddmmyyyy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(trimmed);

  if (ddmmyyyy) {
    const d = ddmmyyyy[1].padStart(2, '0');
    const m = ddmmyyyy[2].padStart(2, '0');
    const y = ddmmyyyy[3];
    const candidate = `${y}-${m}-${d}`;
    return isValidDate(candidate) ? candidate : null;
  }

  // Fallback: try Date constructor
  const parsed = new Date(trimmed);

  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

function isValidDate(yyyymmdd: string): boolean {
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().startsWith(yyyymmdd);
}

function coerceNonNegativeNumber(
  value: number | string | null | undefined
): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'number') {
    return Math.max(0, value);
  }

  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? 0 : Math.max(0, parsed);
}
