/**
 * Tests for QuoteCacheService — in-memory TTL cache + persistent last-known fallback.
 */
import type { NormalizedQuote } from '../market-data.types';
import { QuoteCacheService } from '../quote-cache.service';

function makeQuote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
  return {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    price: 185.5,
    currency: 'USD',
    dayChangeAbs: 2.3,
    dayChangePct: 1.26,
    asOf: new Date().toISOString(),
    source: 'yahoo-finance2',
    ...overrides
  };
}

describe('QuoteCacheService', () => {
  let cache: QuoteCacheService;

  beforeEach(() => {
    cache = new QuoteCacheService({ memoryTtlMs: 100 }); // 100ms TTL for fast tests
  });

  describe('memory cache', () => {
    it('returns null for unknown symbol', () => {
      expect(cache.getFromMemory('UNKNOWN')).toBeNull();
    });

    it('stores and retrieves a fresh quote', async () => {
      const quote = makeQuote({ symbol: 'AAPL' });
      await cache.put(quote);

      const result = cache.getFromMemory('AAPL');
      expect(result).not.toBeNull();
      expect(result!.symbol).toBe('AAPL');
      expect(result!.price).toBe(185.5);
    });

    it('is case-insensitive on symbol lookup', async () => {
      const quote = makeQuote({ symbol: 'MSFT' });
      await cache.put(quote);

      expect(cache.getFromMemory('msft')).not.toBeNull();
      expect(cache.getFromMemory('Msft')).not.toBeNull();
      expect(cache.getFromMemory('MSFT')).not.toBeNull();
    });

    it('returns null after TTL expires', async () => {
      const quote = makeQuote({ symbol: 'GOOG' });
      await cache.put(quote);

      expect(cache.getFromMemory('GOOG')).not.toBeNull();

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 150));

      expect(cache.getFromMemory('GOOG')).toBeNull();
    });
  });

  describe('last known (without Prisma)', () => {
    it('returns stale quote from memory even after TTL', async () => {
      const quote = makeQuote({ symbol: 'TSLA', price: 250.0 });
      await cache.put(quote);

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 150));

      // Memory cache is expired...
      expect(cache.getFromMemory('TSLA')).toBeNull();

      // ...but last-known still returns it as stale
      const lastKnown = await cache.getLastKnown('TSLA');
      expect(lastKnown).not.toBeNull();
      expect(lastKnown!.isStale).toBe(true);
      expect(lastKnown!.price).toBe(250.0);
      expect(lastKnown!.symbol).toBe('TSLA');
    });

    it('returns null for completely unknown symbol', async () => {
      const lastKnown = await cache.getLastKnown('XYZNOTREAL');
      expect(lastKnown).toBeNull();
    });

    it('getLastKnownMany returns map of cached quotes', async () => {
      await cache.put(makeQuote({ symbol: 'AAPL', price: 185 }));
      await cache.put(makeQuote({ symbol: 'GOOG', price: 140 }));

      const result = await cache.getLastKnownMany(['AAPL', 'GOOG', 'UNKNOWN']);
      expect(result.size).toBe(2);
      expect(result.has('AAPL')).toBe(true);
      expect(result.has('GOOG')).toBe(true);
      expect(result.has('UNKNOWN')).toBe(false);
    });
  });

  describe('putMany', () => {
    it('stores multiple quotes', async () => {
      const quotes = [
        makeQuote({ symbol: 'AAPL', price: 185 }),
        makeQuote({ symbol: 'MSFT', price: 420 }),
        makeQuote({ symbol: 'GOOG', price: 140 })
      ];

      await cache.putMany(quotes);

      expect(cache.getFromMemory('AAPL')?.price).toBe(185);
      expect(cache.getFromMemory('MSFT')?.price).toBe(420);
      expect(cache.getFromMemory('GOOG')?.price).toBe(140);
    });
  });

  describe('clear', () => {
    it('empties all caches', async () => {
      await cache.put(makeQuote({ symbol: 'AAPL' }));
      expect(cache.getFromMemory('AAPL')).not.toBeNull();

      cache.clear();
      expect(cache.getFromMemory('AAPL')).toBeNull();
    });
  });
});
