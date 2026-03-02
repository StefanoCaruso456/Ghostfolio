import { UserService } from '@ghostfolio/client/services/user/user.service';
import { TabConfiguration, User } from '@ghostfolio/common/interfaces';
import { internalRoutes } from '@ghostfolio/common/routes/routes';

import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { MatOptionModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';

@Component({
  host: { class: 'page' },
  imports: [MatFormFieldModule, MatOptionModule, MatSelectModule, RouterModule],
  selector: 'gf-portfolio-page',
  styleUrls: ['./portfolio-page.scss'],
  templateUrl: './portfolio-page.html'
})
export class PortfolioPageComponent implements OnDestroy, OnInit {
  public activeTabRouterLink: string;
  public tabs: TabConfiguration[] = [];
  public user: User;

  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private userService: UserService
  ) {
    this.userService.stateChanged
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe((state) => {
        if (state?.user) {
          this.tabs = [
            {
              iconName: 'analytics-outline',
              label: internalRoutes.portfolio.subRoutes.analysis.title,
              routerLink: internalRoutes.portfolio.routerLink
            },
            {
              iconName: 'swap-vertical-outline',
              label: internalRoutes.portfolio.subRoutes.activities.title,
              routerLink:
                internalRoutes.portfolio.subRoutes.activities.routerLink
            },
            {
              iconName: 'pie-chart-outline',
              label: internalRoutes.portfolio.subRoutes.allocations.title,
              routerLink:
                internalRoutes.portfolio.subRoutes.allocations.routerLink
            },
            {
              iconName: 'calculator-outline',
              label: internalRoutes.portfolio.subRoutes.fire.title,
              routerLink: internalRoutes.portfolio.subRoutes.fire.routerLink
            },
            {
              iconName: 'scan-outline',
              label: internalRoutes.portfolio.subRoutes.xRay.title,
              routerLink: internalRoutes.portfolio.subRoutes.xRay.routerLink
            }
          ];
          this.user = state.user;
          this.updateActiveTab();
          this.changeDetectorRef.markForCheck();
        }
      });

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntil(this.unsubscribeSubject)
      )
      .subscribe(() => {
        this.updateActiveTab();
        this.changeDetectorRef.markForCheck();
      });
  }

  public ngOnInit() {
    this.updateActiveTab();
  }

  public ngOnDestroy() {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }

  public onTabChange(routerLinkPath: string) {
    this.router.navigateByUrl(routerLinkPath);
  }

  public toPath(routerLink: string[]): string {
    return routerLink.join('/');
  }

  private updateActiveTab() {
    const currentUrl = this.router.url.split('?')[0];

    // Find the most specific matching tab (longest routerLink path that matches)
    const matchingTab = this.tabs
      .filter((tab) => currentUrl.startsWith(this.toPath(tab.routerLink)))
      .sort(
        (a, b) =>
          this.toPath(b.routerLink).length - this.toPath(a.routerLink).length
      )[0];

    this.activeTabRouterLink =
      this.toPath(matchingTab?.routerLink) ??
      this.toPath(this.tabs[0]?.routerLink);
  }
}
