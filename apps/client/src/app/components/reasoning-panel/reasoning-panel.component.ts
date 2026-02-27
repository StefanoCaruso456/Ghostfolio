import { ReasoningTraceService } from '@ghostfolio/client/services/reasoning-trace.service';
import type {
  ReasoningPreview,
  ReasoningStep
} from '@ghostfolio/common/interfaces';

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Input,
  OnDestroy,
  OnInit
} from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chevronForwardOutline } from 'ionicons/icons';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonIcon],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-reasoning-panel',
  styleUrls: ['./reasoning-panel.component.scss'],
  templateUrl: './reasoning-panel.component.html'
})
export class GfReasoningPanelComponent implements OnInit, OnDestroy {
  @Input() traceId: string | null = null;

  public preview: ReasoningPreview | null = null;
  public isCollapsed = false;
  public visibleStepIds = new Set<string>();

  private previousStepCount = 0;
  private wasCompleted = false;
  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly traceService: ReasoningTraceService
  ) {
    addIcons({
      chevronForwardOutline
    });
  }

  public ngOnInit(): void {
    this.traceService.preview$
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe((preview) => {
        this.preview = preview;

        if (!preview) {
          return;
        }

        // Auto-expand when first steps arrive (live)
        if (preview.steps.length > 0 && !this.wasCompleted) {
          this.isCollapsed = false;
        }

        // Auto-collapse when trace completes (like Claude)
        if (preview.completedAt !== null && !this.wasCompleted) {
          this.wasCompleted = true;
          this.isCollapsed = true;
        }

        // If loaded from persistence (already completed), start collapsed
        if (
          preview.completedAt !== null &&
          this.previousStepCount === 0 &&
          preview.steps.length > 0
        ) {
          this.isCollapsed = true;
          this.wasCompleted = true;

          for (const step of preview.steps) {
            this.visibleStepIds.add(step.id);
          }
        }

        // Stagger-animate new steps (live only)
        if (preview.steps.length > this.previousStepCount) {
          const newSteps = preview.steps.slice(this.previousStepCount);

          if (preview.completedAt !== null) {
            for (const step of newSteps) {
              this.visibleStepIds.add(step.id);
            }
          } else {
            let delay = 0;

            for (const step of newSteps) {
              setTimeout(() => {
                this.visibleStepIds.add(step.id);
                this.changeDetectorRef.markForCheck();
              }, delay);
              delay += 80;
            }
          }

          this.previousStepCount = preview.steps.length;
        }

        this.changeDetectorRef.markForCheck();
      });
  }

  public isStepVisible(stepId: string): boolean {
    return this.visibleStepIds.has(stepId);
  }

  public onToggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
    this.changeDetectorRef.markForCheck();
  }

  public formatDuration(ms: number | null): string {
    if (ms === null) {
      return '...';
    }

    if (ms < 1000) {
      return `${ms}ms`;
    }

    const seconds = Math.round(ms / 1000);
    return `${seconds}s`;
  }

  public trackByStepId(_index: number, step: ReasoningStep): string {
    return step.id;
  }

  public ngOnDestroy(): void {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }
}
