/**
 * ReasoningController — SSE endpoint for live reasoning trace streaming
 * and REST endpoint for retrieving persisted traces.
 */
import { HasPermission } from '@ghostfolio/api/decorators/has-permission.decorator';
import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { permissions } from '@ghostfolio/common/permissions';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Sse,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable, map, finalize } from 'rxjs';

import { ReasoningTraceService } from './reasoning-trace.service';

interface SseMessageEvent {
  data: string;
  type?: string;
  id?: string;
}

@Controller('ai/reasoning')
export class ReasoningController {
  public constructor(
    private readonly traceService: ReasoningTraceService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  /**
   * SSE endpoint: GET /api/v1/ai/reasoning/:traceId/stream
   *
   * No auth guard — EventSource cannot send Authorization headers.
   * Security relies on the traceId being an unguessable UUID generated
   * by the authenticated client. The REST endpoint below still requires auth.
   */
  @Get(':traceId/stream')
  @Sse()
  public stream(
    @Param('traceId') traceId: string
  ): Observable<SseMessageEvent> {
    const stream$ = this.traceService.createStream(traceId);

    return stream$.pipe(
      map((event) => ({
        data: JSON.stringify(event),
        type: event.type,
        id: `${traceId}-${Date.now()}`
      })),
      finalize(() => {
        this.traceService.closeStream(traceId);
      })
    );
  }

  /**
   * REST endpoint: GET /api/v1/ai/reasoning/:traceId
   *
   * Retrieve a persisted (redacted) reasoning trace by its traceId.
   */
  @Get(':traceId')
  @HasPermission(permissions.readAiPrompt)
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getTrace(@Param('traceId') traceId: string) {
    const userId = this.request.user.id;
    const trace = await this.traceService.getTrace(traceId, userId);

    if (!trace) {
      throw new NotFoundException(`Trace ${traceId} not found`);
    }

    return trace;
  }
}
