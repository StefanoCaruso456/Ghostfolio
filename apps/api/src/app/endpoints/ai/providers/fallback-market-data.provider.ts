/**
 * FallbackMarketDataProvider — Wraps multiple providers in a fallback chain.
 *
 * Tries providers in order. If a provider fails (error/empty/rate-limited),
 * falls back to the next. For quotes, also integrates with QuoteCacheService
 * to return last-known stale quotes when all providers fail.
 *
 * Also implements parallel (batched) quote fetching instead of sequential.
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
import {
  type CachedQuote,
  type QuoteCacheService,
  getQuoteCacheService
} from './quote-cache.service';

const logger = new Logger('FallbackMarketDataProvider');

/** Max symbols to fetch in a single parallel batch */
const QUOTE_BATCH_SIZE = 10;

/** Timeout for an entire provider attempt (all symbols) */
const PROVIDER_TIMEOUT_MS = 20_000;

function withProviderTimeout<T>(
  promise: Promise<T>,
  providerName: string,
  method: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `${providerName}.${method}: timed out after ${PROVIDER_TIMEOUT_MS / 1000}s`
            )
          ),
        PROVIDER_TIMEOUT_MS
      )
    )
  ]);
}

export class FallbackMarketDataProvider implements MarketDataProvider {
  public readonly name: MarketDataProviderName;
  private readonly quoteCache: QuoteCacheService;

  public constructor(
    private readonly providers: MarketDataProvider[],
    quoteCache?: QuoteCacheService
  ) {
    if (providers.length === 0) {
      throw new Error(
        'FallbackMarketDataProvider requires at least one provider'
      );
    }

    this.name = providers[0].name;
    this.quoteCache = quoteCache ?? getQuoteCacheService();
  }

  /**
   * Fetch quotes with fallback chain + last-known cache.
   *
   * Strategy:
   * 1. Try each provider in order
   * 2. If a provider returns some quotes, cache them and collect failures
   * 3. For any symbols that ALL providers failed on, try last-known cache
   * 4. Return combined result with isStale metadata
   *
   * Quotes are fetched in parallel batches of QUOTE_BATCH_SIZE.
   */
  public async fetchQuotes(symbols: string[]): Promise<QuoteResult> {
    const start = Date.now();
    const allQuotes = new Map<string, QuoteResult['quotes'][0]>();
    const remainingSymbols = new Set(symbols);
    let lastRateLimited = false;

    // Try each provider in sequence
    for (const provider of this.providers) {
      if (remainingSymbols.size === 0) break;

      const symbolsToFetch = [...remainingSymbols];

      try {
        const result = await withProviderTimeout(
          this.fetchQuotesInBatches(provider, symbolsToFetch),
          provider.name,
          'fetchQuotes'
        );

        if (result.rateLimited) {
          lastRateLimited = true;
        }

        // Collect successful quotes
        for (const quote of result.quotes) {
          allQuotes.set(quote.symbol.toUpperCase(), quote);
          remainingSymbols.delete(quote.symbol);
          remainingSymbols.delete(quote.symbol.toUpperCase());
        }

        // Cache successful quotes
        if (result.quotes.length > 0) {
          this.quoteCache.putMany(result.quotes).catch(() => {
            // Non-blocking
          });
        }

        if (remainingSymbols.size === 0) break;

        logger.log(
          `${provider.name}: Got ${result.quotes.length}/${symbolsToFetch.length} quotes, ${remainingSymbols.size} remaining`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `${provider.name} fetchQuotes failed for ${symbolsToFetch.length} symbols: ${msg}`
        );
        // Continue to next provider
      }
    }

    // For any remaining symbols, try last-known cache
    const staleQuotes: CachedQuote[] = [];
    const finalErrors: QuoteResult['errors'] = [];

    if (remainingSymbols.size > 0) {
      const lastKnown = await this.quoteCache.getLastKnownMany([
        ...remainingSymbols
      ]);

      for (const sym of remainingSymbols) {
        const cached = lastKnown.get(sym.toUpperCase());

        if (cached) {
          staleQuotes.push(cached);
          allQuotes.set(sym.toUpperCase(), cached);
        } else {
          finalErrors.push({
            symbol: sym,
            error:
              'All providers failed and no cached quote available for this symbol'
          });
        }
      }
    }

    const quotes = [...allQuotes.values()];

    return {
      quotes,
      errors: finalErrors,
      providerLatencyMs: Date.now() - start,
      rateLimited: lastRateLimited,
      // Extra metadata for consumers
      ...(staleQuotes.length > 0
        ? {
            staleCount: staleQuotes.length,
            staleSymbols: staleQuotes.map((q) => q.symbol)
          }
        : {})
    } as QuoteResult & { staleCount?: number; staleSymbols?: string[] };
  }

