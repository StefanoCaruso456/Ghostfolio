import { detectBrokerFormat } from '../tools/detect-broker-format.tool';

describe('detectBrokerFormat Tool', () => {
  // ─── Happy Path ────────────────────────────────────────────────────

  it('should detect Ghostfolio native format', () => {
    const result = detectBrokerFormat({
      headers: [
        'Date',
        'Code',
        'DataSource',
        'Currency',
        'Price',
        'Quantity',
        'Action',
        'Fee',
        'Note'
      ],
      sampleRows: [
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
      ]
    });

    expect(result.status).toBe('success');
    expect(result.data.detectedBroker).toBe('ghostfolio');
    expect(result.data.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.verification.passed).toBe(true);
  });

  it('should detect Interactive Brokers format', () => {
    const result = detectBrokerFormat({
      headers: [
        'CurrencyPrimary',
        'Symbol',
        'TradeDate',
        'TradePrice',
        'Quantity',
        'Buy/Sell',
        'IBCommission'
      ],
      sampleRows: [
        {
          CurrencyPrimary: 'USD',
          Symbol: 'VTI',
          TradeDate: '20230403',
          TradePrice: 204.35,
          Quantity: 17,
          'Buy/Sell': 'BUY',
          IBCommission: -1
        }
      ]
    });

    expect(result.status).toBe('success');
    expect(result.data.detectedBroker).toBe('interactive_brokers');
    expect(result.data.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('should detect Trading212 format', () => {
    const result = detectBrokerFormat({
      headers: [
        'Action',
        'Time',
        'Ticker',
        'Price',
        'No. of shares',
        'Currency (Price / share)',
        'Exchange rate',
        'Result'
      ],
      sampleRows: [
        {
          Action: 'Market buy',
          Time: '2023-04-03 09:30:00',
          Ticker: 'AAPL',
          Price: 165.0,
          'No. of shares': 10,
          'Currency (Price / share)': 'USD',
          'Exchange rate': 1.0,
          Result: 1650.0
        }
      ]
    });

    expect(result.status).toBe('success');
    expect(result.data.detectedBroker).toBe('trading212');
    expect(result.data.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('should use file name hint for detection', () => {
    const result = detectBrokerFormat({
      headers: ['Date', 'Symbol', 'Quantity', 'Price'],
      sampleRows: [
        { Date: '2023-01-15', Symbol: 'MSFT', Quantity: 5, Price: 100 }
      ],
      fileName: 'IBKR_trades_2023.csv'
    });

    expect(result.status).toBe('success');
    // File name hint should boost IB score
    const ibMatch = result.data.allMatches.find(
      (m) => m.broker === 'interactive_brokers'
    );
    expect(ibMatch).toBeDefined();
    expect(
      ibMatch.matchedSignatures.some((s) => s.startsWith('filename:'))
    ).toBe(true);
  });

  // ─── Edge Cases ────────────────────────────────────────────────────

  it('should return generic for unrecognized headers', () => {
    const result = detectBrokerFormat({
      headers: ['Foo', 'Bar', 'Baz', 'Qux'],
      sampleRows: [{ Foo: 1, Bar: 2, Baz: 3, Qux: 4 }]
    });

    expect(result.status).toBe('success');
    expect(result.data.detectedBroker).toBe('generic');
    expect(result.data.confidence).toBeLessThan(0.5);
    expect(result.verification.requiresHumanReview).toBe(true);
  });

  it('should return error for empty headers', () => {
    const result = detectBrokerFormat({
      headers: [],
      sampleRows: [{ a: 1 }]
    });

    expect(result.status).toBe('error');
    expect(result.verification.passed).toBe(false);
  });

  it('should handle case-insensitive header matching', () => {
    const result = detectBrokerFormat({
      headers: [
        'CURRENCYPRIMARY',
        'SYMBOL',
        'TRADEDATE',
        'TRADEPRICE',
        'QUANTITY',
        'BUY/SELL',
        'IBCOMMISSION'
      ],
      sampleRows: [
        {
          CURRENCYPRIMARY: 'EUR',
          SYMBOL: 'SAP',
          TRADEDATE: '20230501',
          TRADEPRICE: 120.5,
          QUANTITY: 10,
          'BUY/SELL': 'BUY',
          IBCOMMISSION: -2
        }
      ]
    });

    expect(result.status).toBe('success');
    expect(result.data.detectedBroker).toBe('interactive_brokers');
  });

  it('should rank multiple broker matches by confidence', () => {
    const result = detectBrokerFormat({
      headers: [
        'Date',
        'Symbol',
        'Currency',
        'Price',
        'Quantity',
        'Action',
        'Fee'
      ],
      sampleRows: [
        {
          Date: '2023-01-15',
          Symbol: 'AAPL',
          Currency: 'USD',
          Price: 150,
          Quantity: 10,
          Action: 'BUY',
          Fee: 5
        }
      ]
    });

    expect(result.status).toBe('success');
    expect(result.data.allMatches.length).toBeGreaterThan(0);

    // Should be sorted descending by confidence
    for (let i = 1; i < result.data.allMatches.length; i++) {
      expect(result.data.allMatches[i - 1].confidence).toBeGreaterThanOrEqual(
        result.data.allMatches[i].confidence
      );
    }
  });
});
