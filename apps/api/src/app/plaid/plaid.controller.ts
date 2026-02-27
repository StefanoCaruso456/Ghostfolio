import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { ExchangePlaidTokenDto } from '@ghostfolio/common/dtos';
import { permissions } from '@ghostfolio/common/permissions';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { PlaidService } from './plaid.service';

@Controller('plaid')
export class PlaidController {
  public constructor(
    private readonly plaidService: PlaidService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Post('link-token')
  @HasPermission(permissions.connectPlaid)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async createLinkToken() {
    return this.plaidService.createLinkToken(this.request.user.id);
  }

  @Post('exchange-token')
  @HasPermission(permissions.connectPlaid)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async exchangePublicToken(@Body() body: ExchangePlaidTokenDto) {
    return this.plaidService.exchangePublicToken(this.request.user.id, body);
  }

  @Post(':id/sync')
  @HasPermission(permissions.connectPlaid)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async syncItem(@Param('id') id: string) {
    return this.plaidService.syncItem(this.request.user.id, id);
  }

  @Delete(':id')
  @HasPermission(permissions.connectPlaid)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  public async disconnectItem(@Param('id') id: string) {
    return this.plaidService.disconnectItem(this.request.user.id, id);
  }
}
