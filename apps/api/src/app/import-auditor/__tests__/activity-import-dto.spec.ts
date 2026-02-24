/**
 * ActivityImportDTO Tests — DTO schema alignment + normalization layer.
 *
 * 5 tests: DTO schema alignment with Ghostfolio CreateOrderDto
 * 1 test:  Import blocks if account missing (when required)
 * 1 test:  Type normalization works for aliases
 */
import { ActivityImportDTOSchema } from '../schemas/activity-import-dto.schema';
import type { MappedActivity } from '../schemas/validate-transactions.schema';
import { generateImportPreview } from '../tools/generate-import-preview.tool';
import { normalizeToActivityDTO } from '../tools/normalize-to-activity-dto.tool';

// ─── Fixtures ────────────────────────────────────────────────────────

const VALID_MAPPED_ACTIVITY: MappedActivity = {
  account: null,
  comment: null,
  currency: 'USD',
  dataSource: 'YAHOO',
  date: '2023-01-15T00:00:00.000Z',
  fee: 19,
  quantity: 5,
  symbol: 'MSFT',
  type: 'BUY',
  unitPrice: 298.58
};

// ═════════════════════════════════════════════════════════════════════
// DTO Schema Alignment Tests (5)
// ═════════════════════════════════════════════════════════════════════

describe('ActivityImportDTO: Schema Alignment', () => {
  it('D001: accepts a fully valid DTO matching CreateOrderDto required fields', () => {
    const dto = {
      type: 'BUY',
      symbol: 'MSFT',
      date: '2023-01-15',
      quantity: 5,
      unitPrice: 298.58,
      fee: 19,
      currency: 'USD'
    };

    const result = ActivityImportDTOSchema.safeParse(dto);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.type).toBe('BUY');
      expect(result.data.symbol).toBe('MSFT');
      expect(result.data.date).toBe('2023-01-15');
      expect(result.data.quantity).toBe(5);
      expect(result.data.unitPrice).toBe(298.58);
      expect(result.data.fee).toBe(19);
      expect(result.data.currency).toBe('USD');
    }
  });

  it('D002: rejects DTO with missing required field (symbol)', () => {
    const dto = {
      type: 'BUY',
      // symbol: missing
      date: '2023-01-15',
      quantity: 5,
      unitPrice: 298.58,
      fee: 19,
      currency: 'USD'
    };

    const result = ActivityImportDTOSchema.safeParse(dto);
    expect(result.success).toBe(false);
  });

  it('D003: rejects DTO with invalid date format (not YYYY-MM-DD)', () => {
    const dto = {
      type: 'BUY',
      symbol: 'MSFT',
      date: '01/15/2023', // Wrong format
      quantity: 5,
      unitPrice: 298.58,
      fee: 19,
      currency: 'USD'
    };

    const result = ActivityImportDTOSchema.safeParse(dto);
    expect(result.success).toBe(false);
  });

  it('D004: rejects DTO with negative fee', () => {
    const dto = {
      type: 'BUY',
      symbol: 'MSFT',
      date: '2023-01-15',
      quantity: 5,
      unitPrice: 298.58,
      fee: -1,
      currency: 'USD'
    };

    const result = ActivityImportDTOSchema.safeParse(dto);
    expect(result.success).toBe(false);
  });

  it('D005: accepts all 6 valid activity types matching Prisma Type enum', () => {
    const types = ['BUY', 'SELL', 'DIVIDEND', 'FEE', 'INTEREST', 'LIABILITY'];

    for (const type of types) {
      const dto = {
        type,
        symbol: 'MSFT',
        date: '2023-01-15',
        quantity: 5,
        unitPrice: 298.58,
        fee: 0,
        currency: 'USD'
      };

      const result = ActivityImportDTOSchema.safeParse(dto);
      expect(result.success).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// Import Blocks If Account Missing
// ═════════════════════════════════════════════════════════════════════

describe('ActivityImportDTO: Account Gating', () => {
  it('D006: preview blocks canCommit when DTOs are not provided', () => {
    // Simulate: validateTransactions passed but normalizeActivities was NOT called
    const preview = generateImportPreview({
      validActivities: [VALID_MAPPED_ACTIVITY],
      totalErrors: 0,
      totalWarnings: 0
      // normalizedDTOs: NOT provided
      // dtoNormalizationErrors: NOT provided
    });

    // canCommit should be false because DTOs were not produced
    expect(preview.data.canCommit).toBe(false);
    expect(preview.data.commitBlockedReason).toContain(
      'normalized to import DTO format'
    );
    expect(preview.verification.domainRulesFailed).toContain(
      'dto-normalization-gate'
    );
  });
});

// ═════════════════════════════════════════════════════════════════════
// Type Normalization
// ═════════════════════════════════════════════════════════════════════

describe('ActivityImportDTO: Type Normalization', () => {
  it('D007: normalizes lowercase and broker-specific type aliases to valid enum', () => {
    const testCases: { input: string; expected: string }[] = [
      { input: 'buy', expected: 'BUY' },
      { input: 'sell', expected: 'SELL' },
      { input: 'Market buy', expected: 'BUY' },
      { input: 'Market sell', expected: 'SELL' },
      { input: 'DIVIDEND', expected: 'DIVIDEND' },
      { input: 'Div', expected: 'DIVIDEND' },
      { input: 'PURCHASE', expected: 'BUY' },
      { input: 'Commission', expected: 'FEE' }
    ];

    for (const { input, expected } of testCases) {
      const result = normalizeToActivityDTO({
        activities: [{ ...VALID_MAPPED_ACTIVITY, type: input }]
      });

      expect(result.status).not.toBe('error');
      expect(result.data.dtos.length).toBe(1);
      expect(result.data.dtos[0].type).toBe(expected);
    }
  });
});
