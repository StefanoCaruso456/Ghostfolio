import type { MappedActivity } from '../schemas/validate-transactions.schema';
import { previewImportReport } from '../tools/preview-import-report.tool';

function makeActivity(overrides: Partial<MappedActivity> = {}): MappedActivity {
  return {
    symbol: 'MSFT',
    date: '2023-09-16T00:00:00.000Z',
    type: 'BUY',
    quantity: 5,
    unitPrice: 298.58,
    fee: 19,
    currency: 'USD',
    account: null,
    comment: null,
    dataSource: null,
    ...overrides
  };
}

describe('previewImportReport', () => {
  it('should generate a report for a single BUY activity', () => {
    const activities = [makeActivity()];

    const result = previewImportReport({ activities });

    expect(result.status).toBe('success');
    expect(result.data.totalCount).toBe(1);
    expect(result.data.typeBreakdown).toHaveLength(1);
    expect(result.data.typeBreakdown[0].type).toBe('BUY');
    expect(result.data.typeBreakdown[0].count).toBe(1);
    expect(result.data.typeBreakdown[0].estimatedValue).toBeCloseTo(1492.9);
    expect(result.data.currencies).toEqual(['USD']);
    expect(result.data.dateRange.earliest).toBe('2023-09-16T00:00:00.000Z');
    expect(result.data.dateRange.latest).toBe('2023-09-16T00:00:00.000Z');
    expect(result.data.summary).toContain('1 activity');
    expect(result.data.summary).toContain('1 BUY');
    expect(result.verification.passed).toBe(true);
  });

  it('should generate a report with mixed activity types', () => {
    const activities = [
      makeActivity({
        type: 'BUY',
        symbol: 'MSFT',
        quantity: 5,
        unitPrice: 300
      }),
      makeActivity({
        type: 'BUY',
        symbol: 'AAPL',
        quantity: 10,
        unitPrice: 150
      }),
      makeActivity({
        type: 'SELL',
        symbol: 'GOOG',
        quantity: 3,
        unitPrice: 120
      }),
      makeActivity({
        type: 'DIVIDEND',
        symbol: 'MSFT',
        quantity: 5,
        unitPrice: 0.62
      })
    ];

    const result = previewImportReport({ activities });

    expect(result.status).toBe('success');
    expect(result.data.totalCount).toBe(4);
    expect(result.data.typeBreakdown).toHaveLength(3);

    const buyBreakdown = result.data.typeBreakdown.find(
      (tb) => tb.type === 'BUY'
    );
    expect(buyBreakdown?.count).toBe(2);
    expect(buyBreakdown?.estimatedValue).toBeCloseTo(3000);

    const sellBreakdown = result.data.typeBreakdown.find(
      (tb) => tb.type === 'SELL'
    );
    expect(sellBreakdown?.count).toBe(1);

    const divBreakdown = result.data.typeBreakdown.find(
      (tb) => tb.type === 'DIVIDEND'
    );
    expect(divBreakdown?.count).toBe(1);

    expect(result.data.summary).toContain('4 activities');
  });

  it('should handle multiple currencies', () => {
    const activities = [
      makeActivity({ currency: 'USD' }),
      makeActivity({ currency: 'EUR', symbol: 'SAP' }),
      makeActivity({ currency: 'GBP', symbol: 'BP' })
    ];

    const result = previewImportReport({ activities });

    expect(result.data.currencies).toEqual(['EUR', 'GBP', 'USD']);
    expect(result.data.summary).toContain('Currencies');
  });

  it('should handle zero-value FEE activities', () => {
    const activities = [
      makeActivity({
        type: 'FEE',
        symbol: 'Account Opening Fee',
        quantity: 0,
        unitPrice: 0,
        fee: 49
      })
    ];

    const result = previewImportReport({ activities });

    expect(result.status).toBe('success');
    expect(result.data.totalCount).toBe(1);

    const feeBreakdown = result.data.typeBreakdown.find(
      (tb) => tb.type === 'FEE'
    );
    expect(feeBreakdown?.count).toBe(1);
    expect(feeBreakdown?.estimatedValue).toBe(0);
  });

  it('should calculate correct date range', () => {
    const activities = [
      makeActivity({ date: '2023-01-15T00:00:00.000Z' }),
      makeActivity({ date: '2023-06-20T00:00:00.000Z', symbol: 'AAPL' }),
      makeActivity({ date: '2023-12-01T00:00:00.000Z', symbol: 'GOOG' })
    ];

    const result = previewImportReport({ activities });

    expect(result.data.dateRange.earliest).toBe('2023-01-15T00:00:00.000Z');
    expect(result.data.dateRange.latest).toBe('2023-12-01T00:00:00.000Z');
    expect(result.data.summary).toContain('Date range');
  });

  it('should pass through warnings and errors counts', () => {
    const activities = [makeActivity()];

    const result = previewImportReport({
      activities,
      warningsCount: 3,
      errorsCount: 1
    });

    expect(result.data.warningsCount).toBe(3);
    expect(result.data.errorsCount).toBe(1);
    expect(result.data.summary).toContain('3 warning(s)');
    expect(result.data.summary).toContain('1 error(s)');
    expect(result.verification.warnings).toHaveLength(2);
  });

  it('should handle lowercase type normalization', () => {
    const activities = [
      makeActivity({ type: 'buy' }),
      makeActivity({ type: 'sell', symbol: 'AAPL' })
    ];

    const result = previewImportReport({ activities });

    expect(result.data.typeBreakdown).toHaveLength(2);
    expect(result.data.typeBreakdown.map((tb) => tb.type)).toContain('BUY');
    expect(result.data.typeBreakdown.map((tb) => tb.type)).toContain('SELL');
  });
});
