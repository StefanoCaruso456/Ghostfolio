import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
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

import { SnaptradeService } from './snaptrade.service';

@Controller('snaptrade')
export class SnaptradeController {
  public constructor(
    private readonly snaptradeService: SnaptradeService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Post('connect')
  @HasPermission(permissions.connectPlaid)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getConnectionPortalUri() {
    return this.snaptradeService.getConnectionPortalUri(this.request.user.id);
  }

  @Post('callback')
  @HasPermission(permissions.connectPlaid)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async handleConnectionSuccess(
    @Body() body: { authorizationId: string }
  ) {
    return this.snaptradeService.handleConnectionSuccess(
      this.request.user.id,
      body.authorizationId
    );
  }

  @Post(':id/sync')
  @HasPermission(permissions.connectPlaid)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async syncConnection(@Param('id') id: string) {
    return this.snaptradeService.syncConnection(this.request.user.id, id);
  }

  @Delete(':id')
  @HasPermission(permissions.connectPlaid)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  public async disconnectConnection(@Param('id') id: string) {
    return this.snaptradeService.disconnectConnection(this.request.user.id, id);
  }
}
