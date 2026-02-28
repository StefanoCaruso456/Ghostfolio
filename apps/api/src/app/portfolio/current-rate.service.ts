import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { LogPerformance } from '@ghostfolio/api/interceptors/performance-logging/performance-logging.interceptor';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { resetHours } from '@ghostfolio/common/helper';
import {
  AssetProfileIdentifier,
  DataProviderInfo,
  ResponseError
} from '@ghostfolio/common/interfaces';
import type { RequestWithUser } from '@ghostfolio/common/types';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { isBefore, isToday } from 'date-fns';
import { isEmpty, uniqBy } from 'lodash';

import { GetValueObject } from './interfaces/get-value-object.interface';
import { GetValuesObject } from './interfaces/get-values-object.interface';
import { GetValuesParams } from './interfaces/get-values-params.interface';

@Injectable()
export class CurrentRateService {
  private static readonly MARKET_DATA_PAGE_SIZE = 50000;
  private static readonly QUOTE_FETCH_TIMEOUT_MS = 30_000; // 30 seconds max for all quote fetching
  private static readonly QUOTE_REQUEST_TIMEOUT_MS = 10_000; // 10 seconds per Yahoo batch request
  private static readonly FALLBACK_CONCURRENCY = 20; // Parallel fallback DB queries

  private readonly logger = new Logger(CurrentRateService.name);

  public constructor(
    private readonly dataProviderService: DataProviderService,
    private readonly marketDataService: MarketDataService,
    private readonly orderService: OrderService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @LogPerformance
  // TODO: Pass user instead of using this.request.user
  public async getValues({
    dataGatheringItems,
    dateQuery
  }: GetValuesParams): Promise<GetValuesObject> {
    const dataProviderInfos: DataProviderInfo[] = [];

    const includesToday =
      (!dateQuery.lt || isBefore(new Date(), dateQuery.lt)) &&
      (!dateQuery.gte || isBefore(dateQuery.gte, new Date())) &&
      (!dateQuery.in || this.containsToday(dateQuery.in));

    const quoteErrors: ResponseError['errors'] = [];
    const today = resetHours(new Date());
    const values: GetValueObject[] = [];

    if (includesToday) {
      let quotesBySymbol: { [symbol: string]: any } = {};

      try {
        // Add a global timeout so slow data providers don't block the entire computation
        quotesBySymbol = await Promise.race([
          this.dataProviderService.getQuotes({
            items: dataGatheringItems,
            requestTimeout: CurrentRateService.QUOTE_REQUEST_TIMEOUT_MS,
            user: this.request?.user
          }),
          new Promise<{ [symbol: string]: any }>((resolve) =>
            setTimeout(() => {
              this.logger.warn(
                `getQuotes global timeout after ${CurrentRateService.QUOTE_FETCH_TIMEOUT_MS / 1000}s for ${dataGatheringItems.length} items — degrading gracefully`
              );
              resolve({});
            }, CurrentRateService.QUOTE_FETCH_TIMEOUT_MS)
          )
        ]);
      } catch (error) {
        this.logger.error(
          `getQuotes failed: ${error instanceof Error ? error.message : error}`
        );
        quotesBySymbol = {};
      }

      for (const { dataSource, symbol } of dataGatheringItems) {
        const quote = quotesBySymbol[symbol];

        if (quote?.dataProviderInfo) {
          dataProviderInfos.push(quote.dataProviderInfo);
        }

        if (quote?.marketPrice) {
          values.push({
            dataSource,
            symbol,
            date: today,
            marketPrice: quote.marketPrice
          });
        } else {
          quoteErrors.push({
            dataSource,
            symbol
          });
        }
      }
    }

    const assetProfileIdentifiers: AssetProfileIdentifier[] =
      dataGatheringItems.map(({ dataSource, symbol }) => {
        return { dataSource, symbol };
      });

    const marketDataCount = await this.marketDataService.getRangeCount({
      assetProfileIdentifiers,
      dateQuery
    });

    for (
      let i = 0;
      i < marketDataCount;
      i += CurrentRateService.MARKET_DATA_PAGE_SIZE
    ) {
      // Use page size to limit the number of records fetched at once
      const data = await this.marketDataService.getRange({
        assetProfileIdentifiers,
        dateQuery,
        skip: i,
        take: CurrentRateService.MARKET_DATA_PAGE_SIZE
      });

      values.push(
        ...data.map(({ dataSource, date, marketPrice, symbol }) => ({
          dataSource,
          date,
          marketPrice,
          symbol
        }))
      );
    }

    const response: GetValuesObject = {
      dataProviderInfos,
      errors: quoteErrors.map(({ dataSource, symbol }) => {
        return { dataSource, symbol };
      }),
      values: uniqBy(values, ({ date, symbol }) => {
        return `${date}-${symbol}`;
      })
    };

    if (!isEmpty(quoteErrors)) {
      this.logger.debug(
        `Resolving ${quoteErrors.length} quote errors via fallback`
      );

      // Process fallback in batches to avoid N sequential DB queries
      for (
        let i = 0;
        i < quoteErrors.length;
        i += CurrentRateService.FALLBACK_CONCURRENCY
      ) {
        const batch = quoteErrors.slice(
          i,
          i + CurrentRateService.FALLBACK_CONCURRENCY
        );

        await Promise.all(
          batch.map(async ({ dataSource, symbol }) => {
            try {
              // If missing quote, fallback to the latest available historical market price
              let value: GetValueObject = response.values.find(
                (currentValue) => {
                  return (
                    currentValue.symbol === symbol &&
                    isToday(currentValue.date)
                  );
                }
              );

              if (!value) {
                // Fallback to unit price of latest activity
                const latestActivity =
                  await this.orderService.getLatestOrder({
                    dataSource,
                    symbol
                  });

                value = {
                  dataSource,
                  symbol,
                  date: today,
                  marketPrice: latestActivity?.unitPrice ?? 0
                };

                response.values.push(value);
              }

              const [latestValue] = response.values
                .filter((currentValue) => {
                  return (
                    currentValue.symbol === symbol &&
                    currentValue.marketPrice
                  );
                })
                .sort((a, b) => {
                  if (a.date < b.date) {
                    return 1;
                  }

                  if (a.date > b.date) {
                    return -1;
                  }

                  return 0;
                });

              if (latestValue) {
                value.marketPrice = latestValue.marketPrice;
              }
            } catch {}
          })
        );
      }
    }

    return response;
  }

  private containsToday(dates: Date[]): boolean {
    for (const date of dates) {
      if (isToday(date)) {
        return true;
      }
    }
    return false;
  }
}
