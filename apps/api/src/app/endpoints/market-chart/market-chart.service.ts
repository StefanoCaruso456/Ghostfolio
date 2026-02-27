import { RedisCacheService } from '@ghostfolio/api/app/redis-cache/redis-cache.service';
import { MarketChartResponse } from '@ghostfolio/common/interfaces';

import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger
} from '@nestjs/common';
import { subDays, subMonths, subYears } from 'date-fns';
import ms from 'ms';
import YahooFinance from 'yahoo-finance2';
import { ChartResultArray } from 'yahoo-finance2/esm/src/modules/chart';

@Injectable()
export class MarketChartService {
  private readonly logger = new Logger(MarketChartService.name);
  private readonly yahooFinance = new YahooFinance({
    suppressNotices: ['yahooSurvey']
  });

  public constructor(
    private readonly redisCacheService: RedisCacheService
  ) {}

  public async getChart(
    symbol: string,
    range: string
  ): Promise<MarketChartResponse> {
    const cacheKey = `market-chart:${symbol}:${range}`;

    // Check cache
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

    // Fetch from Yahoo Finance
    try {
      const now = new Date();
      const period1 = this.getPeriodStart(range, now);

      const result: ChartResultArray = await this.yahooFinance.chart(symbol, {
        interval: '1d',
        period1,
        period2: now
      });

      const points: { t: number; v: number }[] = [];

      if (result.quotes) {
        for (const quote of result.quotes) {
          if (quote.date && quote.close != null) {
            points.push({
              t: quote.date.getTime(),
              v: quote.close
            });
          }
        }
      }

      const currency = result.meta?.currency ?? 'USD';

      const response: MarketChartResponse = {
        cached: false,
        currency,
        points,
        range,
        source: 'Yahoo Finance',
        symbol
      };

      // Cache for 60 seconds
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
        `Yahoo Finance error for ${symbol}: ${error.message}`
      );

      throw new HttpException(
        'Yahoo Finance unavailable',
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  private getPeriodStart(range: string, now: Date): Date {
    switch (range) {
      case '5D':
        return subDays(now, 5);
      case '6M':
        return subMonths(now, 6);
      case '1Y':
        return subYears(now, 1);
      case '1M':
      default:
        return subMonths(now, 1);
    }
  }
}
