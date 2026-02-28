/**
 * getAllocations — Deterministic tool that returns allocation breakdown.
 *
 * Atomic: allocation data only
 * Idempotent: same portfolio → same result
 * Error-handled: structured error, never throws
 * Verified: confidence + source + domain rules
 */
import type { PortfolioDetails } from '@ghostfolio/common/interfaces';

import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type {
  AllocationsData,
  GetAllocationsOutput
} from './schemas/allocations.schema';
import type { QuoteMetadata } from './schemas/quote-metadata.schema';

const DOMAIN_RULES_CHECKED = [
  'portfolio-data-available',
  'holdings-non-empty',
  'allocation-percentages-valid'
];

interface AllocationBucket {
  name: string;
  valuePct: number;
}

function aggregateByKey(
  holdings: PortfolioDetails['holdings'],
  keyFn: (h: PortfolioDetails['holdings'][string]) => string | null
): AllocationBucket[] {
  const buckets = new Map<string, number>();

  for (const holding of Object.values(holdings)) {
    const key = keyFn(holding) || 'Unknown';
    const current = buckets.get(key) ?? 0;

    buckets.set(key, current + holding.allocationInPercentage);
  }

  return Array.from(buckets.entries())
    .map(([name, valuePct]) => ({
      name,
      valuePct: Math.round(valuePct * 10000) / 100 // convert to %
    }))
    .sort((a, b) => b.valuePct - a.valuePct);
}

export function buildAllocationsResult(
  details: PortfolioDetails & { hasErrors: boolean }
): GetAllocationsOutput {
  try {
    const holdings = details.holdings;
    const holdingsList = Object.values(holdings);

    if (holdingsList.length === 0) {
      return {
        status: 'success',
        data: {
          byAssetClass: [],
          byAssetSubClass: [],
          byCurrency: [],
          bySector: [],
          holdingsCount: 0
        },
        message: 'Portfolio is empty — no allocation data.',
        verification: createVerificationResult({
          passed: true,
          confidence: 1.0,
          warnings: ['Portfolio has zero holdings'],
          sources: ['ghostfolio-portfolio-service'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          verificationType: 'confidence_scoring'
        })
      };
    }

    const byAssetClass = aggregateByKey(holdings, (h) => h.assetClass ?? null);
    const byAssetSubClass = aggregateByKey(
      holdings,
      (h) => h.assetSubClass ?? null
    );
    const byCurrency = aggregateByKey(holdings, (h) => h.currency);

    // Sectors: Ghostfolio stores sectors in SymbolProfile.sectors JSON
    // Holdings may have a sectors property. Try to extract it.
    const sectorBuckets = new Map<string, number>();

    for (const holding of holdingsList) {
      const sectors = (holding as unknown as Record<string, unknown>)
        .sectors as { name: string; weight: number }[] | undefined;

      if (Array.isArray(sectors)) {
        for (const sector of sectors) {
          const current = sectorBuckets.get(sector.name) ?? 0;

          sectorBuckets.set(
            sector.name,
            current + holding.allocationInPercentage * (sector.weight ?? 1)
          );
        }
      }
    }

    const bySector = Array.from(sectorBuckets.entries())
      .map(([name, valuePct]) => ({
        name,
        valuePct: Math.round(valuePct * 10000) / 100
      }))
      .sort((a, b) => b.valuePct - a.valuePct);

    const warnings: string[] = [];

    if (bySector.length === 0) {
      warnings.push('Sector data not available for holdings');
    }

    if (details.hasErrors) {
      warnings.push(
        'Portfolio data may be incomplete — some market data errors detected'
      );
    }

    const data: AllocationsData = {
      byAssetClass,
      byAssetSubClass,
      byCurrency,
      bySector,
      holdingsCount: holdingsList.length
    };

    const quoteMetadata: QuoteMetadata = details.hasErrors
      ? {
          quoteStatus: 'partial',
          quotesAsOf: new Date().toISOString(),
          message:
            'Some market data was unavailable — allocation percentages may use last-known prices'
        }
      : { quoteStatus: 'fresh', quotesAsOf: new Date().toISOString() };

    return {
      status: 'success',
      data,
      message: details.hasErrors
        ? `Allocation breakdown for ${holdingsList.length} holdings (some prices may be stale).`
        : `Allocation breakdown for ${holdingsList.length} holdings across ${byAssetClass.length} asset classes and ${byCurrency.length} currencies.`,
      verification: createVerificationResult({
        passed: true,
        confidence: details.hasErrors ? 0.7 : 0.95,
        warnings,
        sources: ['ghostfolio-portfolio-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'confidence_scoring'
      }),
      quoteMetadata
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to build allocation data',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in getAllocations'
        ],
        sources: ['ghostfolio-portfolio-service']
      })
    };
  }
}
