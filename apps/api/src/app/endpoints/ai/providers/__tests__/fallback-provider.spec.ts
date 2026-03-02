/**
 * Tests for FallbackMarketDataProvider — provider chain + last-known cache.
 */
import { FallbackMarketDataProvider } from '../fallback-market-data.provider';
import type { MarketDataProvider } from '../market-data.types';
import { QuoteCacheService } from '../quote-cache.service';

// ─── Mock provider factory ──────────────────────────────────────────

function createMockProvider(
  name: string,
  overrides: Partial<MarketDataProvider> = {}
): MarketDataProvider {
  return {
    name: name as any,
    fetchQuotes: jest.fn().mockResolvedValue({
      quotes: [],
      errors: [],
      providerLatencyMs: 0,
      rateLimited: false
    }),
    fetchHistory: jest.fn().mockResolvedValue({
      symbol: 'AAPL',
      points: [],
      truncated: false,
      providerLatencyMs: 0,
      rateLimited: false,
      error: 'not implemented'
    }),
    fetchFundamentals: jest.fn().mockResolvedValue({
      data: null,
      unavailableFields: [],
      providerLatencyMs: 0,
      rateLimited: false,
      error: 'not implemented'
    }),
    fetchNews: jest.fn().mockResolvedValue({
      items: [],
      providerLatencyMs: 0,
      rateLimited: false,
      error: 'not implemented'
    }),
    ...overrides
  };
}

