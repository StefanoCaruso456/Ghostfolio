import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { permissions } from '@ghostfolio/common/permissions';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Post,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { StatusCodes } from 'http-status-codes';

import { PlaidService } from './plaid.service';

@Controller('plaid')
export class PlaidController {
  public constructor(
    private readonly plaidService: PlaidService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Post('create-link-token')
  @HasPermission(permissions.createAccount)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async createLinkToken() {
    return this.plaidService.createLinkToken({
      userId: this.request.user.id
    });
  }

  @Post('exchange-public-token')
  @HasPermission(permissions.createAccount)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async exchangePublicToken(
    @Body() body: { publicToken: string }
  ) {
    if (!body.publicToken) {
      throw new HttpException(
        'publicToken is required',
        StatusCodes.BAD_REQUEST
      );
    }

    return this.plaidService.exchangePublicToken({
      publicToken: body.publicToken,
      userId: this.request.user.id
    });
  }

  @Get('accounts')
  @HasPermission(permissions.createAccount)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getAccounts() {
    return this.plaidService.getAccounts({
      userId: this.request.user.id
    });
  }

  @Post('sync-balances')
  @HasPermission(permissions.updateAccount)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async syncBalances() {
    return this.plaidService.syncBalances({
      userId: this.request.user.id
    });
  }
}
