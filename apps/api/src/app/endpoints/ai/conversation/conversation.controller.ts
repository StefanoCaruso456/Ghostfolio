import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { UpdateAiConversationDto } from '@ghostfolio/common/dtos';
import { permissions } from '@ghostfolio/common/permissions';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { AiConversationService } from './conversation.service';

@Controller('ai/conversations')
export class AiConversationController {
  public constructor(
    private readonly conversationService: AiConversationService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Get()
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getConversations() {
    return this.conversationService.getConversations(this.request.user.id);
  }

  @Get(':id')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getConversation(@Param('id') id: string) {
    const conversation = await this.conversationService.getConversation(
      id,
      this.request.user.id
    );

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  @Patch(':id')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async updateConversation(
    @Param('id') id: string,
    @Body() body: UpdateAiConversationDto
  ) {
    return this.conversationService.updateConversation({
      id,
      title: body.title,
      userId: this.request.user.id
    });
  }

  @Delete(':id')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  public async deleteConversation(@Param('id') id: string) {
    return this.conversationService.deleteConversation(
      id,
      this.request.user.id
    );
  }
}
