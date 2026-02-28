import { RedisCacheModule } from '@ghostfolio/api/app/redis-cache/redis-cache.module';
import { DataEnhancerModule } from '@ghostfolio/api/services/data-provider/data-enhancer/data-enhancer.module';

import { Module } from '@nestjs/common';

import { MarketScreenerController } from './market-screener.controller';
import { MarketScreenerService } from './market-screener.service';

@Module({
  controllers: [MarketScreenerController],
  imports: [DataEnhancerModule, RedisCacheModule],
  providers: [MarketScreenerService]
})
export class MarketScreenerModule {}
