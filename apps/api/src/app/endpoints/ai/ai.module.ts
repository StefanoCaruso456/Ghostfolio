import { AccountBalanceService } from '@ghostfolio/api/app/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { OrderModule } from '@ghostfolio/api/app/order/order.module';
import { PortfolioCalculatorFactory } from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator.factory';
import { CurrentRateService } from '@ghostfolio/api/app/portfolio/current-rate.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { RulesService } from '@ghostfolio/api/app/portfolio/rules.service';
import { RedisCacheModule } from '@ghostfolio/api/app/redis-cache/redis-cache.module';
import { UserModule } from '@ghostfolio/api/app/user/user.module';
import { ApiModule } from '@ghostfolio/api/services/api/api.module';
import { BenchmarkModule } from '@ghostfolio/api/services/benchmark/benchmark.module';
import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { DataProviderModule } from '@ghostfolio/api/services/data-provider/data-provider.module';
import { ExchangeRateDataModule } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.module';
import { I18nModule } from '@ghostfolio/api/services/i18n/i18n.module';
import { ImpersonationModule } from '@ghostfolio/api/services/impersonation/impersonation.module';
import { MarketDataModule } from '@ghostfolio/api/services/market-data/market-data.module';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';
import { PropertyModule } from '@ghostfolio/api/services/property/property.module';
import { PortfolioSnapshotQueueModule } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.module';
import { SymbolProfileModule } from '@ghostfolio/api/services/symbol-profile/symbol-profile.module';

import { Module, OnModuleInit } from '@nestjs/common';

import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiConversationController } from './conversation/conversation.controller';
import { AiConversationService } from './conversation/conversation.service';
import { McpClientService } from './mcp/mcp-client.service';
import { ToolDispatcherService } from './mcp/tool-dispatcher.service';
import { AiMetricsController } from './metrics/ai-metrics.controller';
import { AiMetricsService } from './metrics/ai-metrics.service';
import { ReasoningTraceService } from './reasoning/reasoning-trace.service';
import { ReasoningController } from './reasoning/reasoning.controller';
import { BraintrustTelemetryService } from './telemetry/braintrust-telemetry.service';

@Module({
  controllers: [
    AiController,
    AiConversationController,
    AiMetricsController,
    ReasoningController
  ],
  imports: [
    ApiModule,
    BenchmarkModule,
    ConfigurationModule,
    DataProviderModule,
    ExchangeRateDataModule,
    I18nModule,
    ImpersonationModule,
    MarketDataModule,
    OrderModule,
    PortfolioSnapshotQueueModule,
    PrismaModule,
    PropertyModule,
    RedisCacheModule,
    SymbolProfileModule,
    UserModule
  ],
  providers: [
    AccountBalanceService,
    AccountService,
    AiConversationService,
    AiMetricsService,
    AiService,
    BraintrustTelemetryService,
    CurrentRateService,
    ReasoningTraceService,
    MarketDataService,
    McpClientService,
    ToolDispatcherService,
    PortfolioCalculatorFactory,
    PortfolioService,
    RulesService
  ]
})
export class AiModule implements OnModuleInit {
  public constructor(
    private readonly telemetryService: BraintrustTelemetryService,
    private readonly metricsService: AiMetricsService
  ) {}

  public onModuleInit() {
    // Wire metrics service into telemetry for DB persistence (avoids circular DI)
    this.telemetryService.setMetricsService(this.metricsService);
  }
}
