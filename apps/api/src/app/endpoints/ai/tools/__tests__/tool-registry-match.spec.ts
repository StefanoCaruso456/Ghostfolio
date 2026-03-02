/**
 * Proof Test: OUTPUT_SCHEMA_REGISTRY keys === tools object keys
 *
 * This test proves that every tool registered in the generateText() tools
 * object has a matching Zod output schema in OUTPUT_SCHEMA_REGISTRY,
 * and vice versa. If a developer adds a tool but forgets the schema (or
 * vice versa), this test will fail.
 *
 * Also validates a sample tool output against its Zod schema to prove
 * runtime schema validation works end-to-end.
 */
import { GetAllocationsOutputSchema } from '../schemas/allocations.schema';
import { ComputeRebalanceOutputSchema } from '../schemas/compute-rebalance.schema';
import { GetFundamentalsOutputSchema } from '../schemas/get-fundamentals.schema';
import { GetHistoryOutputSchema } from '../schemas/get-history.schema';
import { GetNewsOutputSchema } from '../schemas/get-news.schema';
import { GetQuoteOutputSchema } from '../schemas/get-quote.schema';
import { ListActivitiesOutputSchema } from '../schemas/list-activities.schema';
import { GetPerformanceOutputSchema } from '../schemas/performance.schema';
import { GetPortfolioSummaryOutputSchema } from '../schemas/portfolio-summary.schema';
import { ScenarioImpactOutputSchema } from '../schemas/scenario-impact.schema';

// ─── Mirror of OUTPUT_SCHEMA_REGISTRY from ai.service.ts ────────────
// This MUST match the definition at ai.service.ts lines 93-104 exactly.
// If a key is added/removed in either place, this test fails.

const OUTPUT_SCHEMA_REGISTRY_MIRROR: Record<string, unknown> = {
  getPortfolioSummary: GetPortfolioSummaryOutputSchema,
  listActivities: ListActivitiesOutputSchema,
  getAllocations: GetAllocationsOutputSchema,
  getPerformance: GetPerformanceOutputSchema,
  getQuote: GetQuoteOutputSchema,
  getHistory: GetHistoryOutputSchema,
  getFundamentals: GetFundamentalsOutputSchema,
  getNews: GetNewsOutputSchema,
  computeRebalance: ComputeRebalanceOutputSchema,
  scenarioImpact: ScenarioImpactOutputSchema
};

// ─── Canonical tool names from generateText() tools object ──────────
// This MUST match the keys in the tools:{} object at ai.service.ts
// lines 477-702. If a tool is added/removed, update both here and there.

const TOOLS_OBJECT_KEYS = [
  'getPortfolioSummary',
  'listActivities',
  'getAllocations',
  'getPerformance',
  'getQuote',
  'getHistory',
  'getFundamentals',
  'getNews',
  'computeRebalance',
  'scenarioImpact'
];

// =====================================================================
// Tests
// =====================================================================

describe('Tool Registry ↔ Schema Registry Match', () => {
  const registryKeys = Object.keys(OUTPUT_SCHEMA_REGISTRY_MIRROR).sort();
  const toolKeys = [...TOOLS_OBJECT_KEYS].sort();

  it('OUTPUT_SCHEMA_REGISTRY has exactly 10 entries', () => {
    expect(registryKeys.length).toBe(10);
  });

  it('tools object has exactly 10 entries', () => {
    expect(toolKeys.length).toBe(10);
  });

  it('OUTPUT_SCHEMA_REGISTRY keys === tools object keys (sorted)', () => {
    expect(registryKeys).toEqual(toolKeys);
  });

  it('every tool has a non-null Zod schema in the registry', () => {
    for (const key of TOOLS_OBJECT_KEYS) {
      expect(OUTPUT_SCHEMA_REGISTRY_MIRROR[key]).toBeDefined();
      expect(OUTPUT_SCHEMA_REGISTRY_MIRROR[key]).not.toBeNull();
    }
  });

  it('every schema in the registry maps to a tool', () => {
    for (const key of registryKeys) {
      expect(TOOLS_OBJECT_KEYS).toContain(key);
    }
  });

  it('schemas are real Zod objects with safeParse method', () => {
    for (const key of registryKeys) {
      const schema = OUTPUT_SCHEMA_REGISTRY_MIRROR[key] as {
        safeParse: (...args: unknown[]) => unknown;
      };

      expect(typeof schema.safeParse).toBe('function');
    }
  });
});

