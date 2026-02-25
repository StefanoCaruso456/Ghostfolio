/**
 * CachedMarketDataProvider — TTL-cache wrapper around any MarketDataProvider.
 *
 * Wraps fetchQuotes, fetchHistory, fetchFundamentals, and fetchNews with
 * configurable TTLs. Uses an in-memory Map with TTL eviction.
 *
 * Cache TTLs (configurable via env):
 *   - Quotes:       60s  (real-time-ish, reduces rate-limit hits)
 *   - History:      300s (5min — historical data changes slowly)
 *   - Fundamentals: 300s (5min — PE/marketCap update infrequently)
 *   - News:         120s (2min — balance freshness vs. API cost)
 */
import { Logger } from '@nestjs/common';

import type {
  FundamentalsResult,
  HistoryResult,
  MarketDataProvider,
  MarketDataProviderName,
  NewsResult,
  QuoteResult
} from './market-data.types';

const logger = new Logger('CachedMarketDataProvider');

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const DEFAULT_QUOTE_TTL_MS = 60_000; // 60s
const DEFAULT_HISTORY_TTL_MS = 300_000; // 5min
const DEFAULT_FUNDAMENTALS_TTL_MS = 300_000; // 5min
const DEFAULT_NEWS_TTL_MS = 120_000; // 2min

export class CachedMarketDataProvider implements MarketDataProvider {
  public readonly name: MarketDataProviderName;

  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly quoteTtlMs: number;
  private readonly historyTtlMs: number;
  private readonly fundamentalsTtlMs: number;
  private readonly newsTtlMs: number;

  // Track cache hits for telemetry
  private _cacheHits = 0;

  public constructor(
    private readonly delegate: MarketDataProvider,
    options?: {
      quoteTtlMs?: number;
      historyTtlMs?: number;
      fundamentalsTtlMs?: number;
      newsTtlMs?: number;
    }
  ) {
    this.name = delegate.name;
    this.quoteTtlMs = options?.quoteTtlMs ?? DEFAULT_QUOTE_TTL_MS;
    this.historyTtlMs = options?.historyTtlMs ?? DEFAULT_HISTORY_TTL_MS;
    this.fundamentalsTtlMs =
      options?.fundamentalsTtlMs ?? DEFAULT_FUNDAMENTALS_TTL_MS;
    this.newsTtlMs = options?.newsTtlMs ?? DEFAULT_NEWS_TTL_MS;

    logger.log(
      `Cache enabled: quotes=${this.quoteTtlMs}ms, history=${this.historyTtlMs}ms, fundamentals=${this.fundamentalsTtlMs}ms, news=${this.newsTtlMs}ms`
    );
  }

  /** Number of cache hits since last reset. */
  public get cacheHits(): number {
    return this._cacheHits;
  }

  /** Reset hit counter (call after telemetry flush). */
  public resetCacheHits(): void {
    this._cacheHits = 0;
  }

  public async fetchQuotes(symbols: string[]): Promise<QuoteResult> {
    const key = `quote:${[...symbols].sort().join(',')}`;
    const cached = this.getFromCache<QuoteResult>(key);

    if (cached) {
      this._cacheHits++;
      return cached;
    }

    const result = await this.delegate.fetchQuotes(symbols);

    // Only cache successful (non-rate-limited) results
    if (!result.rateLimited && result.quotes.length > 0) {
      this.setInCache(key, result, this.quoteTtlMs);
    }

    return result;
  }

  public async fetchHistory(
    symbol: string,
    range: string,
    interval: string
  ): Promise<HistoryResult> {
    const key = `history:${symbol}:${range}:${interval}`;
    const cached = this.getFromCache<HistoryResult>(key);

    if (cached) {
      this._cacheHits++;
      return cached;
    }

    const result = await this.delegate.fetchHistory(symbol, range, interval);

    if (!result.rateLimited && !result.error && result.points.length > 0) {
      this.setInCache(key, result, this.historyTtlMs);
    }

    return result;
  }

  public async fetchFundamentals(symbol: string): Promise<FundamentalsResult> {
    const key = `fundamentals:${symbol}`;
    const cached = this.getFromCache<FundamentalsResult>(key);

    if (cached) {
      this._cacheHits++;
      return cached;
    }

    const result = await this.delegate.fetchFundamentals(symbol);

    if (!result.rateLimited && !result.error && result.data) {
      this.setInCache(key, result, this.fundamentalsTtlMs);
    }

    return result;
  }

  public async fetchNews(
    symbol: string,
    limit: number,
    recencyDays: number
  ): Promise<NewsResult> {
    const key = `news:${symbol}:${limit}:${recencyDays}`;
    const cached = this.getFromCache<NewsResult>(key);

    if (cached) {
      this._cacheHits++;
      return cached;
    }

    const result = await this.delegate.fetchNews(symbol, limit, recencyDays);

    if (!result.rateLimited && !result.error && result.items.length > 0) {
      this.setInCache(key, result, this.newsTtlMs);
    }

    return result;
  }

  // ─── Internal cache helpers ────────────────────────────────────────

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  private setInCache<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });

    // Lazy eviction: clean up expired entries when cache grows large
    if (this.cache.size > 500) {
      this.evictExpired();
    }
  }

  private evictExpired(): void {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        evicted++;
      }
    }

    if (evicted > 0) {
      logger.debug(`Evicted ${evicted} expired cache entries`);
    }
  }
}
