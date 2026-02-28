import { AccountBalanceService } from '@ghostfolio/api/app/account-balance/account-balance.service';
import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioCalculatorFactory } from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator.factory';
import { PortfolioSnapshotValue } from '@ghostfolio/api/app/portfolio/interfaces/snapshot-value.interface';
import { RedisCacheService } from '@ghostfolio/api/app/redis-cache/redis-cache.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import {
  CACHE_TTL_INFINITE,
  DEFAULT_PROCESSOR_PORTFOLIO_SNAPSHOT_COMPUTATION_CONCURRENCY,
  PORTFOLIO_SNAPSHOT_PROCESS_JOB_NAME,
  PORTFOLIO_SNAPSHOT_COMPUTATION_QUEUE
} from '@ghostfolio/common/config';

import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { addMilliseconds } from 'date-fns';

import { PortfolioSnapshotQueueJob } from './interfaces/portfolio-snapshot-queue-job.interface';

@Injectable()
@Processor(PORTFOLIO_SNAPSHOT_COMPUTATION_QUEUE)
export class PortfolioSnapshotProcessor {
  public constructor(
    private readonly accountBalanceService: AccountBalanceService,
    private readonly calculatorFactory: PortfolioCalculatorFactory,
    private readonly configurationService: ConfigurationService,
    private readonly orderService: OrderService,
    private readonly redisCacheService: RedisCacheService
  ) {}

  @Process({
    concurrency: parseInt(
      process.env.PROCESSOR_PORTFOLIO_SNAPSHOT_COMPUTATION_CONCURRENCY ??
        DEFAULT_PROCESSOR_PORTFOLIO_SNAPSHOT_COMPUTATION_CONCURRENCY.toString(),
      10
    ),
    name: PORTFOLIO_SNAPSHOT_PROCESS_JOB_NAME
  })
  public async calculatePortfolioSnapshot(job: Job<PortfolioSnapshotQueueJob>) {
    try {
      const startTime = performance.now();

      Logger.log(
        `Portfolio snapshot calculation of user '${job.data.userId}' has been started (jobId=${job.id})`,
        `PortfolioSnapshotProcessor (${PORTFOLIO_SNAPSHOT_PROCESS_JOB_NAME})`
      );

      const fetchOrdersStart = performance.now();

      const { activities } =
        await this.orderService.getOrdersForPortfolioCalculator({
          filters: job.data.filters,
          userCurrency: job.data.userCurrency,
          userId: job.data.userId,
          withCash: true
        });

      Logger.log(
        `Portfolio snapshot: Fetched ${activities.length} activities in ${((performance.now() - fetchOrdersStart) / 1000).toFixed(1)}s for user '${job.data.userId}'`,
        `PortfolioSnapshotProcessor`
      );

      const accountBalanceItems =
        await this.accountBalanceService.getAccountBalanceItems({
          filters: job.data.filters,
          userCurrency: job.data.userCurrency,
          userId: job.data.userId
        });

      const portfolioCalculator = this.calculatorFactory.createCalculator({
        accountBalanceItems,
        activities,
        calculationType: job.data.calculationType,
        currency: job.data.userCurrency,
        filters: job.data.filters,
        userId: job.data.userId
      });

      const snapshot = await portfolioCalculator.computeSnapshot();

      const elapsedSeconds = (performance.now() - startTime) / 1000;

      Logger.log(
        `Portfolio snapshot calculation of user '${job.data.userId}' completed in ${elapsedSeconds.toFixed(3)}s — ${snapshot.positions?.length ?? 0} positions, ${snapshot.errors?.length ?? 0} errors, hasErrors=${snapshot.hasErrors}`,
        `PortfolioSnapshotProcessor (${PORTFOLIO_SNAPSHOT_PROCESS_JOB_NAME})`
      );

      const expiration = addMilliseconds(
        new Date(),
        (snapshot?.errors?.length ?? 0) === 0
          ? this.configurationService.get('CACHE_QUOTES_TTL')
          : 0
      );

      this.redisCacheService.set(
        this.redisCacheService.getPortfolioSnapshotKey({
          filters: job.data.filters,
          userId: job.data.userId
        }),
        JSON.stringify({
          expiration: expiration.getTime(),
          portfolioSnapshot: snapshot
        } as unknown as PortfolioSnapshotValue),
        CACHE_TTL_INFINITE
      );

      return snapshot;
    } catch (error) {
      const errorMessage =
        error?.message || error?.toString() || 'Unknown error';

      Logger.error(
        `Portfolio snapshot calculation FAILED for user '${job.data.userId}': ${errorMessage}`,
        error?.stack,
        `PortfolioSnapshotProcessor (${PORTFOLIO_SNAPSHOT_PROCESS_JOB_NAME})`
      );

      // Cache a minimal "error" snapshot to prevent repeated expensive computation attempts
      // This expires in 60 seconds so the system retries after a short cooldown
      try {
        const errorSnapshot = {
          activitiesCount: 0,
          createdAt: new Date(),
          currentValueInBaseCurrency: 0,
          errors: [
            {
              dataSource: 'MANUAL' as const,
              symbol: `COMPUTATION_ERROR: ${errorMessage.slice(0, 200)}`
            }
          ],
          hasErrors: true,
          historicalData: [],
          positions: [],
          totalFeesWithCurrencyEffect: 0,
          totalInterestWithCurrencyEffect: 0,
          totalInvestment: 0,
          totalInvestmentWithCurrencyEffect: 0,
          totalLiabilitiesWithCurrencyEffect: 0
        };

        const errorExpiration = addMilliseconds(new Date(), 60_000); // 60s cooldown

        this.redisCacheService.set(
          this.redisCacheService.getPortfolioSnapshotKey({
            filters: job.data.filters,
            userId: job.data.userId
          }),
          JSON.stringify({
            expiration: errorExpiration.getTime(),
            portfolioSnapshot: errorSnapshot
          } as unknown as PortfolioSnapshotValue),
          CACHE_TTL_INFINITE
        );

        Logger.warn(
          `Cached error snapshot for user '${job.data.userId}' (60s cooldown before retry)`,
          `PortfolioSnapshotProcessor`
        );
      } catch (cacheError) {
        Logger.error(
          `Failed to cache error snapshot: ${cacheError?.message}`,
          `PortfolioSnapshotProcessor`
        );
      }

      throw new Error(errorMessage);
    }
  }
}
