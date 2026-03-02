import { AuthGuard } from '@ghostfolio/client/core/auth.guard';
import { internalRoutes } from '@ghostfolio/common/routes/routes';

import { Routes } from '@angular/router';

import { GfNewsPageComponent } from './news-page.component';

export const routes: Routes = [
  {
    canActivate: [AuthGuard],
    component: GfNewsPageComponent,
    path: '',
    title: internalRoutes.news.title
  }
];
