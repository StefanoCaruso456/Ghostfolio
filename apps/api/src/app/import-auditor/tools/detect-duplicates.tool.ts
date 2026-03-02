import { isSameSecond, parseISO } from 'date-fns';

import {
  DetectDuplicatesInput,
  DetectDuplicatesOutput,
  DuplicatePair,
  ExistingActivity
} from '../schemas/detect-duplicates.schema';
import type { MappedActivity } from '../schemas/validate-transactions.schema';
import { createVerificationResult } from '../schemas/verification.schema';

function buildBatchCompositeKey(activity: MappedActivity): string {
  return [
    activity.symbol ?? '',
    activity.date ?? '',
    activity.type ?? '',
    activity.quantity ?? '',
    activity.unitPrice ?? '',
    activity.fee ?? '',
    activity.currency ?? ''
  ].join('|');
}

function buildDbCompositeKey(activity: MappedActivity): string {
  return [
    activity.symbol ?? '',
    activity.date ?? '',
    activity.type ?? '',
    activity.quantity ?? '',
    activity.unitPrice ?? '',
    activity.fee ?? '',
    activity.currency ?? ''
  ].join('|');
}

function isDbDuplicate(
  incoming: MappedActivity,
  existing: ExistingActivity
): boolean {
  if (!incoming.symbol || !incoming.date || !incoming.type) {
    return false;
  }

  if (incoming.symbol !== existing.symbol) {
    return false;
  }

  if ((incoming.type ?? '').toUpperCase() !== existing.type.toUpperCase()) {
    return false;
  }

  // Compare dates using isSameSecond (matching import.service.ts pattern)
  try {
    const incomingDate = parseISO(incoming.date);
    const existingDate = parseISO(existing.date);

    if (!isSameSecond(incomingDate, existingDate)) {
      return false;
    }
  } catch {
    return false;
  }

  if (
    incoming.quantity != null &&
    existing.quantity != null &&
    incoming.quantity !== existing.quantity
  ) {
    return false;
  }

  if (
    incoming.unitPrice != null &&
    existing.unitPrice != null &&
    incoming.unitPrice !== existing.unitPrice
  ) {
    return false;
  }

  if (
    incoming.fee != null &&
    existing.fee != null &&
    incoming.fee !== existing.fee
  ) {
    return false;
  }

  if (
    incoming.currency != null &&
    existing.currency != null &&
    incoming.currency !== existing.currency
  ) {
    return false;
  }

  return true;
}

export function detectDuplicates(
  input: DetectDuplicatesInput
): DetectDuplicatesOutput {
  const { activities, existingActivities = [] } = input;

  if (!activities || activities.length === 0) {
    return {
      status: 'error',
      data: {
        duplicates: [],
        cleanActivities: [],
        totalChecked: 0,
        batchDuplicatesFound: 0,
        databaseDuplicatesFound: 0
      },
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: ['No activities provided for duplicate detection'],
        sources: ['duplicate-detection']
      })
    };
  }

  const duplicates: DuplicatePair[] = [];
  const duplicateIndices = new Set<number>();

  // Tier 1: Batch duplicate detection (within CSV)
  const batchSeen = new Map<string, number>();

  for (const [index, activity] of activities.entries()) {
    const key = buildBatchCompositeKey(activity);
    const previousIndex = batchSeen.get(key);

    if (previousIndex !== undefined) {
      duplicates.push({
        csvRowIndex: index,
        matchType: 'batch',
        matchedWith: { csvRowIndex: previousIndex },
        confidence: 1.0,
        compositeKey: key
      });
      duplicateIndices.add(index);
    } else {
      batchSeen.set(key, index);
    }
  }

  // Tier 2: Database duplicate detection (against existing activities)
  let databaseDuplicatesFound = 0;

  if (existingActivities.length > 0) {
    for (const [index, activity] of activities.entries()) {
      if (duplicateIndices.has(index)) {
        continue;
      }

      const matchIndex = existingActivities.findIndex((existing) =>
        isDbDuplicate(activity, existing)
      );

      if (matchIndex !== -1) {
        duplicates.push({
          csvRowIndex: index,
          matchType: 'database',
          matchedWith: { existingActivityIndex: matchIndex },
          confidence: 0.95,
          compositeKey: buildDbCompositeKey(activity)
        });
        duplicateIndices.add(index);
        databaseDuplicatesFound++;
      }
    }
  }

  const batchDuplicatesFound = duplicates.filter(
    (d) => d.matchType === 'batch'
  ).length;

  const cleanActivities = activities.filter(
    (_, idx) => !duplicateIndices.has(idx)
  );

  const totalDuplicates = duplicates.length;
  const status = totalDuplicates === 0 ? 'clean' : 'duplicates_found';

  const warnings = duplicates.map((d) => {
    if (d.matchType === 'batch') {
      const matched = d.matchedWith as { csvRowIndex: number };
      return `Row ${d.csvRowIndex} is a batch duplicate of row ${matched.csvRowIndex}`;
    }

    const matched = d.matchedWith as { existingActivityIndex: number };
    return `Row ${d.csvRowIndex} matches existing activity at index ${matched.existingActivityIndex}`;
  });

  return {
    status,
    data: {
      duplicates,
      cleanActivities,
      totalChecked: activities.length,
      batchDuplicatesFound,
      databaseDuplicatesFound
    },
    verification: createVerificationResult({
      passed: totalDuplicates === 0,
      confidence:
        totalDuplicates === 0
          ? 1.0
          : cleanActivities.length / activities.length,
      warnings,
      sources:
        existingActivities.length > 0
          ? ['batch-duplicate-detection', 'database-duplicate-detection']
          : ['batch-duplicate-detection']
    })
  };
}
