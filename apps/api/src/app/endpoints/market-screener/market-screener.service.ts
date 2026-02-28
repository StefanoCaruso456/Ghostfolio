import { RedisCacheService } from '@ghostfolio/api/app/redis-cache/redis-cache.service';
import { YahooFinanceDataEnhancerService } from '@ghostfolio/api/services/data-provider/data-enhancer/yahoo-finance/yahoo-finance.service';
import {
  MarketScreenerItem,
  MarketScreenerResponse
} from '@ghostfolio/common/interfaces';

import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger
} from '@nestjs/common';
import ms from 'ms';

type ScreenerCategory =
  | 'most_actives'
  | 'day_gainers'
  | 'day_losers'
  | 'trending';

@Injectable()
export class MarketScreenerService {
  private readonly logger = new Logger(MarketScreenerService.name);

  public constructor(
    private readonly redisCacheService: RedisCacheService,
    private readonly yahooFinanceDataEnhancerService: YahooFinanceDataEnhancerService
  ) {}

  private get yahooFinance() {
    return this.yahooFinanceDataEnhancerService.getYahooFinanceInstance();
  }

  public async getScreener(
    category: ScreenerCategory,
    count: number = 20,
    market: 'stocks' | 'crypto' = 'stocks'
  ): Promise<MarketScreenerResponse> {
    const cacheKey = `market-screener:${market}:${category}:${count}`;

    try {
      const cached = await this.redisCacheService.get(cacheKey);

      if (cached) {
        const parsed =
          typeof cached === 'string' ? JSON.parse(cached) : cached;

        return { ...parsed, cached: true };
      }
    } catch (error) {
      this.logger.warn(`Cache read error: ${error.message}`);
    }

    try {
      let items: MarketScreenerItem[];

      if (market === 'crypto') {
        items = await this.fetchCryptoQuotes(category, count);
      } else if (category === 'trending') {
        items = await this.fetchTrending(count);
      } else {
        items = await this.fetchScreener(category, count);
      }

      const response: MarketScreenerResponse = {
        cached: false,
        category,
        items
      };

      try {
        await this.redisCacheService.set(
          cacheKey,
          JSON.stringify(response),
          ms('60 seconds')
        );
      } catch (error) {
        this.logger.warn(`Cache write error: ${error.message}`);
      }

      return response;
    } catch (error) {
      this.logger.error(
        `Market screener error for ${market}/${category}: ${error.message}`
      );

      throw new HttpException(
        'Yahoo Finance screener unavailable',
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  private readonly topCryptoSymbols = [
    'BTC-USD',
    'ETH-USD',
    'SOL-USD',
    'XRP-USD',
    'DOGE-USD',
    'ADA-USD',
    'AVAX-USD',
    'DOT-USD',
    'MATIC-USD',
    'LINK-USD',
    'SHIB-USD',
    'LTC-USD',
    'UNI-USD',
    'ATOM-USD',
    'XLM-USD',
    'FIL-USD',
    'NEAR-USD',
    'APT-USD',
    'ARB-USD',
    'OP-USD'
  ];

  private async fetchCryptoQuotes(
    category: ScreenerCategory,
    count: number
  ): Promise<MarketScreenerItem[]> {
    const quotes = await this.yahooFinance.quote(this.topCryptoSymbols);
    const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

    let items: MarketScreenerItem[] = quotesArray
      .filter((q) => q.regularMarketPrice != null)
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortName || q.longName || q.symbol,
        price: q.regularMarketPrice ?? 0,
        change: q.regularMarketChange ?? 0,
        changePercent: q.regularMarketChangePercent ?? 0,
        volume: q.regularMarketVolume,
        marketCap: q.marketCap,
        currency: q.currency || 'USD'
      }));

    // Sort based on category
    switch (category) {
      case 'day_gainers':
        items.sort((a, b) => b.changePercent - a.changePercent);
        break;
      case 'day_losers':
        items.sort((a, b) => a.changePercent - b.changePercent);
        break;
      case 'most_actives':
        items.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
        break;
      case 'trending':
      default:
        items.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
        break;
    }

    return items.slice(0, count);
  }

  private async fetchScreener(
    scrId: 'most_actives' | 'day_gainers' | 'day_losers',
    count: number
  ): Promise<MarketScreenerItem[]> {
    const result = await this.yahooFinance.screener({
      scrIds: scrId,
      count
    });

    return result.quotes.map((q) => ({
      symbol: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      price: q.regularMarketPrice ?? 0,
      change: q.regularMarketChange ?? 0,
      changePercent: q.regularMarketChangePercent ?? 0,
      volume: q.regularMarketVolume,
      marketCap: q.marketCap,
      currency: q.currency || 'USD'
    }));
  }

  private async fetchTrending(count: number): Promise<MarketScreenerItem[]> {
    const trending = await this.yahooFinance.trendingSymbols('US', { count });
    const symbols = trending.quotes.map((q) => q.symbol);

    if (symbols.length === 0) {
      return [];
    }

    const quotes = await this.yahooFinance.quote(symbols);
    const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

    return quotesArray.map((q) => ({
      symbol: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      price: q.regularMarketPrice ?? 0,
      change: q.regularMarketChange ?? 0,
      changePercent: q.regularMarketChangePercent ?? 0,
      volume: q.regularMarketVolume,
      marketCap: q.marketCap,
      currency: q.currency || 'USD'
    }));
  }
}
