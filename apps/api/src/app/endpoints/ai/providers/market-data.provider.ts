/**
 * Market Data Provider — Yahoo Finance adapter using yahoo-finance2.
 *
 * Isolated from tool logic: tools call these functions, never yahoo-finance2 directly.
 * All responses are normalized to our schema types.
 *
 * Rate limit handling: returns error + warning "rate_limited" — no retries.
 * No API key required for yahoo-finance2.
 */
import { Logger } from '@nestjs/common';

import { CachedMarketDataProvider } from './cached-market-data.provider';
import { CoinGeckoMarketDataProvider } from './coingecko-market-data.provider';
import type {
  FundamentalsResult,
  HistoryResult,
  MarketDataProvider,
  NewsResult,
  NormalizedFundamentals,
  NormalizedNewsItem,
  NormalizedQuote,
  QuoteError,
  QuoteResult
} from './market-data.types';

const logger = new Logger('MarketDataProvider');

/** Per-request timeout for Yahoo Finance API calls (15s) */
const YAHOO_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Wraps a promise with a timeout. Rejects with a clear message if the
 * underlying call (e.g. yahoo-finance2 fetch) hangs beyond the limit.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label}: timed out after ${ms / 1000}s`)),
        ms
      )
    )
  ]);
}

// ─── Range → yahoo-finance2 period mapping ──────────────────────────

const RANGE_TO_PERIOD1: Record<string, () => Date> = {
  '5d': () => daysAgo(5),
  '1mo': () => daysAgo(30),
  '3mo': () => daysAgo(90),
  '6mo': () => daysAgo(180),
  '1y': () => daysAgo(365),
  '5y': () => daysAgo(365 * 5)
};

const INTERVAL_MAP: Record<string, string> = {
  '1d': '1d',
  '1wk': '1wk'
};

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// ─── Yahoo Finance Provider ─────────────────────────────────────────

export class YahooMarketDataProvider implements MarketDataProvider {
  public readonly name = 'yahoo' as const;

  // Cached instance — yahoo-finance2 v3 requires `new YahooFinance()`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private yahooInstance: any = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getYahoo(): Promise<any> {
    if (this.yahooInstance) {
      return this.yahooInstance;
    }

    // Dynamic import for ESM module — typed as any to avoid TS issues
    // with yahoo-finance2's complex conditional module types
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('s', 'return import(s)') as (
      s: string
    ) => Promise<any>;
    const mod = await dynamicImport('yahoo-finance2');
    const YahooFinance = mod.default ?? mod;

    // yahoo-finance2 v3: must instantiate the class
    this.yahooInstance =
      typeof YahooFinance === 'function' && YahooFinance.prototype
        ? new YahooFinance({ suppressNotices: ['yahooSurvey'] })
        : YahooFinance;

    return this.yahooInstance;
  }

  public async fetchQuotes(symbols: string[]): Promise<QuoteResult> {
    const start = Date.now();
    const quotes: NormalizedQuote[] = [];
    const errors: QuoteError[] = [];
    let rateLimited = false;

    let yahooFinance: any;

    try {
      yahooFinance = await this.getYahoo();
    } catch (err) {
      return {
        quotes: [],
        errors: symbols.map((s) => ({
          symbol: s,
          error: 'yahoo-finance2 module unavailable'
        })),
        providerLatencyMs: Date.now() - start,
        rateLimited: false
      };
    }

    for (const symbol of symbols) {
      try {
        const result = await withTimeout(
          yahooFinance.quote(symbol),
          YAHOO_REQUEST_TIMEOUT_MS,
          symbol
        );

        if (!result?.regularMarketPrice) {
          errors.push({ symbol, error: `No quote data for ${symbol}` });
          continue;
        }

        quotes.push({
          symbol: result.symbol ?? symbol,
          name: result.shortName ?? result.longName ?? null,
          price: result.regularMarketPrice,
          currency: result.currency ?? 'USD',
          dayChangeAbs: result.regularMarketChange ?? null,
          dayChangePct: result.regularMarketChangePercent ?? null,
          asOf: result.regularMarketTime
            ? new Date(
                typeof result.regularMarketTime === 'number'
                  ? result.regularMarketTime * 1000
                  : result.regularMarketTime
              ).toISOString()
            : new Date().toISOString(),
          source: 'yahoo-finance2'
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
          rateLimited = true;
          errors.push({ symbol, error: 'rate_limited' });
        } else if (
          msg.includes('fetch failed') ||
          msg.includes('getaddrinfo') ||
          msg.includes('ENOTFOUND') ||
          msg.includes('EAI_AGAIN')
        ) {
          logger.warn(`Network error fetching ${symbol}: ${msg}`);
          errors.push({
            symbol,
            error: `Network error: Unable to reach Yahoo Finance API. The server may not have internet access or DNS resolution failed.`
          });
        } else if (msg.includes('timed out')) {
          logger.warn(`Timeout fetching ${symbol}: ${msg}`);
          errors.push({ symbol, error: msg });
        } else {
          errors.push({ symbol, error: msg });
        }
      }
    }

    return {
      quotes,
      errors,
      providerLatencyMs: Date.now() - start,
      rateLimited
    };
  }

  public async fetchHistory(
    symbol: string,
    range: string,
    interval: string
  ): Promise<HistoryResult> {
    const start = Date.now();

    try {
      const yahooFinance = await this.getYahoo();

      const period1Fn = RANGE_TO_PERIOD1[range];

      if (!period1Fn) {
        return {
          symbol,
          points: [],
          truncated: false,
          providerLatencyMs: Date.now() - start,
          rateLimited: false,
          error: `Unsupported range: ${range}`
        };
      }

      const yahooInterval = INTERVAL_MAP[interval] || '1d';
      const result = await withTimeout(
        yahooFinance.chart(symbol, {
          period1: period1Fn(),
          interval: yahooInterval as any
        }),
        YAHOO_REQUEST_TIMEOUT_MS,
        `${symbol} history`
      );

      const rawQuotes = result?.quotes ?? [];
      const maxPoints = 260;
      const truncated = rawQuotes.length > maxPoints;

      const points = rawQuotes.slice(-maxPoints).map((q: any) => ({
        date: q.date ? new Date(q.date).toISOString().split('T')[0] : 'unknown',
        close: q.close ?? 0,
        volume: q.volume ?? null
      }));

      return {
        symbol,
        points,
        truncated,
        providerLatencyMs: Date.now() - start,
        rateLimited: false,
        error: null
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const rateLimited =
        msg.includes('429') || msg.toLowerCase().includes('rate limit');

      return {
        symbol,
        points: [],
        truncated: false,
        providerLatencyMs: Date.now() - start,
        rateLimited,
        error: rateLimited ? 'rate_limited' : msg
      };
    }
  }

  public async fetchFundamentals(symbol: string): Promise<FundamentalsResult> {
    const start = Date.now();

    try {
      const yahooFinance = await this.getYahoo();
      const result = await withTimeout(
        yahooFinance.quoteSummary(symbol, {
          modules: ['summaryDetail', 'defaultKeyStatistics', 'assetProfile']
        }),
        YAHOO_REQUEST_TIMEOUT_MS,
        `${symbol} fundamentals`
      );

      if (!result) {
        return {
          data: null,
          unavailableFields: [],
          providerLatencyMs: Date.now() - start,
          rateLimited: false,
          error: `No fundamentals data for ${symbol}`
        };
      }

      const sd = result.summaryDetail ?? ({} as any);
      const ks = result.defaultKeyStatistics ?? ({} as any);
      const ap = result.assetProfile ?? ({} as any);

      const unavailableFields: string[] = [];
      const checkField = (name: string, value: unknown) => {
        if (value === undefined || value === null) {
          unavailableFields.push(name);
        }
      };

      const marketCap = sd.marketCap ?? null;
      const pe = sd.trailingPE ?? null;
      const forwardPe = ks.forwardPE ?? sd.forwardPE ?? null;
      const eps = ks.trailingEps ?? null;
      const dividendYield = sd.dividendYield ?? null;
      const sector = ap.sector ?? null;
      const industry = ap.industry ?? null;

      checkField('marketCap', marketCap);
      checkField('pe', pe);
      checkField('forwardPe', forwardPe);
      checkField('eps', eps);
      checkField('dividendYield', dividendYield);
      checkField('sector', sector);
      checkField('industry', industry);

      const data: NormalizedFundamentals = {
        symbol,
        marketCap,
        pe,
        forwardPe,
        eps,
        dividendYield,
        sector,
        industry,
        updatedAt: new Date().toISOString(),
        source: 'yahoo-finance2'
      };

      return {
        data,
        unavailableFields,
        providerLatencyMs: Date.now() - start,
        rateLimited: false,
        error: null
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const rateLimited =
        msg.includes('429') || msg.toLowerCase().includes('rate limit');

      return {
        data: null,
        unavailableFields: [],
        providerLatencyMs: Date.now() - start,
        rateLimited,
        error: rateLimited ? 'rate_limited' : msg
      };
    }
  }

  public async fetchNews(
    symbol: string,
    limit: number,
    _recencyDays: number // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<NewsResult> {
    const start = Date.now();

    try {
      const yahooFinance = await this.getYahoo();

      // yahoo-finance2 search returns news items
      const result = await withTimeout(
        yahooFinance.search(symbol, {
          newsCount: Math.min(limit, 10)
        }),
        YAHOO_REQUEST_TIMEOUT_MS,
        `${symbol} news`
      );

      const items: NormalizedNewsItem[] = (result?.news ?? [])
        .slice(0, limit)
        .map((n: any) => ({
          title: n.title ?? 'Untitled',
          publisher: n.publisher ?? null,
          url: n.link ?? null,
          publishedAt: n.providerPublishTime
            ? new Date(
                typeof n.providerPublishTime === 'number'
                  ? n.providerPublishTime * 1000
                  : n.providerPublishTime
              ).toISOString()
            : new Date().toISOString(),
          source: 'yahoo-finance2'
        }));

      return {
        items,
        providerLatencyMs: Date.now() - start,
        rateLimited: false,
        error: null
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const rateLimited =
        msg.includes('429') || msg.toLowerCase().includes('rate limit');

      return {
        items: [],
        providerLatencyMs: Date.now() - start,
        rateLimited,
        error: rateLimited ? 'rate_limited' : msg
      };
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────

let providerInstance: MarketDataProvider | null = null;

export function getMarketDataProvider(): MarketDataProvider {
  if (!providerInstance) {
    const providerName = process.env.MARKET_DATA_PROVIDER || 'yahoo';
    const cacheEnabled = process.env.MARKET_DATA_CACHE_ENABLED !== 'false';

    logger.log(`Initializing market data provider: ${providerName}`);

    let baseProvider: MarketDataProvider;

    switch (providerName) {
      case 'coingecko':
        baseProvider = new CoinGeckoMarketDataProvider();
        break;
      case 'yahoo':
      default:
        baseProvider = new YahooMarketDataProvider();
        break;
    }

    if (cacheEnabled) {
      providerInstance = new CachedMarketDataProvider(baseProvider);
      logger.log('Market data caching enabled');
    } else {
      providerInstance = baseProvider;
    }
  }

  return providerInstance;
}

/**
 * Get cache stats for telemetry. Returns null if caching is disabled.
 */
export function getMarketDataCacheStats(): {
  cacheEnabled: boolean;
  cacheHits: number;
} {
  if (providerInstance instanceof CachedMarketDataProvider) {
    return {
      cacheEnabled: true,
      cacheHits: providerInstance.cacheHits
    };
  }

  return { cacheEnabled: false, cacheHits: 0 };
}

/**
 * Reset cache hit counter after telemetry flush.
 */
export function resetMarketDataCacheHits(): void {
  if (providerInstance instanceof CachedMarketDataProvider) {
    providerInstance.resetCacheHits();
  }
}

/** Reset the singleton — used for testing or dynamic provider switching. */
export function resetMarketDataProvider(): void {
  providerInstance = null;
}
