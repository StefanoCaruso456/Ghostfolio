/**
 * scenarioImpact — Deterministic tool that computes portfolio shock impact.
 *
 * Atomic: arithmetic shock analysis only (no predictions)
 * Idempotent: same portfolio + shocks → same result
 * Error-handled: structured error, never throws
 * Verified: confidence + source + domain rules
 *
 * This is deterministic arithmetic using current allocations.
 * It applies percentage shocks to matching holdings/buckets and computes
 * the estimated portfolio-level impact.
 */
import type { PortfolioDetails } from '@ghostfolio/common/interfaces';

import { createVerificationResult } from '../../../import-auditor/schemas/verification.schema';
import type {
  ScenarioImpactData,
  ScenarioImpactInput,
  ScenarioImpactOutput
} from './schemas/scenario-impact.schema';

const DOMAIN_RULES_CHECKED = [
  'portfolio-data-available',
  'shocks-valid',
  'holdings-non-empty',
  'shock-mappings-resolved'
];

export function buildScenarioImpactResult(
  details: PortfolioDetails & { hasErrors: boolean },
  input: ScenarioImpactInput
): ScenarioImpactOutput {
  try {
    const holdingsList = Object.values(details.holdings);

    if (holdingsList.length === 0) {
      return {
        status: 'error',
        message: 'Portfolio is empty — cannot compute scenario impact.',
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

    // Build lookup maps for matching shocks to holdings
    const holdingBySymbol = new Map<
      string,
      { symbol: string; allocationPct: number }
    >();

    const holdingsByAssetClass = new Map<string, number>();
    const holdingsBySector = new Map<string, number>();

    for (const h of holdingsList) {
      const pct = Math.round(h.allocationInPercentage * 10000) / 100;

      holdingBySymbol.set(h.symbol.toUpperCase(), {
        symbol: h.symbol,
        allocationPct: pct
      });

      // Asset class
      const ac = h.assetClass ?? 'Unknown';
      holdingsByAssetClass.set(
        ac.toLowerCase(),
        (holdingsByAssetClass.get(ac.toLowerCase()) ?? 0) + pct
      );

      // Sector aggregation
      const sectors = (h as unknown as Record<string, unknown>).sectors as
        | { name: string; weight: number }[]
        | undefined;

      if (Array.isArray(sectors)) {
        for (const sector of sectors) {
          const key = sector.name.toLowerCase();
          const contribution = pct * (sector.weight ?? 1);

          holdingsBySector.set(
            key,
            (holdingsBySector.get(key) ?? 0) + contribution
          );
        }
      }
    }

    const impactByBucket: ScenarioImpactData['estimatedImpactByBucket'] = [];
    const missingMappings: string[] = [];
    const assumptions: string[] = [
      'Linear shock model: portfolio impact = allocation% x shock%',
      `Horizon label: ${input.horizon} (informational — no time-decay modeled)`
    ];

    if (input.assumeCashStable) {
      assumptions.push('Cash positions assumed stable (unaffected by shocks)');
    }

    let totalPortfolioImpactPct = 0;

    for (const shock of input.shocks) {
      const key = shock.symbolOrBucket;
      const keyUpper = key.toUpperCase();
      const keyLower = key.toLowerCase();
      let matched = false;

      // Try symbol match first
      const symbolMatch = holdingBySymbol.get(keyUpper);

      if (symbolMatch) {
        const impact =
          Math.round(symbolMatch.allocationPct * (shock.shockPct / 100) * 100) /
          100;

        impactByBucket.push({
          name: symbolMatch.symbol,
          currentPct: symbolMatch.allocationPct,
          shockPct: shock.shockPct,
          impactOnPortfolioPct: impact
        });
        totalPortfolioImpactPct += impact;
        matched = true;
      }

      // Try asset class match
      if (!matched && holdingsByAssetClass.has(keyLower)) {
        const allocationPct = holdingsByAssetClass.get(keyLower)!;
        const impact =
          Math.round(allocationPct * (shock.shockPct / 100) * 100) / 100;

        impactByBucket.push({
          name: key,
          currentPct: allocationPct,
          shockPct: shock.shockPct,
          impactOnPortfolioPct: impact
        });
        totalPortfolioImpactPct += impact;
        matched = true;
      }

      // Try sector match
      if (!matched && holdingsBySector.has(keyLower)) {
        const allocationPct = holdingsBySector.get(keyLower)!;
        const impact =
          Math.round(allocationPct * (shock.shockPct / 100) * 100) / 100;

        impactByBucket.push({
          name: key,
          currentPct: allocationPct,
          shockPct: shock.shockPct,
          impactOnPortfolioPct: impact
        });
        totalPortfolioImpactPct += impact;
        matched = true;
      }

      if (!matched) {
        missingMappings.push(key);
      }
    }

    totalPortfolioImpactPct = Math.round(totalPortfolioImpactPct * 100) / 100;

    const warnings: string[] = [];

    if (missingMappings.length > 0) {
      warnings.push(
        `unmapped_shocks: Could not map ${missingMappings.join(', ')} to portfolio holdings`
      );
    }

    if (details.hasErrors) {
      warnings.push(
        'Portfolio data may be incomplete — some market data errors detected'
      );
    }

    const data: ScenarioImpactData = {
      estimatedPortfolioImpactPct: totalPortfolioImpactPct,
      estimatedImpactByBucket: impactByBucket,
      assumptions,
      missingMappings,
      horizon: input.horizon
    };

    const confidence =
      missingMappings.length > 0
        ? Math.max(0.4, 0.9 - missingMappings.length * 0.15)
        : details.hasErrors
          ? 0.7
          : 0.9;

    return {
      status: 'success',
      data,
      message: `Scenario impact: ${totalPortfolioImpactPct}% estimated portfolio change (${input.horizon} horizon, ${input.shocks.length} shocks applied).`,
      verification: createVerificationResult({
        passed: true,
        confidence,
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
        error instanceof Error
          ? error.message
          : 'Failed to compute scenario impact',
      verification: createVerificationResult({
        passed: false,
        confidence: 0,
        errors: [
          error instanceof Error
            ? error.message
            : 'Unknown error in scenarioImpact'
        ],
        sources: ['ghostfolio-portfolio-service']
      })
    };
  }
}
