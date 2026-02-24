import type { MappedActivity } from '../schemas/validate-transactions.schema';
import { generateImportPreview } from '../tools/generate-import-preview.tool';

describe('generateImportPreview Tool', () => {
  const validActivity: MappedActivity = {
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

  // ─── Happy Path ────────────────────────────────────────────────────

  it('should generate a preview for valid activities', () => {
    const result = generateImportPreview({
      validActivities: [validActivity],
      totalErrors: 0,
      totalWarnings: 0
    });

    expect(result.status).toBe('success');
    expect(result.data.summary.totalActivities).toBe(1);
    expect(result.data.summary.byType).toEqual({ BUY: 1 });
    expect(result.data.summary.byCurrency).toEqual({ USD: 1 });
    expect(result.data.summary.uniqueSymbols).toEqual(['MSFT']);
    expect(result.data.canCommit).toBe(true);
    expect(result.verification.passed).toBe(true);
    expect(result.verification.confidence).toBe(1.0);
  });

  it('should calculate total estimated value', () => {
    const result = generateImportPreview({
      validActivities: [
        validActivity,
        { ...validActivity, symbol: 'AAPL', quantity: 10, unitPrice: 150 }
      ],
      totalErrors: 0,
      totalWarnings: 0
    });

    // 5 * 298.58 + 10 * 150 = 1492.90 + 1500 = 2992.90
    expect(result.data.summary.totalEstimatedValue).toBeCloseTo(2992.9, 1);
  });

  it('should compute date range correctly', () => {
    const result = generateImportPreview({
      validActivities: [
        { ...validActivity, date: '2023-01-15T00:00:00.000Z' },
        { ...validActivity, date: '2023-06-20T00:00:00.000Z', symbol: 'AAPL' },
        { ...validActivity, date: '2023-03-10T00:00:00.000Z', symbol: 'GOOG' }
      ],
      totalErrors: 0,
      totalWarnings: 0
    });

    expect(result.data.summary.dateRange.earliest).toBe('2023-01-15');
    expect(result.data.summary.dateRange.latest).toBe('2023-06-20');
  });

  it('should generate markdown preview table', () => {
    const result = generateImportPreview({
      validActivities: [validActivity],
      totalErrors: 0,
      totalWarnings: 0
    });

    expect(result.data.summary.previewTable).toContain('MSFT');
    expect(result.data.summary.previewTable).toContain('BUY');
    expect(result.data.summary.previewTable).toContain('USD');
  });

  // ─── Commit Gating ────────────────────────────────────────────────

  it('should block commit when there are validation errors', () => {
    const result = generateImportPreview({
      validActivities: [validActivity],
      totalErrors: 3,
      totalWarnings: 0
    });

    expect(result.data.canCommit).toBe(false);
    expect(result.data.commitBlockedReason).toContain('3 validation error');
    expect(result.verification.passed).toBe(false);
    expect(result.verification.domainRulesFailed).toContain(
      'error-free-commit-gate'
    );
  });

  it('should allow commit with warnings but flag them', () => {
    const result = generateImportPreview({
      validActivities: [validActivity],
      totalErrors: 0,
      totalWarnings: 2
    });

    expect(result.data.canCommit).toBe(true);
    expect(result.data.previewWarnings).toBe(2);
    expect(result.verification.requiresHumanReview).toBe(true);
  });

  // ─── Human-in-the-Loop Escalation ─────────────────────────────────

  it('should require human review for high-value imports', () => {
    const highValueActivity: MappedActivity = {
      ...validActivity,
      quantity: 1000,
      unitPrice: 500 // 1000 * 500 = $500,000
    };

    const result = generateImportPreview({
      validActivities: [highValueActivity],
      totalErrors: 0,
      totalWarnings: 0
    });

    expect(result.verification.requiresHumanReview).toBe(true);
    expect(result.verification.escalationReason).toContain(
      'High estimated value'
    );
  });

  it('should require human review for large batches', () => {
    const largeBatch = Array.from({ length: 60 }, (_, i) => ({
      ...validActivity,
      symbol: `SYM${i}`,
      date: `2023-01-${String(Math.min(i + 1, 28)).padStart(2, '0')}T00:00:00.000Z`
    }));

    const result = generateImportPreview({
      validActivities: largeBatch,
      totalErrors: 0,
      totalWarnings: 0
    });

    expect(result.verification.requiresHumanReview).toBe(true);
    expect(result.verification.escalationReason).toContain('Large batch');
  });

  // ─── Edge Cases ────────────────────────────────────────────────────

  it('should return error for empty activities', () => {
    const result = generateImportPreview({
      validActivities: [],
      totalErrors: 5,
      totalWarnings: 0
    });

    expect(result.status).toBe('error');
    expect(result.data.canCommit).toBe(false);
    expect(result.verification.passed).toBe(false);
  });

  it('should handle activities with null/missing fields gracefully', () => {
    const partialActivity: MappedActivity = {
      account: null,
      comment: null,
      currency: null,
      dataSource: null,
      date: null,
      fee: null,
      quantity: null,
      symbol: null,
      type: null,
      unitPrice: null
    };

    const result = generateImportPreview({
      validActivities: [partialActivity],
      totalErrors: 0,
      totalWarnings: 0
    });

    expect(result.status).toBe('success');
    expect(result.data.summary.totalEstimatedValue).toBe(0);
    expect(result.data.summary.uniqueSymbols).toEqual([]);
  });

  it('should truncate preview table for large datasets', () => {
    const activities = Array.from({ length: 20 }, (_, i) => ({
      ...validActivity,
      symbol: `SYM${i}`
    }));

    const result = generateImportPreview({
      validActivities: activities,
      totalErrors: 0,
      totalWarnings: 0
    });

    expect(result.data.summary.previewTable).toContain('and 10 more rows');
  });

  it('should count multiple currencies', () => {
    const result = generateImportPreview({
      validActivities: [
        { ...validActivity, currency: 'USD' },
        { ...validActivity, currency: 'EUR', symbol: 'SAP' },
        { ...validActivity, currency: 'EUR', symbol: 'SIE' },
        { ...validActivity, currency: 'GBP', symbol: 'VOD' }
      ],
      totalErrors: 0,
      totalWarnings: 0
    });

    expect(result.data.summary.byCurrency).toEqual({
      USD: 1,
      EUR: 2,
      GBP: 1
    });
  });

  it('should count multiple activity types', () => {
    const result = generateImportPreview({
      validActivities: [
        { ...validActivity, type: 'BUY' },
        { ...validActivity, type: 'SELL', symbol: 'AAPL' },
        { ...validActivity, type: 'DIVIDEND', symbol: 'GOOG' },
        { ...validActivity, type: 'BUY', symbol: 'TSLA' }
      ],
      totalErrors: 0,
      totalWarnings: 0
    });

    expect(result.data.summary.byType).toEqual({
      BUY: 2,
      SELL: 1,
      DIVIDEND: 1
    });
  });

  // ─── Domain Constraints ────────────────────────────────────────────

  it('should check domain rules and report them', () => {
    const result = generateImportPreview({
      validActivities: [validActivity],
      totalErrors: 0,
      totalWarnings: 0
    });

    expect(result.verification.domainRulesChecked).toContain(
      'batch-size-limit'
    );
    expect(result.verification.domainRulesChecked).toContain(
      'high-value-detection'
    );
    expect(result.verification.domainRulesChecked).toContain(
      'error-free-commit-gate'
    );
    expect(result.verification.domainRulesFailed).toEqual([]);
  });
});
