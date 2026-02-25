/**
 * Market Data Provider — CoinGecko adapter for cryptocurrency data.
 *
 * Isolated from tool logic: tools call these functions, never CoinGecko directly.
 * All responses are normalized to our schema types.
 *
 * API key handling:
 *   - API_KEY_COINGECKO_DEMO → demo tier (api.coingecko.com)
 *   - API_KEY_COINGECKO_PRO  → pro tier (pro-api.coingecko.com)
 *   - No key = public tier (heavily rate-limited)
 *
 * Rate limit handling: returns error + warning "rate_limited" — no retries.
 */
import { Logger } from '@nestjs/common';

import type {
  FundamentalsResult,
  HistoryResult,
  MarketDataProvider,
  NewsResult,
  NormalizedFundamentals,
  NormalizedQuote,
  QuoteError,
  QuoteResult
} from './market-data.types';

const logger = new Logger('CoinGeckoMarketDataProvider');

const DEFAULT_TIMEOUT_MS = 10_000;

// ─── Range → days mapping for CoinGecko market_chart endpoint ────

const RANGE_TO_DAYS: Record<string, number> = {
  '5d': 5,
  '1mo': 30,
  '3mo': 90,
  '6mo': 180,
  '1y': 365,
  '5y': 365 * 5
};

// ─── CoinGecko Provider ─────────────────────────────────────────

export class CoinGeckoMarketDataProvider implements MarketDataProvider {
  public readonly name = 'coingecko' as const;
  private readonly apiUrl: string;
  private readonly headers: Record<string, string> = {};

  public constructor() {
    const apiKeyDemo = process.env.API_KEY_COINGECKO_DEMO ?? '';
    const apiKeyPro = process.env.API_KEY_COINGECKO_PRO ?? '';

    this.apiUrl = 'https://api.coingecko.com/api/v3';

    if (apiKeyDemo) {
      this.headers['x-cg-demo-api-key'] = apiKeyDemo;
    }

    if (apiKeyPro) {
      this.apiUrl = 'https://pro-api.coingecko.com/api/v3';
      this.headers['x-cg-pro-api-key'] = apiKeyPro;
    }

    logger.log(
      `CoinGecko provider initialized (${apiKeyPro ? 'pro' : apiKeyDemo ? 'demo' : 'public'} tier)`
    );
  }

  public async fetchQuotes(symbols: string[]): Promise<QuoteResult> {
    const start = Date.now();
    const quotes: NormalizedQuote[] = [];
    const errors: QuoteError[] = [];
    let rateLimited = false;

    if (symbols.length === 0) {
      return { quotes, errors, providerLatencyMs: 0, rateLimited: false };
    }

    try {
      const queryParams = new URLSearchParams({
        ids: symbols.join(','),
        vs_currencies: 'usd',
        include_24hr_change: 'true',
        include_last_updated_at: 'true'
      });

      const response = await fetch(
        `${this.apiUrl}/simple/price?${queryParams.toString()}`,
        {
          headers: this.headers,
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
        }
      );

      if (response.status === 429) {
        rateLimited = true;

        return {
          quotes: [],
          errors: symbols.map((s) => ({ symbol: s, error: 'rate_limited' })),
          providerLatencyMs: Date.now() - start,
          rateLimited: true
        };
      }

      const data = await response.json();

      for (const symbol of symbols) {
        const coinData = data[symbol];

        if (!coinData || coinData.usd === undefined) {
          errors.push({
            symbol,
            error: `No quote data for ${symbol}`
          });
          continue;
        }

        quotes.push({
          symbol,
          name: symbol,
          price: coinData.usd,
          currency: 'USD',
          dayChangeAbs: null,
          dayChangePct: coinData.usd_24h_change ?? null,
          asOf: coinData.last_updated_at
            ? new Date(coinData.last_updated_at * 1000).toISOString()
            : new Date().toISOString(),
          source: 'coingecko'
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        rateLimited = true;
        errors.push(
          ...symbols.map((s) => ({ symbol: s, error: 'rate_limited' }))
        );
      } else {
        errors.push(...symbols.map((s) => ({ symbol: s, error: msg })));
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
    _interval: string // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<HistoryResult> {
    const start = Date.now();

    const days = RANGE_TO_DAYS[range];

    if (!days) {
      return {
        symbol,
        points: [],
        truncated: false,
        providerLatencyMs: Date.now() - start,
        rateLimited: false,
        error: `Unsupported range: ${range}`
      };
    }

    try {
      const queryParams = new URLSearchParams({
        vs_currency: 'usd',
        days: days.toString(),
        interval: 'daily'
      });

      const response = await fetch(
        `${this.apiUrl}/coins/${symbol}/market_chart?${queryParams.toString()}`,
        {
          headers: this.headers,
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
        }
      );

      if (response.status === 429) {
        return {
          symbol,
          points: [],
          truncated: false,
          providerLatencyMs: Date.now() - start,
          rateLimited: true,
          error: 'rate_limited'
        };
      }

      const data = await response.json();

      if (data.error || data.status) {
        const errMsg =
          data.error?.status?.error_message ??
          data.status?.error_message ??
          'Unknown CoinGecko error';
        return {
          symbol,
          points: [],
          truncated: false,
          providerLatencyMs: Date.now() - start,
          rateLimited: false,
          error: errMsg
        };
      }

      const rawPrices: [number, number][] = data.prices ?? [];
      const rawVolumes: [number, number][] = data.total_volumes ?? [];
      const volumeMap = new Map(
        rawVolumes.map(([ts, vol]) => [
          new Date(ts).toISOString().split('T')[0],
          vol
        ])
      );

      const maxPoints = 260;
      const truncated = rawPrices.length > maxPoints;

      const points = rawPrices.slice(-maxPoints).map(([timestamp, close]) => {
        const date = new Date(timestamp).toISOString().split('T')[0];

        return {
          date,
          close,
          volume: volumeMap.get(date) ?? null
        };
      });

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
      const response = await fetch(`${this.apiUrl}/coins/${symbol}`, {
        headers: this.headers,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
      });

      if (response.status === 429) {
        return {
          data: null,
          unavailableFields: [],
          providerLatencyMs: Date.now() - start,
          rateLimited: true,
          error: 'rate_limited'
        };
      }

      const coin = await response.json();

      if (!coin || coin.error) {
        return {
          data: null,
          unavailableFields: [],
          providerLatencyMs: Date.now() - start,
          rateLimited: false,
          error: coin?.error ?? `No data for ${symbol}`
        };
      }

      const marketData = coin.market_data ?? {};

      const marketCap = marketData.market_cap?.usd ?? null;
      // Crypto doesn't have traditional P/E, EPS, dividend yield
      const unavailableFields = [
        'pe',
        'forwardPe',
        'eps',
        'dividendYield',
        'industry'
      ];

      const data: NormalizedFundamentals = {
        symbol,
        marketCap,
        pe: null,
        forwardPe: null,
        eps: null,
        dividendYield: null,
        sector: coin.categories?.[0] ?? 'Cryptocurrency',
        industry: null,
        updatedAt: new Date().toISOString(),
        source: 'coingecko'
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
    _limit: number, // eslint-disable-line @typescript-eslint/no-unused-vars
    _recencyDays: number // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<NewsResult> {
    // CoinGecko free/demo API does not have a dedicated news endpoint.
    // Return empty with a clear message so the LLM can fall back gracefully.
    return {
      items: [],
      providerLatencyMs: 0,
      rateLimited: false,
      error: `CoinGecko does not provide a news endpoint. Use Yahoo Finance for news on ${symbol}.`
    };
  }
}
