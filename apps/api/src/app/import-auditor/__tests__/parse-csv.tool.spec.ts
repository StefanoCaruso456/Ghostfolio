import { parseCsv } from '../tools/parse-csv.tool';

describe('parseCSV Tool', () => {
  it('should parse a valid CSV with standard headers', () => {
    const csvContent = [
      'Date,Code,DataSource,Currency,Price,Quantity,Action,Fee,Note',
      '01-09-2021,Account Opening Fee,MANUAL,USD,0,0,fee,49,',
      '16-09-2021,MSFT,YAHOO,USD,298.580,5,buy,19.00,My first order'
    ].join('\n');

    const result = parseCsv({ csvContent, delimiter: ',' });

    expect(result.status).toBe('success');
    expect(result.data.rowCount).toBe(2);
    expect(result.data.headers).toEqual([
      'Date',
      'Code',
      'DataSource',
      'Currency',
      'Price',
      'Quantity',
      'Action',
      'Fee',
      'Note'
    ]);
    expect(result.data.rows).toHaveLength(2);
    expect(result.verification.passed).toBe(true);
    expect(result.verification.confidence).toBe(1.0);
    expect(result.verification.sources).toContain('papaparse');
  });

  it('should return error for empty CSV content', () => {
    const result = parseCsv({ csvContent: '', delimiter: ',' });

    expect(result.status).toBe('error');
    expect(result.data.rowCount).toBe(0);
    expect(result.verification.passed).toBe(false);
    expect(result.verification.confidence).toBe(0);
    expect(result.verification.errors).toContain('CSV content is empty');
  });

  it('should return error for whitespace-only CSV', () => {
    const result = parseCsv({
      csvContent: '   \n  \n  ',
      delimiter: ','
    });

    expect(result.status).toBe('error');
    expect(result.data.rowCount).toBe(0);
    expect(result.verification.passed).toBe(false);
  });

  it('should return error for headers-only CSV with no data rows', () => {
    const result = parseCsv({
      csvContent: 'Date,Symbol,Price,Quantity',
      delimiter: ','
    });

    expect(result.status).toBe('error');
    expect(result.data.headers).toEqual([
      'Date',
      'Symbol',
      'Price',
      'Quantity'
    ]);
    expect(result.data.rowCount).toBe(0);
    expect(result.verification.passed).toBe(false);
    expect(result.verification.errors).toContain(
      'CSV contains headers but no data rows'
    );
  });

  it('should handle semicolon-delimited CSV', () => {
    const csvContent = [
      'Date;Symbol;Currency;Price;Quantity;Type;Fee',
      '2023-01-15;AAPL;USD;150.00;10;BUY;5.00'
    ].join('\n');

    const result = parseCsv({ csvContent, delimiter: ';' });

    expect(result.status).toBe('success');
    expect(result.data.rowCount).toBe(1);
    expect(result.data.headers).toContain('Symbol');
    expect(result.data.rows[0]['Symbol']).toBe('AAPL');
  });

  it('should use dynamicTyping to parse numbers', () => {
    const csvContent = [
      'Symbol,Price,Quantity,Fee',
      'MSFT,298.58,5,19.00'
    ].join('\n');

    const result = parseCsv({ csvContent, delimiter: ',' });

    expect(result.status).toBe('success');
    expect(result.data.rows[0]['Price']).toBe(298.58);
    expect(result.data.rows[0]['Quantity']).toBe(5);
    expect(result.data.rows[0]['Fee']).toBe(19);
  });
});
