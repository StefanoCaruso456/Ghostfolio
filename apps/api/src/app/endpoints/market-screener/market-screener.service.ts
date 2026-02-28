import { RedisCacheService } from '@ghostfolio/api/app/redis-cache/redis-cache.service';
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
import YahooFinance from 'yahoo-finance2';

type ScreenerCategory =
  | 'most_actives'
  | 'day_gainers'
  | 'day_losers'
  | 'trending';

@Injectable()
export class MarketScreenerService {
  private readonly logger = new Logger(MarketScreenerService.name);
  private readonly yahooFinance = new YahooFinance({
    suppressNotices: ['yahooSurvey']
  });

  public constructor(
    private readonly redisCacheService: RedisCacheService
  ) {}

  public async getScreener(
    category: ScreenerCategory,
    count: number = 20
  ): Promise<MarketScreenerResponse> {
    const cacheKey = `market-screener:${category}:${count}`;

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

      if (category === 'trending') {
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
        `Market screener error for ${category}: ${error.message}`
      );

      throw new HttpException(
        'Yahoo Finance screener unavailable',
        HttpStatus.BAD_GATEWAY
      );
    }
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
