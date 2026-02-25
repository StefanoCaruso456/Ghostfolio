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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getYahoo(): Promise<any> {
    // Dynamic import for ESM module — typed as any to avoid TS issues
    // with yahoo-finance2's complex conditional module types
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('s', 'return import(s)') as (
      s: string
    ) => Promise<any>;
    const mod = await dynamicImport('yahoo-finance2');
    return mod.default ?? mod;
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
        const result = await yahooFinance.quote(symbol);

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
      const result = await yahooFinance.chart(symbol, {
        period1: period1Fn(),
        interval: yahooInterval as any
      });

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
      const result = await yahooFinance.quoteSummary(symbol, {
        modules: ['summaryDetail', 'defaultKeyStatistics', 'assetProfile']
      });

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
      const result = await yahooFinance.search(symbol, {
        newsCount: Math.min(limit, 10)
      });

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

    logger.log(`Initializing market data provider: ${providerName}`);

    // Currently only Yahoo is implemented; CoinGecko can be added later
    providerInstance = new YahooMarketDataProvider();
  }

  return providerInstance;
}