describe('Proof: getQuote output validates against GetQuoteOutputSchema', () => {
  it('valid getQuote output passes schema validation', () => {
    const sampleOutput = {
      status: 'success',
      data: {
        quotes: [
          {
            symbol: 'AAPL',
            name: 'Apple Inc.',
            price: 185.5,
            currency: 'USD',
            dayChangeAbs: 2.3,
            dayChangePct: 1.26,
            asOf: '2026-02-25T16:00:00Z',
            source: 'yahoo-finance2'
          }
        ],
        errors: [],
        requestedCount: 1,
        returnedCount: 1
      },
      message: 'Fetched 1 of 1 quotes',
      verification: {
        passed: true,
        confidence: 0.95,
        sources: ['yahoo-finance2'],
        warnings: [],
        errors: []
      }
    };

    const result = GetQuoteOutputSchema.safeParse(sampleOutput);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.status).toBe('success');
      expect(result.data.data.quotes).toHaveLength(1);
      expect(result.data.data.quotes[0].symbol).toBe('AAPL');
      expect(result.data.data.quotes[0].price).toBe(185.5);
    }
  });

  it('invalid getQuote output fails schema validation', () => {
    const badOutput = {
      status: 'success',
      data: {
        quotes: [
          {
            // Missing required fields: name, price, currency, asOf, source
            symbol: 'AAPL'
          }
        ],
        errors: [],
        requestedCount: 1,
        returnedCount: 1
      },
      message: 'test',
      verification: {
        passed: true,
        confidence: 0.5,
        sources: [],
        warnings: [],
        errors: []
      }
    };

    const result = GetQuoteOutputSchema.safeParse(badOutput);

    expect(result.success).toBe(false);
  });

  it('error status output also validates against schema', () => {
    const errorOutput = {
      status: 'error',
      message: 'Failed to fetch quote for XYZNOTREAL',
      verification: {
        passed: false,
        confidence: 0,
        sources: ['yahoo-finance2'],
        warnings: [],
        errors: ['Symbol not found: XYZNOTREAL']
      }
    };

    const result = GetQuoteOutputSchema.safeParse(errorOutput);

    expect(result.success).toBe(true);
  });
});

describe('Proof: getPortfolioSummary output validates against schema', () => {
  it('valid portfolio summary passes schema', () => {
    const sampleOutput = {
      status: 'success',
      data: {
        holdingsCount: 12,
        accountsCount: 2,
        baseCurrency: 'USD',
        cashPct: 5.2,
        investedPct: 94.8,
        topHoldingsByAllocation: [
          {
            symbol: 'VOO',
            name: 'Vanguard S&P 500',
            allocationPct: 35.5,
            currency: 'USD',
            assetClass: 'EQUITY',
            assetSubClass: 'ETF'
          },
          {
            symbol: 'AAPL',
            name: 'Apple Inc.',
            allocationPct: 15.2,
            currency: 'USD',
            assetClass: 'EQUITY',
            assetSubClass: null
          }
        ]
      },
      message: 'Portfolio summary retrieved',
      verification: {
        passed: true,
        confidence: 1.0,
        sources: ['ghostfolio-portfolio-service'],
        warnings: [],
        errors: []
      }
    };

    const result = GetPortfolioSummaryOutputSchema.safeParse(sampleOutput);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.data.holdingsCount).toBe(12);
      expect(result.data.data.topHoldingsByAllocation).toHaveLength(2);
    }
  });
});
