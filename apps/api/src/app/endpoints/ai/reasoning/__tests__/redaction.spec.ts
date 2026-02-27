import { redact, redactRecord } from '../redaction';

describe('redaction utilities', () => {
  describe('redact()', () => {
    it('should return empty string for null/undefined', () => {
      expect(redact(null)).toEqual({
        text: '',
        redactionApplied: false,
        truncated: false
      });
      expect(redact(undefined)).toEqual({
        text: '',
        redactionApplied: false,
        truncated: false
      });
    });

    it('should pass through clean strings unchanged', () => {
      const input = 'Hello, this is a normal string with no sensitive data.';
      const result = redact(input);
      expect(result.text).toBe(input);
      expect(result.redactionApplied).toBe(false);
      expect(result.truncated).toBe(false);
    });

    it('should redact API keys (sk- pattern)', () => {
      const input = 'Using key sk-1234567890abcdef1234';
      const result = redact(input);
      expect(result.text).toContain('[REDACTED]');
      expect(result.text).not.toContain('sk-1234567890abcdef1234');
      expect(result.redactionApplied).toBe(true);
    });

    it('should redact Bearer tokens', () => {
      const input =
        'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const result = redact(input);
      expect(result.text).toContain('[REDACTED]');
      expect(result.text).not.toContain('eyJhbGciOiJIUzI1NiI');
      expect(result.redactionApplied).toBe(true);
    });

    it('should redact email addresses', () => {
      const input = 'Contact user at john.doe@example.com for details';
      const result = redact(input);
      expect(result.text).toContain('[REDACTED]');
      expect(result.text).not.toContain('john.doe@example.com');
      expect(result.redactionApplied).toBe(true);
    });

    it('should redact SSN patterns', () => {
      const input = 'SSN: 123-45-6789';
      const result = redact(input);
      expect(result.text).toContain('[REDACTED]');
      expect(result.text).not.toContain('123-45-6789');
      expect(result.redactionApplied).toBe(true);
    });

    it('should redact multiple sensitive items in one string', () => {
      const input =
        'User john@test.com has key sk-abcdefghijklmnop and token secret_abc123defghij';
      const result = redact(input);
      expect(result.text).not.toContain('john@test.com');
      expect(result.text).not.toContain('sk-abcdefghijklmnop');
      expect(result.redactionApplied).toBe(true);
    });

    it('should truncate strings exceeding max bytes', () => {
      const input = 'A'.repeat(10_000);
      const result = redact(input, 1024);
      expect(result.truncated).toBe(true);
      expect(result.text).toContain('[TRUNCATED]');
      expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(1024);
    });

    it('should stringify objects', () => {
      const input = { key: 'value', nested: { num: 42 } };
      const result = redact(input);
      expect(result.text).toContain('"key": "value"');
      expect(result.text).toContain('"num": 42');
      expect(result.redactionApplied).toBe(false);
    });

    it('should redact sensitive data within JSON objects', () => {
      const input = {
        apiKey: 'sk-abcdefghijklmnopqrs',
        email: 'admin@company.com',
        safeValue: 'portfolio'
      };
      const result = redact(input);
      expect(result.text).not.toContain('sk-abcdefghijklmnop');
      expect(result.text).not.toContain('admin@company.com');
      expect(result.text).toContain('portfolio');
      expect(result.redactionApplied).toBe(true);
    });
  });

  describe('redactRecord()', () => {
    it('should return empty data for undefined input', () => {
      const result = redactRecord(undefined);
      expect(result.data).toEqual({});
      expect(result.redactionApplied).toBe(false);
    });

    it('should redact individual values in a record', () => {
      const input = {
        symbol: 'AAPL',
        email: 'user@example.com',
        dateRange: 'ytd'
      };
      const result = redactRecord(input);
      expect(result.data.symbol).toBe('AAPL');
      expect(result.data.email).toContain('[REDACTED]');
      expect(result.data.dateRange).toBe('ytd');
      expect(result.redactionApplied).toBe(true);
    });

    it('should report no redaction when record is clean', () => {
      const input = {
        symbol: 'MSFT',
        dateRange: '1y',
        limit: '50'
      };
      const result = redactRecord(input);
      expect(result.redactionApplied).toBe(false);
    });
  });
});
