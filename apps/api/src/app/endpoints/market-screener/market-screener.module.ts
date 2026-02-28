import { RedisCacheModule } from '@ghostfolio/api/app/redis-cache/redis-cache.module';

import { Module } from '@nestjs/common';

import { MarketScreenerController } from './market-screener.controller';
import { MarketScreenerService } from './market-screener.service';

@Module({
  controllers: [MarketScreenerController],
  imports: [RedisCacheModule],
  providers: [MarketScreenerService]
})
export class MarketScreenerModule {}
