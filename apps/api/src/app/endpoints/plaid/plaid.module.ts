import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';
import { PropertyModule } from '@ghostfolio/api/services/property/property.module';

import { Module } from '@nestjs/common';

import { PlaidController } from './plaid.controller';
import { PlaidService } from './plaid.service';

@Module({
  controllers: [PlaidController],
  exports: [PlaidService],
  imports: [ConfigurationModule, PrismaModule, PropertyModule],
  providers: [PlaidService]
})
export class PlaidModule {}