describe('FallbackMarketDataProvider', () => {
  let quoteCache: QuoteCacheService;

  beforeEach(() => {
    quoteCache = new QuoteCacheService({ memoryTtlMs: 60_000 });
  });

  describe('fetchQuotes — fallback chain', () => {
    it('returns quotes from primary provider on success', async () => {
      const primary = createMockProvider('yahoo', {
        fetchQuotes: jest.fn().mockResolvedValue({
          quotes: [
            {
              symbol: 'AAPL',
              name: 'Apple',
              price: 185,
              currency: 'USD',
              dayChangeAbs: 2,
              dayChangePct: 1.1,
              asOf: new Date().toISOString(),
              source: 'yahoo'
            }
          ],
          errors: [],
          providerLatencyMs: 100,
          rateLimited: false
        })
      });
      const secondary = createMockProvider('coingecko');

      const fallback = new FallbackMarketDataProvider(
        [primary, secondary],
        quoteCache
      );
      const result = await fallback.fetchQuotes(['AAPL']);

      expect(result.quotes).toHaveLength(1);
      expect(result.quotes[0].symbol).toBe('AAPL');
      expect(result.quotes[0].price).toBe(185);
      // Secondary should NOT be called
      expect(secondary.fetchQuotes).not.toHaveBeenCalled();
    });

    it('falls back to secondary provider when primary fails', async () => {
      const primary = createMockProvider('yahoo', {
        fetchQuotes: jest
          .fn()
          .mockRejectedValue(new Error('EAI_AGAIN: DNS failed'))
      });
      const secondary = createMockProvider('coingecko', {
        fetchQuotes: jest.fn().mockResolvedValue({
          quotes: [
            {
              symbol: 'AAPL',
              name: 'Apple',
              price: 184,
              currency: 'USD',
              dayChangeAbs: null,
              dayChangePct: null,
              asOf: new Date().toISOString(),
              source: 'coingecko'
            }
          ],
          errors: [],
          providerLatencyMs: 200,
          rateLimited: false
        })
      });

      const fallback = new FallbackMarketDataProvider(
        [primary, secondary],
        quoteCache
      );
      const result = await fallback.fetchQuotes(['AAPL']);

      expect(result.quotes).toHaveLength(1);
      expect(result.quotes[0].source).toBe('coingecko');
    });

    it('returns last-known cache when all providers fail', async () => {
      // Pre-populate the cache
      await quoteCache.put({
        symbol: 'AAPL',
        name: 'Apple',
        price: 180,
        currency: 'USD',
        dayChangeAbs: null,
        dayChangePct: null,
        asOf: '2026-02-26T10:00:00Z',
        source: 'yahoo'
      });

      const primary = createMockProvider('yahoo', {
        fetchQuotes: jest
          .fn()
          .mockRejectedValue(new Error('DNS resolution failed'))
      });
      const secondary = createMockProvider('coingecko', {
        fetchQuotes: jest.fn().mockRejectedValue(new Error('Network error'))
      });

      const fallback = new FallbackMarketDataProvider(
        [primary, secondary],
        quoteCache
      );
      const result = await fallback.fetchQuotes(['AAPL']);

      expect(result.quotes).toHaveLength(1);
      expect(result.quotes[0].price).toBe(180);
      expect(result.errors).toHaveLength(0);
    });

    it('returns error when all providers fail and no cache', async () => {
      const primary = createMockProvider('yahoo', {
        fetchQuotes: jest.fn().mockRejectedValue(new Error('DNS failed'))
      });

      const fallback = new FallbackMarketDataProvider([primary], quoteCache);
      const result = await fallback.fetchQuotes(['XYZNOTREAL']);

      expect(result.quotes).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].symbol).toBe('XYZNOTREAL');
    });

    it('handles partial success across providers', async () => {
      const primary = createMockProvider('yahoo', {
        fetchQuotes: jest.fn().mockResolvedValue({
          quotes: [
            {
              symbol: 'AAPL',
              name: 'Apple',
              price: 185,
              currency: 'USD',
              dayChangeAbs: 2,
              dayChangePct: 1,
              asOf: new Date().toISOString(),
              source: 'yahoo'
            }
          ],
          errors: [{ symbol: 'BTC', error: 'Not found on Yahoo' }],
          providerLatencyMs: 100,
          rateLimited: false
        })
      });
      const secondary = createMockProvider('coingecko', {
        fetchQuotes: jest.fn().mockResolvedValue({
          quotes: [
            {
              symbol: 'BTC',
              name: 'Bitcoin',
              price: 65000,
              currency: 'USD',
              dayChangeAbs: null,
              dayChangePct: null,
              asOf: new Date().toISOString(),
              source: 'coingecko'
            }
          ],
          errors: [],
          providerLatencyMs: 150,
          rateLimited: false
        })
      });

      const fallback = new FallbackMarketDataProvider(
        [primary, secondary],
        quoteCache
      );
      const result = await fallback.fetchQuotes(['AAPL', 'BTC']);

      expect(result.quotes).toHaveLength(2);
      const symbols = result.quotes.map((q) => q.symbol);
      expect(symbols).toContain('AAPL');
      expect(symbols).toContain('BTC');
    });
  });

  describe('fetchHistory — fallback chain', () => {
    it('returns history from primary on success', async () => {
      const primary = createMockProvider('yahoo', {
        fetchHistory: jest.fn().mockResolvedValue({
          symbol: 'AAPL',
          points: [{ date: '2026-02-25', close: 185, volume: 1000 }],
          truncated: false,
          providerLatencyMs: 100,
          rateLimited: false,
          error: null
        })
      });

      const fallback = new FallbackMarketDataProvider([primary], quoteCache);
      const result = await fallback.fetchHistory('AAPL', '1mo', '1d');

      expect(result.points).toHaveLength(1);
      expect(result.error).toBeNull();
    });

    it('falls back when primary errors', async () => {
      const primary = createMockProvider('yahoo', {
        fetchHistory: jest.fn().mockResolvedValue({
          symbol: 'BTC',
          points: [],
          truncated: false,
          providerLatencyMs: 50,
          rateLimited: false,
          error: 'DNS failed'
        })
      });
      const secondary = createMockProvider('coingecko', {
        fetchHistory: jest.fn().mockResolvedValue({
          symbol: 'BTC',
          points: [{ date: '2026-02-25', close: 65000, volume: null }],
          truncated: false,
          providerLatencyMs: 200,
          rateLimited: false,
          error: null
        })
      });

      const fallback = new FallbackMarketDataProvider(
        [primary, secondary],
        quoteCache
      );
      const result = await fallback.fetchHistory('BTC', '1mo', '1d');

      expect(result.points).toHaveLength(1);
      expect(result.error).toBeNull();
    });
  });

  describe('fetchFundamentals — fallback chain', () => {
    it('falls back when primary returns no data', async () => {
      const primary = createMockProvider('yahoo', {
        fetchFundamentals: jest.fn().mockResolvedValue({
          data: null,
          unavailableFields: [],
          providerLatencyMs: 50,
          rateLimited: false,
          error: 'Not found'
        })
      });
      const secondary = createMockProvider('coingecko', {
        fetchFundamentals: jest.fn().mockResolvedValue({
          data: { symbol: 'BTC', marketCap: 1e12 },
          unavailableFields: ['pe', 'eps'],
          providerLatencyMs: 100,
          rateLimited: false,
          error: null
        })
      });

      const fallback = new FallbackMarketDataProvider(
        [primary, secondary],
        quoteCache
      );
      const result = await fallback.fetchFundamentals('BTC');

      expect(result.data).not.toBeNull();
      expect(result.data!.marketCap).toBe(1e12);
    });
  });

  describe('portfolio tool graceful degradation', () => {
    it('portfolio summary returns partial status when hasErrors', () => {
      // This test verifies the builder pattern, not the provider
      const {
        buildPortfolioSummary
      } = require('../../tools/get-portfolio-summary.tool');

      const mockDetails = {
        holdings: {
          AAPL: {
            name: 'Apple Inc.',
            symbol: 'AAPL',
            allocationInPercentage: 0.5,
            currency: 'USD',
            assetClass: 'EQUITY',
            assetSubClass: null
          },
          MSFT: {
            name: 'Microsoft',
            symbol: 'MSFT',
            allocationInPercentage: 0.3,
            currency: 'USD',
            assetClass: 'EQUITY',
            assetSubClass: null
          }
        },
        accounts: { acc1: {} },
        hasErrors: true
      };

      const result = buildPortfolioSummary(mockDetails, {
        userCurrency: 'USD'
      });

      expect(result.status).toBe('success');
      expect(result.data).toBeDefined();
      expect(result.data.holdingsCount).toBe(2);
      expect(result.quoteMetadata).toBeDefined();
      expect(result.quoteMetadata.quoteStatus).toBe('partial');
      expect(result.message).toContain('stale');
    });

    it('portfolio summary returns fresh status when no errors', () => {
      const {
        buildPortfolioSummary
      } = require('../../tools/get-portfolio-summary.tool');

      const mockDetails = {
        holdings: {
          AAPL: {
            name: 'Apple Inc.',
            symbol: 'AAPL',
            allocationInPercentage: 1.0,
            currency: 'USD',
            assetClass: 'EQUITY',
            assetSubClass: null
          }
        },
        accounts: {},
        hasErrors: false
      };

      const result = buildPortfolioSummary(mockDetails, {
        userCurrency: 'USD'
      });

      expect(result.status).toBe('success');
      expect(result.quoteMetadata).toBeDefined();
      expect(result.quoteMetadata.quoteStatus).toBe('fresh');
    });
  });
});
