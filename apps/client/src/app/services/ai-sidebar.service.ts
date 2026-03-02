import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface AiSidebarPrompt {
  message: string;
  autoSend: boolean;
}

@Injectable({ providedIn: 'root' })
export class AiSidebarService {
  private promptSubject = new Subject<AiSidebarPrompt>();
  private openSubject = new Subject<void>();

  public prompt$ = this.promptSubject.asObservable();
  public open$ = this.openSubject.asObservable();

  public openWithPrompt(message: string) {
    this.openSubject.next();
    setTimeout(() => {
      this.promptSubject.next({ message, autoSend: true });
    }, 100);
  }
}
