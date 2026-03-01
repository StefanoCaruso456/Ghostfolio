import { AccountBalanceModule } from '@ghostfolio/api/app/account-balance/account-balance.module';
import { OrderModule } from '@ghostfolio/api/app/order/order.module';
import { PortfolioCalculatorFactory } from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator.factory';
import { CurrentRateService } from '@ghostfolio/api/app/portfolio/current-rate.service';
import { RedisCacheModule } from '@ghostfolio/api/app/redis-cache/redis-cache.module';
import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { DataProviderModule } from '@ghostfolio/api/services/data-provider/data-provider.module';
import { ExchangeRateDataModule } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.module';
import { MarketDataModule } from '@ghostfolio/api/services/market-data/market-data.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';
import { PortfolioSnapshotService } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service';
import {
  DEFAULT_PROCESSOR_PORTFOLIO_SNAPSHOT_COMPUTATION_TIMEOUT,
  PORTFOLIO_SNAPSHOT_COMPUTATION_QUEUE
} from '@ghostfolio/common/config';

import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';

import { PortfolioSnapshotProcessor } from './portfolio-snapshot.processor';

@Module({
  exports: [BullModule, PortfolioSnapshotService],
  imports: [
    AccountBalanceModule,
    BullModule.registerQueue({
      name: PORTFOLIO_SNAPSHOT_COMPUTATION_QUEUE,
      settings: {
        lockDuration: parseInt(
          process.env.PROCESSOR_PORTFOLIO_SNAPSHOT_COMPUTATION_TIMEOUT ??
            DEFAULT_PROCESSOR_PORTFOLIO_SNAPSHOT_COMPUTATION_TIMEOUT.toString(),
          10
        ),
        // Allow up to 10 stall detections before killing the job.
        // Heavy portfolios (1000+ symbols) block the event loop;
        // combined with setImmediate yielding in computeSnapshot this
        // gives the job enough runway to complete.
        maxStalledCount: 10,
        // Check for stalled jobs less aggressively (every 5 minutes)
        stalledInterval: 300_000
      }
    }),
    ConfigurationModule,
    DataProviderModule,
    ExchangeRateDataModule,
    MarketDataModule,
    OrderModule,
    PrismaModule,
    RedisCacheModule
  ],
  providers: [
    CurrentRateService,
    PortfolioCalculatorFactory,
    PortfolioSnapshotProcessor,
    PortfolioSnapshotService
  ]
})
export class PortfolioSnapshotQueueModule {}
