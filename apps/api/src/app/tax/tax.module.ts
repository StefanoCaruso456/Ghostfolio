import { PlaidModule } from '@ghostfolio/api/app/plaid/plaid.module';
import { SnaptradeModule } from '@ghostfolio/api/app/snaptrade/snaptrade.module';
import { DataProviderModule } from '@ghostfolio/api/services/data-provider/data-provider.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';

import { Module } from '@nestjs/common';

import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';

@Module({
  controllers: [TaxController],
  exports: [TaxService],
  imports: [DataProviderModule, PlaidModule, PrismaModule, SnaptradeModule],
  providers: [TaxService]
})
export class TaxModule {}
