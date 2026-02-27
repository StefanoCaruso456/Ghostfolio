import { ReasoningTraceService } from '@ghostfolio/client/services/reasoning-trace.service';
import type {
  ReasoningPreview,
  ReasoningStep,
  ReasoningStepStatus
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
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  checkmarkCircleOutline,
  chevronDownOutline,
  chevronForwardOutline,
  clipboardOutline,
  closeCircleOutline,
  codeWorkingOutline,
  ellipseOutline,
  flashOutline,
  layersOutline,
  reloadOutline,
  timeOutline
} from 'ionicons/icons';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonIcon, MatButtonModule, MatTooltipModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-reasoning-panel',
  styleUrls: ['./reasoning-panel.component.scss'],
  templateUrl: './reasoning-panel.component.html'
})
export class GfReasoningPanelComponent implements OnInit, OnDestroy {
  @Input() traceId: string | null = null;

  public preview: ReasoningPreview | null = null;
  public isCollapsed = true;
  public expandedSteps = new Set<string>();
  public traceIdCopied = false;

  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly traceService: ReasoningTraceService
  ) {
    addIcons({
      checkmarkCircleOutline,
      chevronDownOutline,
      chevronForwardOutline,
      clipboardOutline,
      closeCircleOutline,
      codeWorkingOutline,
      ellipseOutline,
      flashOutline,
      layersOutline,
      reloadOutline,
      timeOutline
    });
  }

  public ngOnInit(): void {
    this.traceService.preview$
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe((preview) => {
        this.preview = preview;
        this.changeDetectorRef.markForCheck();
      });
  }

  public onToggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
    this.changeDetectorRef.markForCheck();
  }

  public onToggleStep(stepId: string): void {
    if (this.expandedSteps.has(stepId)) {
      this.expandedSteps.delete(stepId);
    } else {
      this.expandedSteps.add(stepId);
    }

    this.changeDetectorRef.markForCheck();
  }

  public isStepExpanded(stepId: string): boolean {
    return this.expandedSteps.has(stepId);
  }

  public async onCopyTraceId(): Promise<void> {
    if (!this.preview?.traceId) {
      return;
    }

    await this.traceService.copyTraceId(this.preview.traceId);
    this.traceIdCopied = true;
    this.changeDetectorRef.markForCheck();

    setTimeout(() => {
      this.traceIdCopied = false;
      this.changeDetectorRef.markForCheck();
    }, 2000);
  }

  public getStatusIcon(status: ReasoningStepStatus): string {
    switch (status) {
      case 'success':
        return 'checkmark-circle-outline';
      case 'error':
        return 'close-circle-outline';
      case 'running':
        return 'reload-outline';
      case 'pending':
        return 'ellipse-outline';
      case 'skipped':
        return 'ellipse-outline';
      default:
        return 'ellipse-outline';
    }
  }

  public getStepIcon(kind: string): string {
    switch (kind) {
      case 'plan':
        return 'flash-outline';
      case 'analysis':
        return 'layers-outline';
      case 'tool_call':
        return 'code-working-outline';
      case 'tool_result':
        return 'checkmark-circle-outline';
      case 'answer':
        return 'flash-outline';
      default:
        return 'ellipse-outline';
    }
  }

  public formatDuration(ms: number | null): string {
    if (ms === null) {
      return '...';
    }

    if (ms < 1000) {
      return `${ms}ms`;
    }

    return `${(ms / 1000).toFixed(1)}s`;
  }

  public trackByStepId(_index: number, step: ReasoningStep): string {
    return step.id;
  }

  public ngOnDestroy(): void {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }
}
