/**
 * ReasoningTraceService — persists reasoning traces server-side
 * and manages SSE connections for live streaming.
 */
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import type {
  ReasoningEvent,
  ReasoningPreview
} from '@ghostfolio/common/interfaces';

import { Injectable, Logger } from '@nestjs/common';
import { ReplaySubject, Observable } from 'rxjs';

@Injectable()
export class ReasoningTraceService {
  private readonly logger = new Logger(ReasoningTraceService.name);

  /** Active SSE streams keyed by traceId */
  private readonly streams = new Map<string, ReplaySubject<ReasoningEvent>>();

  public constructor(private readonly prismaService: PrismaService) {}

  /**
   * Create a new SSE stream for a trace. Returns an Observable the controller
   * can pipe to the SSE response.
   */
  public createStream(traceId: string): Observable<ReasoningEvent> {
    // Use ReplaySubject to buffer events until the SSE client subscribes.
    // This prevents the race condition where events are emitted before the
    // EventSource connection completes.
    const existing = this.streams.get(traceId);

    if (existing) {
      return existing.asObservable();
    }

    const subject = new ReplaySubject<ReasoningEvent>(50);
    this.streams.set(traceId, subject);

    return subject.asObservable();
  }

  /**
   * Ensure a stream exists for a traceId (called before chat processing
   * so events emitted during processing are buffered).
   */
  public ensureStream(traceId: string): void {
    if (!this.streams.has(traceId)) {
      this.streams.set(traceId, new ReplaySubject<ReasoningEvent>(50));
    }
  }

  /**
   * Emit a reasoning event to the SSE stream for this trace.
   */
  public emit(event: ReasoningEvent): void {
    const subject = this.streams.get(event.traceId);

    if (subject) {
      subject.next(event);
    }
  }

  /**
   * Close the SSE stream for a trace.
   */
  public closeStream(traceId: string): void {
    const subject = this.streams.get(traceId);

    if (subject) {
      subject.complete();
      this.streams.delete(traceId);
    }
  }

  /**
   * Persist a completed trace to the database (redacted version only).
   */
  public async persistTrace(params: {
    traceId: string;
    userId: string;
    conversationId: string;
    preview: ReasoningPreview;
  }): Promise<void> {
    try {
      await this.prismaService.aiReasoningTrace.create({
        data: {
          id: params.traceId,
          userId: params.userId,
          conversationId: params.conversationId,
          stepsJson: JSON.stringify(params.preview.steps),
          startedAt: new Date(params.preview.startedAt),
          completedAt: params.preview.completedAt
            ? new Date(params.preview.completedAt)
            : null,
          totalDurationMs: params.preview.totalDurationMs ?? 0,
          stepCount: params.preview.steps.length
        }
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist reasoning trace ${params.traceId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Retrieve a persisted trace by traceId.
   */
  public async getTrace(
    traceId: string,
    userId: string
  ): Promise<ReasoningPreview | null> {
    const record = await this.prismaService.aiReasoningTrace.findFirst({
      where: { id: traceId, userId }
    });

    if (!record) {
      return null;
    }

    return {
      traceId: record.id,
      steps: JSON.parse(record.stepsJson),
      startedAt: record.startedAt.toISOString(),
      completedAt: record.completedAt?.toISOString() ?? null,
      totalDurationMs: record.totalDurationMs
    };
  }
}
