import { isISO4217CurrencyCode } from 'class-validator';

import {
  MappedActivity,
  VALID_ACTIVITY_TYPES,
  ValidateTransactionsInput,
  ValidateTransactionsOutput,
  ValidationError
} from '../schemas/validate-transactions.schema';
import { createVerificationResult } from '../schemas/verification.schema';

const RULES_CHECKED = [
  'required-fields',
  'valid-activity-type',
  'numeric-invariants (fee >= 0, quantity >= 0, unitPrice >= 0)',
  'price-quantity-coherence',
  'date-validity (ISO 8601, after 1970, not future)',
  'currency-validity (3-char ISO 4217)',
  'batch-duplicate-detection'
];

export function validateTransactions(
  input: ValidateTransactionsInput
): ValidateTransactionsOutput {
  const { activities } = input;
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const validActivities: MappedActivity[] = [];

  for (const [index, activity] of activities.entries()) {
    const rowErrors: ValidationError[] = [];
    const rowWarnings: ValidationError[] = [];

    // Required fields check
    checkRequired(activity, index, rowErrors);

    // Type validation
    checkActivityType(activity, index, rowErrors);

    // Numeric invariants
    checkNumericInvariants(activity, index, rowErrors);

    // Price-quantity coherence
    checkPriceQuantityCoherence(activity, index, rowWarnings);

    // Date validation
    checkDate(activity, index, rowErrors);

    // Currency validation
    checkCurrency(activity, index, rowErrors);

    if (rowErrors.length === 0) {
      validActivities.push(activity);
    }

    errors.push(...rowErrors);
    warnings.push(...rowWarnings);
  }

  // Batch duplicate detection
  checkBatchDuplicates(activities, warnings);

  const totalProcessed = activities.length;
  const totalValid = validActivities.length;
  const totalErrors = errors.length;

  const status =
    totalErrors > 0
      ? 'fail'
      : warnings.length > 0
        ? 'warnings'
        : 'pass';

  const confidence =
    totalProcessed > 0 ? totalValid / totalProcessed : 0;

  return {
    status,
    data: {
      validActivities,
      errors,
      warnings,
      totalProcessed,
      totalValid,
      totalErrors
    },
    verification: createVerificationResult({
      passed: totalErrors === 0,
      confidence,
      warnings: warnings.map((w) => w.message),
      errors: errors.map((e) => e.message),
      sources: RULES_CHECKED
    })
  };
}

function checkRequired(
  activity: MappedActivity,
  row: number,
  errors: ValidationError[]
): void {
  const requiredFields: (keyof MappedActivity)[] = [
    'currency',
    'date',
    'fee',
    'quantity',
    'symbol',
    'type',
    'unitPrice'
  ];

  for (const field of requiredFields) {
    const value = activity[field];

    if (value === undefined || value === null || value === '') {
      errors.push({
        row,
        field,
        code: 'MISSING_REQUIRED_FIELD',
        message: `Row ${row}: "${field}" is required but missing or empty`,
        severity: 'error'
      });
    }
  }
}

function checkActivityType(
  activity: MappedActivity,
  row: number,
  errors: ValidationError[]
): void {
  if (!activity.type) {
    return; // Already caught by required check
  }

  const normalized = activity.type.toUpperCase().trim();

  if (
    !VALID_ACTIVITY_TYPES.includes(
      normalized as (typeof VALID_ACTIVITY_TYPES)[number]
    )
  ) {
    errors.push({
      row,
      field: 'type',
      code: 'INVALID_TYPE',
      message: `Row ${row}: type "${activity.type}" is not valid. Expected one of: ${VALID_ACTIVITY_TYPES.join(', ')}`,
      severity: 'error'
    });
  }
}

