import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';

import { Module } from '@nestjs/common';

import { SnaptradeController } from './snaptrade.controller';
import { SnaptradeService } from './snaptrade.service';

@Module({
  controllers: [SnaptradeController],
  exports: [SnaptradeService],
  imports: [ConfigurationModule, PrismaModule],
  providers: [SnaptradeService]
})
export class SnaptradeModule {}
