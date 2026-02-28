import { AuthGuard } from '@ghostfolio/client/core/auth.guard';
import { publicRoutes } from '@ghostfolio/common/routes/routes';

import { Routes } from '@angular/router';

import { ResourcesPageComponent } from './resources-page.component';

export const routes: Routes = [
  {
    canActivate: [AuthGuard],
    component: ResourcesPageComponent,
    children: [
      {
        path: '',
        redirectTo: publicRoutes.resources.subRoutes.markets.path,
        pathMatch: 'full'
      },
      {
        path: publicRoutes.resources.subRoutes.markets.path,
        loadChildren: () =>
          import('./markets/resources-markets.routes').then((m) => m.routes)
      },
      {
        path: publicRoutes.resources.subRoutes.guides.path,
        loadChildren: () =>
          import('./learn/resources-learn.routes').then((m) => m.routes)
      },
      {
        path: publicRoutes.resources.subRoutes.glossary.path,
        redirectTo: publicRoutes.resources.subRoutes.guides.path,
        pathMatch: 'full'
      },
      {
        path: publicRoutes.resources.subRoutes.personalFinanceTools.path,
        loadChildren: () =>
          import('./personal-finance-tools/personal-finance-tools-page.routes').then(
            (m) => m.routes
          )
      }
    ],
    path: '',
    title: publicRoutes.resources.title
  }
];
