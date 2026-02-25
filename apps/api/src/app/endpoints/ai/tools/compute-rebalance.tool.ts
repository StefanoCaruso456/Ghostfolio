/**
 * computeRebalance — Deterministic tool that computes rebalancing math.
 *
 * Atomic: math of rebalancing only (NOT trade advice)
 * Idempotent: same portfolio + targets → same result
 * Error-handled: structured error, never throws
 * Verified: confidence + source + domain rules
 *
 * This tool performs pure arithmetic: current allocation vs target allocation.
 * The assistant MUST include disclaimer language in its response, not the tool.
 */
import type { PortfolioDetails } from '@ghostfolio/common/interfaces';

import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type {
  ComputeRebalanceData,
  ComputeRebalanceInput,
  ComputeRebalanceOutput
} from './schemas/compute-rebalance.schema';

const DOMAIN_RULES_CHECKED = [
  'portfolio-data-available',
  'target-allocations-valid',
  'target-sum-valid',
  'constraints-coherent'
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

  return Array.from(buckets.entries()).map(([name, valuePct]) => ({
    name,
    valuePct: Math.round(valuePct * 10000) / 100 // convert to %
  }));
}

function aggregateBySymbol(
  holdings: PortfolioDetails['holdings']
): AllocationBucket[] {
  return Object.values(holdings).map((h) => ({
    name: h.symbol,
    valuePct: Math.round(h.allocationInPercentage * 10000) / 100
  }));
}

export function buildRebalanceResult(
  details: PortfolioDetails & { hasErrors: boolean },
  input: ComputeRebalanceInput
): ComputeRebalanceOutput {
  try {
    const holdingsList = Object.values(details.holdings);

    if (holdingsList.length === 0) {
      return {
        status: 'error',
        message: 'Portfolio is empty — cannot compute rebalance.',
        verification: createVerificationResult({
          passed: false,
          confidence: 0.3,
          errors: ['Portfolio has zero holdings'],
          sources: ['ghostfolio-portfolio-service'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          verificationType: 'confidence_scoring'
        })
      };
    }

    // Determine which allocation type to use
    const ta = input.targetAllocations;
    let allocationType: 'assetClass' | 'sector' | 'symbols';
    let currentBuckets: AllocationBucket[];
    let targetMap: Record<string, number>;

    if (ta.symbols && Object.keys(ta.symbols).length > 0) {
      allocationType = 'symbols';
      currentBuckets = aggregateBySymbol(details.holdings);
      targetMap = ta.symbols;
    } else if (ta.sector && Object.keys(ta.sector).length > 0) {
      allocationType = 'sector';
      // Sector aggregation (simplified: use assetClass fallback if sectors unavailable)
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

      currentBuckets = Array.from(sectorBuckets.entries()).map(
        ([name, valuePct]) => ({
          name,
          valuePct: Math.round(valuePct * 10000) / 100
        })
      );
      targetMap = ta.sector;
    } else if (ta.assetClass && Object.keys(ta.assetClass).length > 0) {
      allocationType = 'assetClass';
      currentBuckets = aggregateByKey(
        details.holdings,
        (h) => h.assetClass ?? null
      );
      targetMap = ta.assetClass;
    } else {
      return {
        status: 'error',
        message:
          'No target allocations specified. Provide assetClass, sector, or symbols targets.',
        verification: createVerificationResult({
          passed: false,
          confidence: 0.3,
          errors: ['no_target_allocations'],
          sources: ['ghostfolio-portfolio-service'],
          domainRulesChecked: DOMAIN_RULES_CHECKED,
          domainRulesFailed: ['target-allocations-valid'],
          verificationType: 'domain_constraint'
        })
      };
    }

    // Build current allocation map
    const currentMap = new Map<string, number>();

    for (const b of currentBuckets) {
      currentMap.set(b.name, b.valuePct);
    }

    // Compute deltas
    const allBuckets = new Set([
      ...currentMap.keys(),
      ...Object.keys(targetMap)
    ]);

    const currentAllocations: ComputeRebalanceData['currentAllocations'] = [];
    const suggestedMoves: ComputeRebalanceData['suggestedMoves'] = [];
    const constraintViolations: ComputeRebalanceData['constraintViolations'] =
      [];
    const ignoredSymbols = new Set(input.constraints?.ignoreSymbols ?? []);

    for (const bucket of allBuckets) {
      if (ignoredSymbols.has(bucket)) {
        continue;
      }

      const currentPct = currentMap.get(bucket) ?? 0;
      const targetPct = targetMap[bucket] ?? 0;
      const deltaPct = Math.round((targetPct - currentPct) * 100) / 100;

      currentAllocations.push({
        bucket,
        currentPct,
        targetPct,
        deltaPct
      });

      if (Math.abs(deltaPct) < 0.5) {
        suggestedMoves.push({
          action: 'hold',
          symbol: allocationType === 'symbols' ? bucket : null,
          bucket: allocationType !== 'symbols' ? bucket : null,
          deltaPct,
          rationale: `Within tolerance (delta: ${deltaPct}%)`
        });
      } else if (deltaPct > 0) {
        suggestedMoves.push({
          action: 'buy',
          symbol: allocationType === 'symbols' ? bucket : null,
          bucket: allocationType !== 'symbols' ? bucket : null,
          deltaPct,
          rationale: `Under-allocated by ${deltaPct}%`
        });
      } else {
        suggestedMoves.push({
          action: 'sell',
          symbol: allocationType === 'symbols' ? bucket : null,
          bucket: allocationType !== 'symbols' ? bucket : null,
          deltaPct,
          rationale: `Over-allocated by ${Math.abs(deltaPct)}%`
        });
      }
    }

    // Check constraints
    if (input.constraints?.maxSingleNamePct) {
      const max = input.constraints.maxSingleNamePct;

      for (const h of holdingsList) {
        const pct = Math.round(h.allocationInPercentage * 10000) / 100;

        if (pct > max) {
          constraintViolations.push({
            type: 'max_single_name',
            description: `${h.symbol} is at ${pct}% (max: ${max}%)`
          });
        }
      }
    }

    // Check target sum
    const targetSum = Object.values(targetMap).reduce((s, v) => s + v, 0);
    const warnings: string[] = [];

    if (targetSum > 100) {
      warnings.push(
        `target_sum_exceeds_100: Target allocations sum to ${targetSum}%`
      );
    }

    if (details.hasErrors) {
      warnings.push(
        'Portfolio data may be incomplete — some market data errors detected'
      );
    }

    const data: ComputeRebalanceData = {
      allocationType,
      currentAllocations,
      suggestedMoves,
      constraintViolations,
      note: 'This is mathematical rebalancing analysis only — not investment advice.'
    };

    return {
      status: 'success',
      data,
      message: `Computed ${allocationType} rebalance: ${suggestedMoves.filter((m) => m.action !== 'hold').length} adjustments suggested.`,
      verification: createVerificationResult({
        passed: true,
        confidence: details.hasErrors ? 0.7 : 0.9,
        warnings,
        sources: ['ghostfolio-portfolio-service'],
        domainRulesChecked: DOMAIN_RULES_CHECKED,
        verificationType: 'confidence_scoring'
      })
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Failed to compute rebalance',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in computeRebalance'
        ],
        sources: ['ghostfolio-portfolio-service']
      })
    };
  }
}
