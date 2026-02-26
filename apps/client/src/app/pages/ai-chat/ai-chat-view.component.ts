import { UserService } from '@ghostfolio/client/services/user/user.service';
import { User } from '@ghostfolio/common/interfaces';

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';

import { GfAiChatSidebarComponent } from '../../components/ai-chat-sidebar/ai-chat-sidebar.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GfAiChatSidebarComponent],
  selector: 'gf-ai-chat-view',
  styles: [
    `
      :host {
        display: flex;
        flex: 1;
        min-height: 0;
      }

      .ai-chat-fullscreen {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-height: 0;
      }
    `
  ],
  template: `
    <div class="ai-chat-fullscreen">
      <gf-ai-chat-sidebar mode="fullscreen" [user]="user" />
    </div>
  `
})
export class GfAiChatViewComponent implements OnInit, OnDestroy {
  public user: User;

  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private userService: UserService
  ) {}

  public ngOnInit() {
    this.userService.stateChanged
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe((state) => {
        this.user = state.user;
        this.changeDetectorRef.markForCheck();
      });
  }

  public ngOnDestroy() {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }
}
