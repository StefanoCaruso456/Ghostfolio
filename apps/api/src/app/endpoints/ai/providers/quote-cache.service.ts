/**
 * QuoteCacheService — Two-layer quote cache for AI market data tools.
 *
 * Layer 1: In-memory TTL cache (60–300s) for hot quotes
 * Layer 2: Persistent "last known good" quotes in PostgreSQL (LastKnownQuote table)
 *
 * When live providers fail, we return the last-known quote with `isStale: true`
 * so portfolio tools can degrade gracefully instead of hard-failing.
 */
import { Logger } from '@nestjs/common';

import type { NormalizedQuote } from './market-data.types';

const logger = new Logger('QuoteCacheService');

export interface CachedQuote extends NormalizedQuote {
  isStale: boolean;
}

interface MemoryCacheEntry {
  quote: NormalizedQuote;
  expiresAt: number;
}

interface PersistentQuoteRow {
  symbol: string;
  price: number;
  currency: string;
  dayHigh: number | null;
  dayLow: number | null;
  open: number | null;
  prevClose: number | null;
  source: string;
  updatedAt: Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaClient = any;

const DEFAULT_MEMORY_TTL_MS = 60_000; // 60s
const MAX_MEMORY_ENTRIES = 1000;

export class QuoteCacheService {
  private readonly memoryCache = new Map<string, MemoryCacheEntry>();
  private readonly memoryTtlMs: number;
  private prisma: PrismaClient | null = null;

  public constructor(options?: { memoryTtlMs?: number }) {
    this.memoryTtlMs = options?.memoryTtlMs ?? DEFAULT_MEMORY_TTL_MS;
  }

  /**
   * Set the Prisma client for persistent storage.
   * Optional — if not set, only in-memory cache is used.
   */
  public setPrisma(prisma: PrismaClient): void {
    this.prisma = prisma;
  }

  /**
   * Get a fresh quote from memory cache. Returns null if expired or missing.
   */
  public getFromMemory(symbol: string): NormalizedQuote | null {
    const entry = this.memoryCache.get(symbol.toUpperCase());

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      // Don't delete — expired entries are still used by getLastKnown as stale fallback
      return null;
    }

    return entry.quote;
  }

  /**
   * Store a fresh quote in memory cache and persist to DB.
   */
  public async put(quote: NormalizedQuote): Promise<void> {
    const key = quote.symbol.toUpperCase();

    // Layer 1: in-memory
    this.memoryCache.set(key, {
      quote,
      expiresAt: Date.now() + this.memoryTtlMs
    });

    // Lazy eviction
    if (this.memoryCache.size > MAX_MEMORY_ENTRIES) {
      this.evictExpiredMemory();
    }

    // Layer 2: persistent (fire-and-forget)
    if (this.prisma) {
      try {
        await this.prisma.lastKnownQuote.upsert({
          where: { symbol: key },
          update: {
            price: quote.price,
            currency: quote.currency,
            dayHigh:
              quote.dayChangeAbs != null
                ? quote.price + quote.dayChangeAbs
                : null,
            dayLow: null,
            open: null,
            prevClose: null,
            source: quote.source
          },
          create: {
            symbol: key,
            price: quote.price,
            currency: quote.currency,
            source: quote.source
          }
        });
      } catch (err) {
        logger.warn(
          `Failed to persist last-known quote for ${key}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  /**
   * Store multiple fresh quotes at once.
   */
  public async putMany(quotes: NormalizedQuote[]): Promise<void> {
    await Promise.all(quotes.map((q) => this.put(q)));
  }

  /**
   * Get a stale/last-known quote from persistent storage.
   * Returns null if not found in DB either.
   */
  public async getLastKnown(symbol: string): Promise<CachedQuote | null> {
    const key = symbol.toUpperCase();

    // Check memory first (even if expired, still usable as stale)
    const memEntry = this.memoryCache.get(key);

    if (memEntry) {
      return { ...memEntry.quote, isStale: Date.now() > memEntry.expiresAt };
    }

    // Try persistent storage
    if (!this.prisma) {
      return null;
    }

    try {
      const row: PersistentQuoteRow | null =
        await this.prisma.lastKnownQuote.findUnique({
          where: { symbol: key }
        });

      if (!row) {
        return null;
      }

      return {
        symbol: row.symbol,
        name: null,
        price: row.price,
        currency: row.currency,
        dayChangeAbs: null,
        dayChangePct: null,
        asOf: row.updatedAt.toISOString(),
        source: `${row.source} (cached)`,
        isStale: true
      };
    } catch (err) {
      logger.warn(
        `Failed to read last-known quote for ${key}: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
  }

  /**
   * Get last-known quotes for multiple symbols.
   */
  public async getLastKnownMany(
    symbols: string[]
  ): Promise<Map<string, CachedQuote>> {
    const result = new Map<string, CachedQuote>();

    const promises = symbols.map(async (sym) => {
      const cached = await this.getLastKnown(sym);

      if (cached) {
        result.set(sym.toUpperCase(), cached);
      }
    });

    await Promise.all(promises);
    return result;
  }

  private evictExpiredMemory(): void {
    const now = Date.now();
    // Don't delete expired entries — they're still useful as stale fallbacks
    // Only delete when we exceed 2x the max
    if (this.memoryCache.size <= MAX_MEMORY_ENTRIES * 2) {
      return;
    }

    let evicted = 0;

    for (const [key, entry] of this.memoryCache) {
      if (now > entry.expiresAt) {
        this.memoryCache.delete(key);
        evicted++;
      }
    }

    if (evicted > 0) {
      logger.debug(`Evicted ${evicted} expired memory cache entries`);
    }
  }

  /** For testing: clear all caches */
  public clear(): void {
    this.memoryCache.clear();
  }
}

/** Singleton instance */
let instance: QuoteCacheService | null = null;

export function getQuoteCacheService(): QuoteCacheService {
  if (!instance) {
    instance = new QuoteCacheService();
  }

  return instance;
}

export function resetQuoteCacheService(): void {
  instance = null;
}
