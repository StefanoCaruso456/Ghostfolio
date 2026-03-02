import { RedisCacheModule } from '@ghostfolio/api/app/redis-cache/redis-cache.module';
import { DataEnhancerModule } from '@ghostfolio/api/services/data-provider/data-enhancer/data-enhancer.module';

import { Module } from '@nestjs/common';

import { MarketChartController } from './market-chart.controller';
import { MarketChartService } from './market-chart.service';

@Module({
  controllers: [MarketChartController],
  imports: [DataEnhancerModule, RedisCacheModule],
  providers: [MarketChartService]
})
export class MarketChartModule {}
