/**
 * Market Data Provider — Normalized types for market data tools.
 *
 * All provider adapters (Yahoo, CoinGecko, etc.) normalize their
 * responses to these types before returning to tool functions.
 */

// ─── Quote ──────────────────────────────────────────────────────────

export interface NormalizedQuote {
  symbol: string;
  name: string | null;
  price: number;
  currency: string;
  dayChangeAbs: number | null;
  dayChangePct: number | null;
  asOf: string; // ISO 8601
  source: string;
}

export interface QuoteResult {
  quotes: NormalizedQuote[];
  errors: QuoteError[];
  providerLatencyMs: number;
  rateLimited: boolean;
}

export interface QuoteError {
  symbol: string;
  error: string;
}

// ─── History ────────────────────────────────────────────────────────

export interface HistoryPoint {
  date: string; // YYYY-MM-DD
  close: number;
  volume: number | null;
}

export interface HistoryResult {
  symbol: string;
  points: HistoryPoint[];
  truncated: boolean;
  providerLatencyMs: number;
  rateLimited: boolean;
  error: string | null;
}

/** Max history points to avoid huge payloads (1y daily = ~260) */
export const MAX_HISTORY_POINTS = 260;

// ─── Fundamentals ───────────────────────────────────────────────────

export interface NormalizedFundamentals {
  symbol: string;
  marketCap: number | null;
  pe: number | null;
  forwardPe: number | null;
  eps: number | null;
  dividendYield: number | null;
  sector: string | null;
  industry: string | null;
  updatedAt: string; // ISO 8601
  source: string;
}

export interface FundamentalsResult {
  data: NormalizedFundamentals | null;
  unavailableFields: string[];
  providerLatencyMs: number;
  rateLimited: boolean;
  error: string | null;
}

// ─── News ───────────────────────────────────────────────────────────

export interface NormalizedNewsItem {
  title: string;
  publisher: string | null;
  url: string | null;
  publishedAt: string; // ISO 8601
  source: string;
}

export interface NewsResult {
  items: NormalizedNewsItem[];
  providerLatencyMs: number;
  rateLimited: boolean;
  error: string | null;
}

// ─── Provider Interface ─────────────────────────────────────────────

export type MarketDataProviderName = 'yahoo' | 'coingecko';

export interface MarketDataProvider {
  readonly name: MarketDataProviderName;
  fetchQuotes(symbols: string[]): Promise<QuoteResult>;
  fetchHistory(
    symbol: string,
    range: string,
    interval: string
  ): Promise<HistoryResult>;
  fetchFundamentals(symbol: string): Promise<FundamentalsResult>;
  fetchNews(
    symbol: string,
    limit: number,
    recencyDays: number
  ): Promise<NewsResult>;
}
