import { ImportModule } from '@ghostfolio/api/app/import/import.module';
import { OrderModule } from '@ghostfolio/api/app/order/order.module';
import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { PropertyModule } from '@ghostfolio/api/services/property/property.module';

import { Module } from '@nestjs/common';

import { ImportAuditorController } from './import-auditor.controller';
import { ImportAuditorService } from './import-auditor.service';

@Module({
  controllers: [ImportAuditorController],
  exports: [ImportAuditorService],
  imports: [
    ConfigurationModule,
    ImportModule,
    OrderModule,
    PropertyModule
  ],
  providers: [ImportAuditorService]
})
export class ImportAuditorModule {}
