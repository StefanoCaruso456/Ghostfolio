import { AuthGuard } from '@ghostfolio/client/core/auth.guard';
import { internalRoutes } from '@ghostfolio/common/routes/routes';

import { Routes } from '@angular/router';

import { GfAiChatPageComponent } from './ai-chat-page.component';

export const routes: Routes = [
  {
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./ai-chat-view.component').then(
            (c) => c.GfAiChatViewComponent
          )
      }
    ],
    component: GfAiChatPageComponent,
    path: '',
    title: internalRoutes.aiChat.title
  }
];
