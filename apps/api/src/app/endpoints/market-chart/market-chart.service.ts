import { RedisCacheService } from '@ghostfolio/api/app/redis-cache/redis-cache.service';
import { YahooFinanceDataEnhancerService } from '@ghostfolio/api/services/data-provider/data-enhancer/yahoo-finance/yahoo-finance.service';
import { getYahooCircuitBreaker } from '@ghostfolio/api/services/data-provider/yahoo-finance/yahoo-finance-circuit-breaker';
import { DATE_FORMAT } from '@ghostfolio/common/helper';
import { MarketChartResponse } from '@ghostfolio/common/interfaces';

import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { format, subDays, subMonths, subYears } from 'date-fns';
import ms from 'ms';
import { ChartResultArray } from 'yahoo-finance2/esm/src/modules/chart';

const STALE_CACHE_TTL = ms('24 hours');

@Injectable()
export class MarketChartService {
  private readonly logger = new Logger(MarketChartService.name);

  public constructor(
    private readonly redisCacheService: RedisCacheService,
    private readonly yahooFinanceDataEnhancerService: YahooFinanceDataEnhancerService
  ) {}

  public async getChart(
    symbol: string,
    range: string
  ): Promise<MarketChartResponse> {
    const cacheKey = `market-chart:${symbol}:${range}`;
    const staleCacheKey = `market-chart-stale:${symbol}:${range}`;

    // Check fresh cache (5 min TTL)
    try {
      const cached = await this.redisCacheService.get(cacheKey);

      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;

        return { ...parsed, cached: true };
      }
    } catch (error) {
      this.logger.warn(`Cache read error: ${error.message}`);
    }

    // Circuit breaker: if Yahoo is known to be down, serve stale cache
    const breaker = getYahooCircuitBreaker();

    if (!breaker.canExecute()) {
      this.logger.warn(
        `Circuit breaker OPEN — serving stale cache for ${symbol} (${range})`
      );

      return this.getStaleOrThrow(staleCacheKey, symbol);
    }

    // Convert Ghostfolio internal symbol to Yahoo Finance format
    const yahooSymbol =
      this.yahooFinanceDataEnhancerService.convertToYahooFinanceSymbol(symbol);

    const yahooFinance =
      this.yahooFinanceDataEnhancerService.getYahooFinanceInstance();

    const now = new Date();
    const period1 = this.getPeriodStart(range, now);
    const interval = this.getInterval(range);

    // Try fetching chart data with one retry after clearing stale crumb
    let lastError: Error;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result: ChartResultArray = await yahooFinance.chart(yahooSymbol, {
          interval,
          period1: format(period1, DATE_FORMAT),
          period2: format(now, DATE_FORMAT)
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

        // Cache for 5 minutes (fresh) and 24 hours (stale fallback)
        try {
          await Promise.all([
            this.redisCacheService.set(
              cacheKey,
              JSON.stringify(response),
              ms('5 minutes')
            ),
            this.redisCacheService.set(
              staleCacheKey,
              JSON.stringify(response),
              STALE_CACHE_TTL
            )
          ]);
        } catch (error) {
          this.logger.warn(`Cache write error: ${error.message}`);
        }

        breaker.recordSuccess();

        return response;
      } catch (error) {
        lastError = error;

        this.logger.warn(
          `Yahoo Finance chart attempt ${attempt + 1} failed for ${symbol} (yahoo=${yahooSymbol}): [${error.name}] ${error.message}`
        );

        if (attempt === 0) {
          // yahoo-finance2 caches the first crumb fetch result at module
          // scope. If it rejects (e.g. transient network error on deploy),
          // ALL subsequent requests fail permanently. Clear the state so
          // the retry can re-initialize the crumb.
          try {
            const cookieJar = (yahooFinance as any)._opts?.cookieJar;

            if (cookieJar) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { getCrumbClear } = require('yahoo-finance2/lib/getCrumb');
              await getCrumbClear(cookieJar);
              this.logger.log(
                'Cleared Yahoo Finance crumb/cookie state, retrying...'
              );
            }
          } catch (clearError) {
            this.logger.warn(
              `Failed to clear crumb state: ${clearError.message}`
            );
          }
        }
      }
    }

    breaker.recordFailure();

    this.logger.error(
      `Yahoo Finance chart error for ${symbol} (yahoo=${yahooSymbol}, range=${range}): [${lastError.name}] ${lastError.message}`
    );

    // Try serving stale cached data instead of hard-failing
    return this.getStaleOrThrow(staleCacheKey, symbol);
  }

  /**
   * Attempt to return stale cached chart data. If no stale data exists,
   * throw BAD_GATEWAY so the frontend shows the retry button.
   */
  private async getStaleOrThrow(
    staleCacheKey: string,
    symbol: string
  ): Promise<MarketChartResponse> {
    try {
      const stale = await this.redisCacheService.get(staleCacheKey);

      if (stale) {
        const parsed = typeof stale === 'string' ? JSON.parse(stale) : stale;

        this.logger.log(
          `Serving stale cached chart data for ${symbol} (last updated: ${parsed.source})`
        );

        return { ...parsed, cached: true, source: 'Yahoo Finance (stale)' };
      }
    } catch (error) {
      this.logger.warn(`Stale cache read error: ${error.message}`);
    }

    throw new HttpException(
      `Chart data unavailable for ${symbol}`,
      HttpStatus.BAD_GATEWAY
    );
  }

  private getInterval(range: string): '1d' | '1wk' | '1mo' {
    switch (range) {
      case '5Y':
      case '10Y':
        return '1wk';
      case 'MAX':
        return '1mo';
      default:
        return '1d';
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
      case '5Y':
        return subYears(now, 5);
      case '10Y':
        return subYears(now, 10);
      case 'MAX':
        return new Date('1970-01-01');
      case '1M':
      default:
        return subMonths(now, 1);
    }
  }
}
