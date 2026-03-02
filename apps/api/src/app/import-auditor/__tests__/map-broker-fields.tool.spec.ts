import { mapBrokerFields } from '../tools/map-broker-fields.tool';

describe('mapBrokerFields Tool', () => {
  it('should map standard Ghostfolio CSV headers', () => {
    const headers = [
      'Date',
      'Code',
      'DataSource',
      'Currency',
      'Price',
      'Quantity',
      'Action',
      'Fee',
      'Note'
    ];
    const sampleRows = [
      {
        Date: '2023-01-15',
        Code: 'MSFT',
        DataSource: 'YAHOO',
        Currency: 'USD',
        Price: 298.58,
        Quantity: 5,
        Action: 'buy',
        Fee: 19,
        Note: 'Test'
      }
    ];

    const result = mapBrokerFields({ headers, sampleRows });

    expect(result.status).toBe('success');
    expect(result.verification.passed).toBe(true);

    const mappedFields = result.data.mappings.map((m) => m.targetField);
    expect(mappedFields).toContain('date');
    expect(mappedFields).toContain('symbol');
    expect(mappedFields).toContain('currency');
    expect(mappedFields).toContain('unitPrice');
    expect(mappedFields).toContain('quantity');
    expect(mappedFields).toContain('type');
    expect(mappedFields).toContain('fee');
    expect(mappedFields).toContain('comment');
    expect(mappedFields).toContain('dataSource');

    expect(result.data.unmappedRequiredFields).toHaveLength(0);
    expect(result.data.overallConfidence).toBe(1.0);
  });

  it('should map Interactive Brokers headers', () => {
    const headers = [
      'CurrencyPrimary',
      'Symbol',
      'TradeDate',
      'TradePrice',
      'Quantity',
      'Buy/Sell',
      'IBCommission'
    ];
    const sampleRows = [
      {
        CurrencyPrimary: 'USD',
        Symbol: 'VTI',
        TradeDate: '20230403',
        TradePrice: 204.35,
        Quantity: 17,
        'Buy/Sell': 'BUY',
        IBCommission: -1
      }
    ];

    const result = mapBrokerFields({ headers, sampleRows });

    expect(result.status).toBe('success');
    expect(result.verification.passed).toBe(true);

    const mappedFields = result.data.mappings.map((m) => m.targetField);
    expect(mappedFields).toContain('currency');
    expect(mappedFields).toContain('symbol');
    expect(mappedFields).toContain('date');
    expect(mappedFields).toContain('unitPrice');
    expect(mappedFields).toContain('quantity');
    expect(mappedFields).toContain('type');
    expect(mappedFields).toContain('fee');

    expect(result.data.unmappedRequiredFields).toHaveLength(0);
  });

  it('should return partial status for unknown headers', () => {
    const headers = ['TransactionDate', 'StockTicker', 'Amount', 'TotalCost'];
    const sampleRows = [
      {
        TransactionDate: '2023-01-15',
        StockTicker: 'AAPL',
        Amount: 10,
        TotalCost: 1500
      }
    ];

    const result = mapBrokerFields({ headers, sampleRows });

    expect(result.status).toBe('error');
    expect(result.data.unmappedRequiredFields.length).toBeGreaterThan(0);
    expect(result.data.unmappedHeaders.length).toBeGreaterThan(0);
    expect(result.verification.passed).toBe(false);
  });

  it('should handle empty headers array', () => {
    const result = mapBrokerFields({
      headers: [],
      sampleRows: [{ a: 1 }]
    });

    expect(result.status).toBe('error');
    expect(result.verification.passed).toBe(false);
    expect(result.verification.errors.length).toBeGreaterThan(0);
  });

  it('should have confidence 1.0 for all mapped headers', () => {
    const headers = [
      'Date',
      'Symbol',
      'Currency',
      'Price',
      'Qty',
      'Action',
      'Fee'
    ];
    const sampleRows = [
      {
        Date: '2023-01-15',
        Symbol: 'MSFT',
        Currency: 'USD',
        Price: 100,
        Qty: 5,
        Action: 'buy',
        Fee: 0
      }
    ];

    const result = mapBrokerFields({ headers, sampleRows });

    for (const mapping of result.data.mappings) {
      expect(mapping.confidence).toBe(1.0);
    }
  });
});
