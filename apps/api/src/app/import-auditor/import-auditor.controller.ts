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
  Logger,
  Post,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import { ImportAuditorService } from './import-auditor.service';

class ChatRequestDto {
  sessionId: string;
  message: string;
  csvContent?: string;
}

@Controller('import-auditor')
export class ImportAuditorController {
  private readonly logger = new Logger(ImportAuditorController.name);

  public constructor(
    private readonly importAuditorService: ImportAuditorService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Get('health')
  public getHealth(): { status: string } {
    return this.importAuditorService.getHealth();
  }

  @Post('chat')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  @HasPermission(permissions.createOrder)
  public async chat(@Body() body: ChatRequestDto) {
    if (!body.sessionId || !body.message) {
      throw new HttpException(
        {
          error: getReasonPhrase(StatusCodes.BAD_REQUEST),
          message: ['sessionId and message are required']
        },
        StatusCodes.BAD_REQUEST
      );
    }

    try {
      return await this.importAuditorService.chat({
        csvContent: body.csvContent,
        message: body.message,
        sessionId: body.sessionId,
        userId: this.request.user.id
      });
    } catch (error) {
      this.logger.error(error);

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      throw new HttpException(
        {
          error: getReasonPhrase(StatusCodes.INTERNAL_SERVER_ERROR),
          message: [errorMessage]
        },
        StatusCodes.INTERNAL_SERVER_ERROR
      );
    }
  }
}
