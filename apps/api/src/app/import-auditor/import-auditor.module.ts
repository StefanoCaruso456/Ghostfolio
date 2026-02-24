import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { PropertyModule } from '@ghostfolio/api/services/property/property.module';

import { Module } from '@nestjs/common';

import { ImportAuditorController } from './import-auditor.controller';
import { ImportAuditorService } from './import-auditor.service';

@Module({
  controllers: [ImportAuditorController],
  exports: [ImportAuditorService],
  imports: [ConfigurationModule, PropertyModule],
  providers: [ImportAuditorService]
})
export class ImportAuditorModule {}
