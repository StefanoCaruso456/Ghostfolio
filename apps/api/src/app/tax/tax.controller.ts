/**
 * TaxController — REST endpoints for Tax Intelligence.
 */

import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { permissions } from '@ghostfolio/common/permissions';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { REQUEST } from '@nestjs/core';
import { TaxAdjustmentType } from '@prisma/client';

import { TaxService } from './tax.service';

@Controller('tax')
export class TaxController {
  public constructor(
    @Inject(REQUEST) private readonly request: RequestWithUser,
    private readonly taxService: TaxService
  ) {}

  @Get('accounts')
  @HasPermission(permissions.accessAssistant)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async listConnectedAccounts() {
    return this.taxService.listConnectedAccounts(this.request.user.id);
  }

  @Post('accounts/:id/sync')
  @HasPermission(permissions.accessAssistant)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async syncAccount(
    @Param('id') connectionId: string,
    @Body('type') type: 'snaptrade' | 'plaid'
  ) {
    return this.taxService.syncAccount(
      this.request.user.id,
      connectionId,
      type
    );
  }

  @Get('holdings')
  @HasPermission(permissions.accessAssistant)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getTaxHoldings(
    @Query('symbol') symbol?: string,
    @Query('accountId') accountId?: string
  ) {
    return this.taxService.getTaxHoldings(this.request.user.id, {
      symbol,
      accountId
    });
  }

  @Get('transactions')
  @HasPermission(permissions.accessAssistant)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getTaxTransactions(
    @Query('symbol') symbol?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string
  ) {
    return this.taxService.getTaxTransactions(this.request.user.id, {
      symbol,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : undefined
    });
  }

  @Get('lots')
  @HasPermission(permissions.accessAssistant)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getTaxLots(
    @Query('symbol') symbol?: string,
    @Query('status') status?: 'OPEN' | 'CLOSED' | 'ALL'
  ) {
    return this.taxService.getTaxLots(this.request.user.id, {
      symbol,
      status
    });
  }

  @Post('simulate')
  @HasPermission(permissions.accessAssistant)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async simulateSale(
    @Body()
    body: {
      symbol: string;
      quantity: number;
      pricePerShare?: number;
      taxBracketPct?: number;
    }
  ) {
    return this.taxService.simulateSaleForUser(this.request.user.id, body);
  }

  @Post('adjustments')
  @HasPermission(permissions.accessAssistant)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async createAdjustment(
    @Body()
    body: {
      symbol: string;
      adjustmentType: TaxAdjustmentType;
      data: Record<string, any>;
      note?: string;
      dataSource?: string;
    }
  ) {
    return this.taxService.createAdjustment(this.request.user.id, body);
  }

  @Put('adjustments/:id')
  @HasPermission(permissions.accessAssistant)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async updateAdjustment(
    @Param('id') id: string,
    @Body() body: { data?: Record<string, any>; note?: string }
  ) {
    return this.taxService.updateAdjustment(this.request.user.id, id, body);
  }

  @Delete('adjustments/:id')
  @HasPermission(permissions.accessAssistant)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async deleteAdjustment(@Param('id') id: string) {
    return this.taxService.deleteAdjustment(this.request.user.id, id);
  }

  @Get('adjustments')
  @HasPermission(permissions.accessAssistant)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getAdjustments(@Query('symbol') symbol?: string) {
    return this.taxService.getAdjustments(this.request.user.id, { symbol });
  }
}
