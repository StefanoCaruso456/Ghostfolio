import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'page' },
  imports: [RouterModule],
  selector: 'gf-ai-chat-page',
  styleUrls: ['./ai-chat-page.component.scss'],
  templateUrl: './ai-chat-page.component.html'
})
export class GfAiChatPageComponent {}
