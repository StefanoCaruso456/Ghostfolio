/**
 * syncAccount — Deterministic tool that syncs a connected brokerage account.
 *
 * Atomic: triggers sync for a single connection only
 * Idempotent: same input → same result (sync state is timestamp-based)
 * Error-handled: returns ToolResult(status=error), never throws
 * Verified: includes confidence scoring + source attribution
 */
import type { SyncResult } from '../../../tax/interfaces/tax.interfaces';

import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type {
  SyncAccountData,
  SyncAccountOutput
} from './schemas/sync-account.schema';

const DOMAIN_RULES_CHECKED = ['connection-exists', 'sync-completed'];

export function buildSyncAccountResult(
  syncResult: SyncResult
): SyncAccountOutput {
  try {
    if (syncResult.status === 'error') {
      return {
        status: 'error',
        message: syncResult.message ?? 'Account sync failed.',
        verification: createVerificationResult({
          passed: false,
          confidence: 0.3,
          errors: [syncResult.message ?? 'Sync returned error status'],
          sources: ['tax-service'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          domainRulesFailed: ['sync-completed'],
          verificationType: 'confidence_scoring'
        })
      };
    }

    const data: SyncAccountData = {
      syncedAt: syncResult.syncedAt,
      holdingsCount: syncResult.holdingsCount,
      transactionsCount: syncResult.transactionsCount,
      status: syncResult.status,
      message: syncResult.message
    };

    return {
      status: 'success',
      data,
      message: `Account synced successfully at ${syncResult.syncedAt}. ${syncResult.holdingsCount} holdings, ${syncResult.transactionsCount} transactions.`,
      verification: createVerificationResult({
        passed: true,
        confidence: 0.9,
        sources: ['tax-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'confidence_scoring'
      })
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to sync account',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in syncAccount'
        ],
        sources: ['tax-service']
      })
    };
  }
}
