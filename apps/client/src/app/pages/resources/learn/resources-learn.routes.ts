import { publicRoutes } from '@ghostfolio/common/routes/routes';

import { Routes } from '@angular/router';

import { ResourcesLearnComponent } from './resources-learn.component';

export const routes: Routes = [
  {
    component: ResourcesLearnComponent,
    path: '',
    title: publicRoutes.resources.subRoutes.guides.title
  }
];
