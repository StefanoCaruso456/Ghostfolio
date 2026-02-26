import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import {
  AiFeedbackDto,
  AiVerificationLabelDto
} from '@ghostfolio/common/dtos';
import { permissions } from '@ghostfolio/common/permissions';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { AiFeedbackRating } from '@prisma/client';

import { BraintrustTelemetryService } from '../telemetry/braintrust-telemetry.service';
import { AiMetricsService } from './ai-metrics.service';

@Controller('ai')
export class AiMetricsController {
  public constructor(
    private readonly aiMetricsService: AiMetricsService,
    private readonly telemetryService: BraintrustTelemetryService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  // ── POST /api/v1/ai/feedback ──────────────────────────────────────────

  @Post('feedback')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async submitFeedback(@Body() body: AiFeedbackDto) {
    const userId = this.request.user.id;

    const feedback = await this.aiMetricsService.createFeedback({
      userId,
      rating: body.rating as AiFeedbackRating,
      conversationId: body.conversationId,
      traceId: body.traceId,
      messageId: body.messageId,
      comment: body.comment
    });

    // Log feedback event to telemetry (non-blocking)
    this.telemetryService
      .logFeedbackEvent({
        feedbackId: feedback.id,
        userId,
        rating: body.rating,
        traceId: body.traceId ?? null,
        conversationId: body.conversationId ?? null
      })
      .catch(() => {
        // Swallow telemetry errors
      });

    return {
      id: feedback.id,
      status: 'recorded'
    };
  }

  // ── GET /api/v1/ai/metrics/latency?days=7 ────────────────────────────

  @Get('metrics/latency')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getLatencyBaselines(@Query('days') days?: string) {
    const dayCount = days ? parseInt(days, 10) : 7;

    return this.aiMetricsService.getLatencyBaselines(
      isNaN(dayCount) ? 7 : dayCount
    );
  }

  // ── GET /api/v1/ai/metrics/hallucination?days=7 ──────────────────────

  @Get('metrics/hallucination')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getHallucinationRate(@Query('days') days?: string) {
    const dayCount = days ? parseInt(days, 10) : 7;

    return this.aiMetricsService.getHallucinationRate(
      isNaN(dayCount) ? 7 : dayCount
    );
  }

  // ── POST /api/v1/ai/metrics/verification/label ───────────────────────

  @Post('metrics/verification/label')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async submitVerificationLabel(@Body() body: AiVerificationLabelDto) {
    const userId = this.request.user.id;

    const label = await this.aiMetricsService.createVerificationLabel({
      labeledByUserId: userId,
      traceId: body.traceId,
      isHallucination: body.isHallucination,
      verificationShouldHavePassed: body.verificationShouldHavePassed,
      notes: body.notes
    });

    return {
      id: label.id,
      status: 'recorded'
    };
  }

  // ── GET /api/v1/ai/metrics/verification/accuracy?days=30 ─────────────

  @Get('metrics/verification/accuracy')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getVerificationAccuracy(@Query('days') days?: string) {
    const dayCount = days ? parseInt(days, 10) : 30;

    return this.aiMetricsService.getVerificationAccuracy(
      isNaN(dayCount) ? 30 : dayCount
    );
  }
}
