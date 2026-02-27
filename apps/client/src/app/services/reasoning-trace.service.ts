/**
 * ReasoningTraceService — Angular service for SSE-based live reasoning
 * trace streaming and trace retrieval.
 */
import type {
  ReasoningEvent,
  ReasoningPreview
} from '@ghostfolio/common/interfaces';

import { HttpClient } from '@angular/common/http';
import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ReasoningTraceService {
  private eventSource: EventSource | null = null;
  private readonly previewSubject =
    new BehaviorSubject<ReasoningPreview | null>(null);

  /** Observable of the current reasoning preview (updated live via SSE) */
  public readonly preview$ = this.previewSubject.asObservable();

  public constructor(
    private readonly http: HttpClient,
    private readonly ngZone: NgZone
  ) {}

  /**
   * Connect to the SSE stream for a given traceId.
   * Updates preview$ with incoming events.
   */
  public connect(traceId: string): void {
    this.disconnect();

    // Initialize an empty preview
    this.previewSubject.next({
      traceId,
      steps: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
      totalDurationMs: null
    });

    const url = `/api/v1/ai/reasoning/${traceId}/stream`;
    this.eventSource = new EventSource(url);

    // Listen for all event types
    const eventTypes = [
      'trace.started',
      'step.added',
      'step.updated',
      'trace.completed'
    ];

    for (const eventType of eventTypes) {
      this.eventSource.addEventListener(eventType, (event: MessageEvent) => {
        this.ngZone.run(() => {
          try {
            const data: ReasoningEvent = JSON.parse(event.data);
            this.handleEvent(data);
          } catch {
            // Ignore malformed events
          }
        });
      });
    }

    // Also listen for generic message events (fallback)
    this.eventSource.onmessage = (event: MessageEvent) => {
      this.ngZone.run(() => {
        try {
          const data: ReasoningEvent = JSON.parse(event.data);
          this.handleEvent(data);
        } catch {
          // Ignore malformed events
        }
      });
    };

    this.eventSource.onerror = () => {
      // SSE connection closed (expected after trace.completed)
      this.disconnect();
    };
  }

  /**
   * Disconnect the SSE stream.
   */
  public disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /**
   * Reset the preview state (e.g. when starting a new conversation).
   */
  public reset(): void {
    this.disconnect();
    this.previewSubject.next(null);
  }

  /**
   * Fetch a persisted trace by traceId and update the preview subject.
   */
  public getTrace(traceId: string): Observable<ReasoningPreview> {
    const result$ = this.http.get<ReasoningPreview>(
      `/api/v1/ai/reasoning/${traceId}`
    );

    result$.subscribe({
      next: (preview) => {
        this.previewSubject.next(preview);
      },
      error: () => {
        // Trace may not be ready yet; ignore
      }
    });

    return result$;
  }

  /**
   * Copy trace ID to clipboard.
   */
  public async copyTraceId(traceId: string): Promise<void> {
    await navigator.clipboard.writeText(traceId);
  }

  // ────────────────────────────────────────────────────────────────

  private handleEvent(event: ReasoningEvent): void {
    const current = this.previewSubject.value;

    if (!current) {
      return;
    }

    switch (event.type) {
      case 'trace.started':
        if (event.preview) {
          this.previewSubject.next(event.preview);
        }
        break;

      case 'step.added':
        if (event.step) {
          this.previewSubject.next({
            ...current,
            steps: [...current.steps, event.step]
          });
        }
        break;

      case 'step.updated':
        if (event.step) {
          this.previewSubject.next({
            ...current,
            steps: current.steps.map((s) =>
              s.id === event.step!.id ? event.step! : s
            )
          });
        }
        break;

      case 'trace.completed':
        if (event.preview) {
          this.previewSubject.next(event.preview);
        }

        this.disconnect();
        break;
    }
  }
}
