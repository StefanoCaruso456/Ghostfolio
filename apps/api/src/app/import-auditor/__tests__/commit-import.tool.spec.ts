import type { MappedActivity } from '../schemas/validate-transactions.schema';
import { transformToCreateOrderDtos } from '../tools/commit-import.tool';

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

describe('transformToCreateOrderDtos', () => {
  it('should transform a valid BUY activity', () => {
    const { orders, errors } = transformToCreateOrderDtos([makeActivity()]);

    expect(errors).toHaveLength(0);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toEqual({
      currency: 'USD',
      date: '2023-09-16T00:00:00.000Z',
      fee: 19,
      quantity: 5,
      symbol: 'MSFT',
      type: 'BUY',
      unitPrice: 298.58
    });
  });

  it('should normalize lowercase type to uppercase', () => {
    const { orders, errors } = transformToCreateOrderDtos([
      makeActivity({ type: 'buy' }),
      makeActivity({ type: 'sell', symbol: 'AAPL' }),
      makeActivity({ type: 'Dividend', symbol: 'GOOG' })
    ]);

    expect(errors).toHaveLength(0);
    expect(orders).toHaveLength(3);
    expect(orders[0].type).toBe('BUY');
    expect(orders[1].type).toBe('SELL');
    expect(orders[2].type).toBe('DIVIDEND');
  });

  it('should default fee to 0 when null', () => {
    const { orders } = transformToCreateOrderDtos([
      makeActivity({ fee: null })
    ]);

    expect(orders[0].fee).toBe(0);
  });

  it('should default quantity and unitPrice to 0 when null', () => {
    const { orders } = transformToCreateOrderDtos([
      makeActivity({ quantity: null, unitPrice: null, type: 'FEE' })
    ]);

    expect(orders[0].quantity).toBe(0);
    expect(orders[0].unitPrice).toBe(0);
  });

  it('should include accountId when account is provided', () => {
    const { orders } = transformToCreateOrderDtos([
      makeActivity({ account: 'my-account-id' })
    ]);

    expect(orders[0].accountId).toBe('my-account-id');
  });

  it('should include comment when provided', () => {
    const { orders } = transformToCreateOrderDtos([
      makeActivity({ comment: 'My first order' })
    ]);

    expect(orders[0].comment).toBe('My first order');
  });

  it('should not include accountId when account is null', () => {
    const { orders } = transformToCreateOrderDtos([
      makeActivity({ account: null })
    ]);

    expect(orders[0].accountId).toBeUndefined();
  });

  it('should not set dataSource — ImportService handles this', () => {
    const { orders } = transformToCreateOrderDtos([makeActivity()]);

    expect(orders[0]).not.toHaveProperty('dataSource');
  });

  it('should report error for invalid type', () => {
    const { orders, errors } = transformToCreateOrderDtos([
      makeActivity({ type: 'INVALID' })
    ]);

    expect(orders).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(0);
    expect(errors[0].message).toContain('Invalid activity type');
  });

  it('should report error for missing symbol', () => {
    const { errors } = transformToCreateOrderDtos([
      makeActivity({ symbol: null })
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('symbol');
  });

  it('should report error for missing currency', () => {
    const { errors } = transformToCreateOrderDtos([
      makeActivity({ currency: null })
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('currency');
  });

  it('should report error for missing date', () => {
    const { errors } = transformToCreateOrderDtos([
      makeActivity({ date: null })
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('date');
  });

  it('should handle FEE activity correctly', () => {
    const { orders, errors } = transformToCreateOrderDtos([
      makeActivity({
        type: 'FEE',
        symbol: 'Account Opening Fee',
        quantity: 0,
        unitPrice: 0,
        fee: 49
      })
    ]);

    expect(errors).toHaveLength(0);
    expect(orders[0].type).toBe('FEE');
    expect(orders[0].fee).toBe(49);
    expect(orders[0].quantity).toBe(0);
  });

  it('should transform multiple activities with mixed results', () => {
    const { orders, errors } = transformToCreateOrderDtos([
      makeActivity({ symbol: 'MSFT' }),
      makeActivity({ type: 'INVALID' }), // error
      makeActivity({ symbol: 'AAPL', unitPrice: 150 }),
      makeActivity({ currency: null }) // error
    ]);

    expect(orders).toHaveLength(2);
    expect(errors).toHaveLength(2);
    expect(errors[0].row).toBe(1);
    expect(errors[1].row).toBe(3);
  });
});
