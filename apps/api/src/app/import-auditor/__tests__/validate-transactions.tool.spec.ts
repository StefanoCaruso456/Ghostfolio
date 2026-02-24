import { validateTransactions } from '../tools/validate-transactions.tool';
import type { MappedActivity } from '../schemas/validate-transactions.schema';

describe('validateTransactions Tool', () => {
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

  it('should pass valid activities', () => {
    const result = validateTransactions({
      activities: [validActivity]
    });

    expect(result.status).toBe('pass');
    expect(result.data.totalProcessed).toBe(1);
    expect(result.data.totalValid).toBe(1);
    expect(result.data.totalErrors).toBe(0);
    expect(result.data.validActivities).toHaveLength(1);
    expect(result.verification.passed).toBe(true);
    expect(result.verification.confidence).toBe(1.0);
  });

  it('should fail for negative fee', () => {
    const result = validateTransactions({
      activities: [{ ...validActivity, fee: -5 }]
    });

    expect(result.status).toBe('fail');
    expect(result.data.totalErrors).toBeGreaterThan(0);

    const feeError = result.data.errors.find(
      (e) => e.field === 'fee'
    );
    expect(feeError).toBeDefined();
    expect(feeError.code).toBe('NEGATIVE_VALUE');
    expect(result.verification.passed).toBe(false);
  });

  it('should fail for negative quantity', () => {
    const result = validateTransactions({
      activities: [{ ...validActivity, quantity: -10 }]
    });

    expect(result.status).toBe('fail');

    const qtyError = result.data.errors.find(
      (e) => e.field === 'quantity'
    );
    expect(qtyError).toBeDefined();
    expect(qtyError.code).toBe('NEGATIVE_VALUE');
  });

  it('should fail for negative unitPrice', () => {
    const result = validateTransactions({
      activities: [{ ...validActivity, unitPrice: -100 }]
    });

    expect(result.status).toBe('fail');

    const priceError = result.data.errors.find(
      (e) => e.field === 'unitPrice'
    );
    expect(priceError).toBeDefined();
    expect(priceError.code).toBe('NEGATIVE_VALUE');
  });

  it('should fail for future date', () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const result = validateTransactions({
      activities: [
        { ...validActivity, date: futureDate.toISOString() }
      ]
    });

    expect(result.status).toBe('fail');

    const dateError = result.data.errors.find(
      (e) => e.field === 'date'
    );
    expect(dateError).toBeDefined();
    expect(dateError.code).toBe('FUTURE_DATE');
  });

  it('should fail for invalid date', () => {
    const result = validateTransactions({
      activities: [{ ...validActivity, date: 'not-a-date' }]
    });

    expect(result.status).toBe('fail');

    const dateError = result.data.errors.find(
      (e) => e.field === 'date'
    );
    expect(dateError).toBeDefined();
    expect(dateError.code).toBe('INVALID_DATE');
  });

  it('should fail for missing required fields', () => {
    const result = validateTransactions({
      activities: [
        {
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
        }
      ]
    });

    expect(result.status).toBe('fail');
    expect(result.data.totalErrors).toBeGreaterThan(0);

    const missingFields = result.data.errors.filter(
      (e) => e.code === 'MISSING_REQUIRED_FIELD'
    );
    expect(missingFields.length).toBe(7); // currency, date, fee, quantity, symbol, type, unitPrice
  });

  it('should fail for invalid activity type', () => {
    const result = validateTransactions({
      activities: [{ ...validActivity, type: 'TRANSFER' }]
    });

    expect(result.status).toBe('fail');

    const typeError = result.data.errors.find(
      (e) => e.field === 'type'
    );
    expect(typeError).toBeDefined();
    expect(typeError.code).toBe('INVALID_TYPE');
  });

  it('should warn for BUY with zero unitPrice', () => {
    const result = validateTransactions({
      activities: [{ ...validActivity, unitPrice: 0 }]
    });

    // Should pass but with warnings
    expect(result.data.warnings.length).toBeGreaterThan(0);

    const priceWarning = result.data.warnings.find(
      (w) => w.code === 'PRICE_QUANTITY_COHERENCE'
    );
    expect(priceWarning).toBeDefined();
  });

  it('should fail for invalid currency code', () => {
    const result = validateTransactions({
      activities: [{ ...validActivity, currency: 'INVALID' }]
    });

    expect(result.status).toBe('fail');

    const currencyError = result.data.errors.find(
      (e) => e.field === 'currency'
    );
    expect(currencyError).toBeDefined();
    expect(currencyError.code).toBe('INVALID_CURRENCY');
  });

  it('should detect batch duplicates', () => {
    const result = validateTransactions({
      activities: [validActivity, validActivity]
    });

    expect(result.data.warnings.length).toBeGreaterThan(0);

    const dupWarning = result.data.warnings.find(
      (w) => w.code === 'BATCH_DUPLICATE'
    );
    expect(dupWarning).toBeDefined();
  });

  it('should validate multiple activities and report mixed results', () => {
    const result = validateTransactions({
      activities: [
        validActivity,
        { ...validActivity, fee: -1 },
        { ...validActivity, symbol: 'AAPL', unitPrice: 150 }
      ]
    });

    expect(result.status).toBe('fail');
    expect(result.data.totalProcessed).toBe(3);
    expect(result.data.totalValid).toBe(2);
    expect(result.data.totalErrors).toBeGreaterThan(0);
    expect(result.verification.confidence).toBeCloseTo(2 / 3, 1);
  });

  it('should include sources listing all rules checked', () => {
    const result = validateTransactions({
      activities: [validActivity]
    });

    expect(result.verification.sources.length).toBeGreaterThan(0);
    expect(result.verification.sources).toContain(
      'required-fields'
    );
    expect(result.verification.sources).toContain(
      'valid-activity-type'
    );
  });
});