  /**
   * Fetch quotes in parallel batches to avoid sequential 1-by-1 fetching.
   */
  private async fetchQuotesInBatches(
    provider: MarketDataProvider,
    symbols: string[]
  ): Promise<QuoteResult> {
    if (symbols.length <= QUOTE_BATCH_SIZE) {
      return provider.fetchQuotes(symbols);
    }

    // Split into batches and fetch in parallel
    const batches: string[][] = [];

    for (let i = 0; i < symbols.length; i += QUOTE_BATCH_SIZE) {
      batches.push(symbols.slice(i, i + QUOTE_BATCH_SIZE));
    }

    const results = await Promise.allSettled(
      batches.map((batch) => provider.fetchQuotes(batch))
    );

    // Merge results
    const mergedQuotes: QuoteResult['quotes'] = [];
    const mergedErrors: QuoteResult['errors'] = [];
    let totalLatency = 0;
    let anyRateLimited = false;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        mergedQuotes.push(...result.value.quotes);
        mergedErrors.push(...result.value.errors);
        totalLatency = Math.max(totalLatency, result.value.providerLatencyMs);

        if (result.value.rateLimited) {
          anyRateLimited = true;
        }
      } else {
        // Batch failed entirely — add errors for all symbols in that batch
        // We don't know which batch, so add a generic error
        logger.warn(`Batch fetch failed: ${result.reason}`);
      }
    }

    return {
      quotes: mergedQuotes,
      errors: mergedErrors,
      providerLatencyMs: totalLatency,
      rateLimited: anyRateLimited
    };
  }

  /**
   * Fetch history with fallback chain.
   */
  public async fetchHistory(
    symbol: string,
    range: string,
    interval: string
  ): Promise<HistoryResult> {
    for (const provider of this.providers) {
      try {
        const result = await withProviderTimeout(
          provider.fetchHistory(symbol, range, interval),
          provider.name,
          'fetchHistory'
        );

        if (!result.error && !result.rateLimited && result.points.length > 0) {
          return result;
        }

        // If this provider returned an error, try next
        if (result.error || result.rateLimited) {
          logger.log(
            `${provider.name} fetchHistory(${symbol}) failed: ${result.error || 'rate_limited'}, trying next`
          );
          continue;
        }

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`${provider.name} fetchHistory(${symbol}) threw: ${msg}`);
      }
    }

    // All providers failed
    return {
      symbol,
      points: [],
      truncated: false,
      providerLatencyMs: 0,
      rateLimited: false,
      error: `All ${this.providers.length} providers failed to fetch history for ${symbol}`
    };
  }

  /**
   * Fetch fundamentals with fallback chain.
   */
  public async fetchFundamentals(symbol: string): Promise<FundamentalsResult> {
    for (const provider of this.providers) {
      try {
        const result = await withProviderTimeout(
          provider.fetchFundamentals(symbol),
          provider.name,
          'fetchFundamentals'
        );

        if (!result.error && !result.rateLimited && result.data) {
          return result;
        }

        if (result.error || result.rateLimited) {
          logger.log(
            `${provider.name} fetchFundamentals(${symbol}) failed: ${result.error || 'rate_limited'}, trying next`
          );
          continue;
        }

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `${provider.name} fetchFundamentals(${symbol}) threw: ${msg}`
        );
      }
    }

    return {
      data: null,
      unavailableFields: [],
      providerLatencyMs: 0,
      rateLimited: false,
      error: `All ${this.providers.length} providers failed to fetch fundamentals for ${symbol}`
    };
  }

  /**
   * Fetch news with fallback chain.
   */
  public async fetchNews(
    symbol: string,
    limit: number,
    recencyDays: number
  ): Promise<NewsResult> {
    for (const provider of this.providers) {
      try {
        const result = await withProviderTimeout(
          provider.fetchNews(symbol, limit, recencyDays),
          provider.name,
          'fetchNews'
        );

        if (!result.error && !result.rateLimited && result.items.length > 0) {
          return result;
        }

        if (result.error || result.rateLimited) {
          logger.log(
            `${provider.name} fetchNews(${symbol}) failed: ${result.error || 'rate_limited'}, trying next`
          );
          continue;
        }

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`${provider.name} fetchNews(${symbol}) threw: ${msg}`);
      }
    }

    return {
      items: [],
      providerLatencyMs: 0,
      rateLimited: false,
      error: `All ${this.providers.length} providers failed to fetch news for ${symbol}`
    };
  }
}
