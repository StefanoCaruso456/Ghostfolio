import { detectDuplicates } from '../tools/detect-duplicates.tool';
import type { MappedActivity } from '../schemas/validate-transactions.schema';
import type { ExistingActivity } from '../schemas/detect-duplicates.schema';

function makeActivity(
  overrides: Partial<MappedActivity> = {}
): MappedActivity {
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

function makeExistingActivity(
  overrides: Partial<ExistingActivity> = {}
): ExistingActivity {
  return {
    symbol: 'MSFT',
    date: '2023-09-16T00:00:00.000Z',
    type: 'BUY',
    quantity: 5,
    unitPrice: 298.58,
    fee: 19,
    currency: 'USD',
    accountId: null,
    comment: null,
    dataSource: 'YAHOO',
    ...overrides
  };
}

describe('detectDuplicates', () => {
  it('should return clean when no duplicates exist', () => {
    const activities = [
      makeActivity({ symbol: 'MSFT' }),
      makeActivity({ symbol: 'AAPL', unitPrice: 150 }),
      makeActivity({ symbol: 'GOOG', unitPrice: 120, quantity: 10 })
    ];

    const result = detectDuplicates({ activities });

    expect(result.status).toBe('clean');
    expect(result.data.duplicates).toHaveLength(0);
    expect(result.data.cleanActivities).toHaveLength(3);
    expect(result.data.totalChecked).toBe(3);
    expect(result.data.batchDuplicatesFound).toBe(0);
    expect(result.data.databaseDuplicatesFound).toBe(0);
    expect(result.verification.passed).toBe(true);
    expect(result.verification.confidence).toBe(1.0);
  });

  it('should detect batch duplicates within CSV', () => {
    const activities = [
      makeActivity({ symbol: 'MSFT' }),
      makeActivity({ symbol: 'MSFT' }), // exact duplicate
      makeActivity({ symbol: 'AAPL', unitPrice: 150 })
    ];

    const result = detectDuplicates({ activities });

    expect(result.status).toBe('duplicates_found');
    expect(result.data.duplicates).toHaveLength(1);
    expect(result.data.duplicates[0].matchType).toBe('batch');
    expect(result.data.duplicates[0].csvRowIndex).toBe(1);
    expect(result.data.duplicates[0].confidence).toBe(1.0);

    const matchedWith = result.data.duplicates[0].matchedWith as {
      csvRowIndex: number;
    };
    expect(matchedWith.csvRowIndex).toBe(0);

    expect(result.data.cleanActivities).toHaveLength(2);
    expect(result.data.batchDuplicatesFound).toBe(1);
    expect(result.data.databaseDuplicatesFound).toBe(0);
    expect(result.verification.passed).toBe(false);
  });

  it('should detect database duplicates against existing activities', () => {
    const activities = [makeActivity({ symbol: 'MSFT' })];

    const existingActivities = [
      makeExistingActivity({ symbol: 'MSFT' }) // matches
    ];

    const result = detectDuplicates({ activities, existingActivities });

    expect(result.status).toBe('duplicates_found');
    expect(result.data.duplicates).toHaveLength(1);
    expect(result.data.duplicates[0].matchType).toBe('database');
    expect(result.data.duplicates[0].confidence).toBe(0.95);

    const matchedWith = result.data.duplicates[0].matchedWith as {
      existingActivityIndex: number;
    };
    expect(matchedWith.existingActivityIndex).toBe(0);

    expect(result.data.cleanActivities).toHaveLength(0);
    expect(result.data.databaseDuplicatesFound).toBe(1);
    expect(result.verification.sources).toContain(
      'database-duplicate-detection'
    );
  });

  it('should detect both batch and database duplicates', () => {
    const activities = [
      makeActivity({ symbol: 'MSFT' }),
      makeActivity({ symbol: 'MSFT' }), // batch duplicate of row 0
      makeActivity({ symbol: 'AAPL', unitPrice: 150 }) // DB duplicate
    ];

    const existingActivities = [
      makeExistingActivity({ symbol: 'AAPL', unitPrice: 150 })
    ];

    const result = detectDuplicates({ activities, existingActivities });

    expect(result.status).toBe('duplicates_found');
    expect(result.data.duplicates).toHaveLength(2);
    expect(result.data.batchDuplicatesFound).toBe(1);
    expect(result.data.databaseDuplicatesFound).toBe(1);
    expect(result.data.cleanActivities).toHaveLength(1);
    expect(result.data.cleanActivities[0].symbol).toBe('MSFT');
  });

  it('should not flag near-duplicates as duplicates', () => {
    const activities = [
      makeActivity({ symbol: 'MSFT', quantity: 5 }),
      makeActivity({ symbol: 'MSFT', quantity: 10 }) // different quantity
    ];

    const result = detectDuplicates({ activities });

    expect(result.status).toBe('clean');
    expect(result.data.duplicates).toHaveLength(0);
    expect(result.data.cleanActivities).toHaveLength(2);
  });

  it('should not flag near-duplicates against DB', () => {
    const activities = [makeActivity({ symbol: 'MSFT', fee: 19 })];

    const existingActivities = [
      makeExistingActivity({ symbol: 'MSFT', fee: 25 }) // different fee
    ];

    const result = detectDuplicates({ activities, existingActivities });

    expect(result.status).toBe('clean');
    expect(result.data.duplicates).toHaveLength(0);
  });

  it('should handle empty existingActivities gracefully', () => {
    const activities = [makeActivity()];

    const result = detectDuplicates({
      activities,
      existingActivities: []
    });

    expect(result.status).toBe('clean');
    expect(result.verification.sources).toContain('batch-duplicate-detection');
    expect(result.verification.sources).not.toContain(
      'database-duplicate-detection'
    );
  });

  it('should detect multiple batch duplicates of the same row', () => {
    const activities = [
      makeActivity({ symbol: 'MSFT' }),
      makeActivity({ symbol: 'MSFT' }), // dup of row 0
      makeActivity({ symbol: 'MSFT' }) // also dup of row 0
    ];

    const result = detectDuplicates({ activities });

    expect(result.status).toBe('duplicates_found');
    expect(result.data.batchDuplicatesFound).toBe(2);
    expect(result.data.cleanActivities).toHaveLength(1);
  });

  it('should compare DB dates using isSameSecond precision', () => {
    const activities = [
      makeActivity({
        symbol: 'MSFT',
        date: '2023-09-16T10:30:45.000Z'
      })
    ];

    const existingActivities = [
      makeExistingActivity({
        symbol: 'MSFT',
        date: '2023-09-16T10:30:45.500Z' // same second, different ms
      })
    ];

    const result = detectDuplicates({ activities, existingActivities });

    expect(result.status).toBe('duplicates_found');
    expect(result.data.databaseDuplicatesFound).toBe(1);
  });
});