function checkNumericInvariants(
  activity: MappedActivity,
  row: number,
  errors: ValidationError[]
): void {
  if (activity.fee !== undefined && activity.fee !== null) {
    if (typeof activity.fee !== 'number' || activity.fee < 0) {
      errors.push({
        row,
        field: 'fee',
        code: 'NEGATIVE_VALUE',
        message: `Row ${row}: fee must be >= 0, got ${activity.fee}`,
        severity: 'error'
      });
    }
  }

  if (activity.quantity !== undefined && activity.quantity !== null) {
    if (
      typeof activity.quantity !== 'number' ||
      activity.quantity < 0
    ) {
      errors.push({
        row,
        field: 'quantity',
        code: 'NEGATIVE_VALUE',
        message: `Row ${row}: quantity must be >= 0, got ${activity.quantity}`,
        severity: 'error'
      });
    }
  }

  if (activity.unitPrice !== undefined && activity.unitPrice !== null) {
    if (
      typeof activity.unitPrice !== 'number' ||
      activity.unitPrice < 0
    ) {
      errors.push({
        row,
        field: 'unitPrice',
        code: 'NEGATIVE_VALUE',
        message: `Row ${row}: unitPrice must be >= 0, got ${activity.unitPrice}`,
        severity: 'error'
      });
    }
  }
}

function checkPriceQuantityCoherence(
  activity: MappedActivity,
  row: number,
  warnings: ValidationError[]
): void {
  if (!activity.type) {
    return;
  }

  const type = activity.type.toUpperCase().trim();

  if (type === 'BUY' || type === 'SELL') {
    if (
      activity.unitPrice !== undefined &&
      activity.unitPrice !== null &&
      activity.unitPrice === 0
    ) {
      warnings.push({
        row,
        field: 'unitPrice',
        code: 'PRICE_QUANTITY_COHERENCE',
        message: `Row ${row}: ${type} activity has unitPrice = 0`,
        severity: 'warning'
      });
    }

    if (
      activity.quantity !== undefined &&
      activity.quantity !== null &&
      activity.quantity === 0
    ) {
      warnings.push({
        row,
        field: 'quantity',
        code: 'PRICE_QUANTITY_COHERENCE',
        message: `Row ${row}: ${type} activity has quantity = 0`,
        severity: 'warning'
      });
    }
  }
}

function checkDate(
  activity: MappedActivity,
  row: number,
  errors: ValidationError[]
): void {
  if (!activity.date) {
    return; // Already caught by required check
  }

  const dateStr = String(activity.date);
  const parsed = new Date(dateStr);

  if (isNaN(parsed.getTime())) {
    errors.push({
      row,
      field: 'date',
      code: 'INVALID_DATE',
      message: `Row ${row}: date "${dateStr}" is not a valid date`,
      severity: 'error'
    });
    return;
  }

  const minDate = new Date('1970-01-01T00:00:00Z');

  if (parsed < minDate) {
    errors.push({
      row,
      field: 'date',
      code: 'INVALID_DATE',
      message: `Row ${row}: date "${dateStr}" is before 1970-01-01`,
      severity: 'error'
    });
    return;
  }

  const now = new Date();

  if (parsed > now) {
    errors.push({
      row,
      field: 'date',
      code: 'FUTURE_DATE',
      message: `Row ${row}: date "${dateStr}" is in the future`,
      severity: 'error'
    });
  }
}

function checkCurrency(
  activity: MappedActivity,
  row: number,
  errors: ValidationError[]
): void {
  if (!activity.currency) {
    return; // Already caught by required check
  }

  const currency = String(activity.currency).trim();

  if (currency.length !== 3) {
    errors.push({
      row,
      field: 'currency',
      code: 'INVALID_CURRENCY',
      message: `Row ${row}: currency "${currency}" must be a 3-character code`,
      severity: 'error'
    });
    return;
  }

  if (!isISO4217CurrencyCode(currency.toUpperCase())) {
    errors.push({
      row,
      field: 'currency',
      code: 'INVALID_CURRENCY',
      message: `Row ${row}: currency "${currency}" is not a valid ISO 4217 code`,
      severity: 'error'
    });
  }
}

function checkBatchDuplicates(
  activities: MappedActivity[],
  warnings: ValidationError[]
): void {
  const seen = new Map<string, number>();

  for (const [index, activity] of activities.entries()) {
    const key = [
      activity.symbol,
      activity.date,
      activity.type,
      activity.quantity,
      activity.unitPrice,
      activity.fee,
      activity.currency
    ].join('|');

    const previousIndex = seen.get(key);

    if (previousIndex !== undefined) {
      warnings.push({
        row: index,
        field: 'all',
        code: 'BATCH_DUPLICATE',
        message: `Row ${index}: identical to row ${previousIndex} in this batch`,
        severity: 'warning'
      });
    } else {
      seen.set(key, index);
    }
  }
}
