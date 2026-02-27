import { UserService } from '@ghostfolio/client/services/user/user.service';
import {
  LineChartItem,
  LookupItem,
  MarketChartResponse,
  User
} from '@ghostfolio/common/interfaces';
import { ColorScheme } from '@ghostfolio/common/types';
import { GfLineChartComponent } from '@ghostfolio/ui/line-chart';
import { DataService } from '@ghostfolio/ui/services';

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnDestroy,
  OnInit
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  filter,
  switchMap,
  takeUntil
} from 'rxjs';

interface ChartConfig {
  label: string;
  symbol: string;
  visible: boolean;
  toggleable?: boolean;
  userAdded?: boolean;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    GfLineChartComponent,
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-resources-markets',
  styleUrls: ['./resources-markets.component.scss'],
  templateUrl: './resources-markets.component.html'
})
export class ResourcesMarketsComponent implements OnInit, OnDestroy {
  public chartConfigs: ChartConfig[] = [
    { label: 'S&P 500', symbol: '^GSPC', visible: true },
    { label: 'Dow', symbol: '^DJI', visible: true },
    { label: 'Bitcoin', symbol: 'BTC-USD', visible: true },
    { label: 'Dogecoin', symbol: 'DOGE-USD', visible: true },
    { label: 'Apple', symbol: 'AAPL', visible: true },
    { label: 'Nvidia', symbol: 'NVDA', visible: true },
    { label: 'Microsoft', symbol: 'MSFT', visible: false, toggleable: true },
    { label: 'AMD', symbol: 'AMD', visible: false, toggleable: true }
  ];

  public chartDataMap = new Map<string, LineChartItem[]>();
  public changePercentMap = new Map<string, number>();
  public colorScheme: ColorScheme;
  public errorMap = new Map<string, string>();
  public latestValueMap = new Map<string, number>();
  public loadingMap = new Map<string, boolean>();
  public ranges = ['5D', '1M', '6M', '1Y'];
  public searchControl = new FormControl('');
  public searchResults: LookupItem[] = [];
  public selectedRange = '1M';
  public user: User;

  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private dataService: DataService,
    private userService: UserService
  ) {}

  public ngOnInit() {
    this.userService.stateChanged
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe((state) => {
        if (state?.user) {
          this.user = state.user;
          this.colorScheme = this.user.settings?.colorScheme;
          this.changeDetectorRef.markForCheck();
        }
      });

    this.searchControl.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        filter((query) => typeof query === 'string' && query.length >= 2),
        switchMap((query: string) =>
          this.dataService.fetchSymbols({ query, includeIndices: true })
        ),
        takeUntil(this.unsubscribeSubject)
      )
      .subscribe((results) => {
        this.searchResults = results;
        this.changeDetectorRef.markForCheck();
      });

    this.loadAllVisibleCharts();
  }

  public ngOnDestroy() {
    this.unsubscribeSubject.next();
    this.unsubscribeSubject.complete();
  }

  public get visibleCharts(): ChartConfig[] {
    return this.chartConfigs.filter((c) => c.visible);
  }

  public get toggleableCharts(): ChartConfig[] {
    return this.chartConfigs.filter((c) => c.toggleable);
  }

  public onRangeChange(range: string) {
    this.selectedRange = range;
    this.loadAllVisibleCharts();
  }

  public onToggleSymbol(config: ChartConfig) {
    config.visible = !config.visible;

    if (config.visible) {
      this.loadChart(config.symbol);
    } else {
      this.chartDataMap.delete(config.symbol);
      this.latestValueMap.delete(config.symbol);
      this.changePercentMap.delete(config.symbol);
      this.errorMap.delete(config.symbol);
    }

    this.changeDetectorRef.markForCheck();
  }

  public onSelectSymbol(item: LookupItem) {
    const exists = this.chartConfigs.some((c) => c.symbol === item.symbol);

    if (!exists) {
      this.chartConfigs.push({
        label: item.name,
        symbol: item.symbol,
        visible: true,
        userAdded: true
      });
      this.loadChart(item.symbol);
    }

    this.searchControl.setValue('');
    this.searchResults = [];
    this.changeDetectorRef.markForCheck();
  }

  public onRemoveChart(config: ChartConfig) {
    this.chartConfigs = this.chartConfigs.filter(
      (c) => c.symbol !== config.symbol
    );
    this.chartDataMap.delete(config.symbol);
    this.latestValueMap.delete(config.symbol);
    this.changePercentMap.delete(config.symbol);
    this.errorMap.delete(config.symbol);
    this.loadingMap.delete(config.symbol);
    this.changeDetectorRef.markForCheck();
  }

  public formatValue(value: number, symbol: string): string {
    if (value == null) {
      return '–';
    }

    const isCrypto =
      symbol.includes('-USD') || symbol === 'BTC-USD' || symbol === 'DOGE-USD';

    if (isCrypto && value < 1) {
      return value.toLocaleString('en-US', {
        maximumFractionDigits: 6,
        minimumFractionDigits: 4,
        style: 'currency',
        currency: 'USD'
      });
    }

    return value.toLocaleString('en-US', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      style: 'currency',
      currency: 'USD'
    });
  }

  public formatChangePercent(change: number): string {
    if (change == null) {
      return '';
    }

    const sign = change >= 0 ? '+' : '';

    return `${sign}${change.toFixed(2)}%`;
  }

  private loadAllVisibleCharts() {
    for (const config of this.chartConfigs) {
      if (config.visible) {
        this.loadChart(config.symbol);
      }
    }
  }

  private loadChart(symbol: string) {
    this.loadingMap.set(symbol, true);
    this.errorMap.delete(symbol);
    this.changeDetectorRef.markForCheck();

    this.dataService
      .fetchMarketChart(symbol, this.selectedRange)
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        next: (response: MarketChartResponse) => {
          const items: LineChartItem[] = response.points.map((p) => ({
            date: new Date(p.t).toISOString(),
            value: p.v
          }));

          this.chartDataMap.set(symbol, items);

          if (items.length > 0) {
            const latest = items[items.length - 1].value;
            const first = items[0].value;

            this.latestValueMap.set(symbol, latest);

            if (first !== 0) {
              this.changePercentMap.set(
                symbol,
                ((latest - first) / first) * 100
              );
            }
          }

          this.loadingMap.set(symbol, false);
          this.changeDetectorRef.markForCheck();
        },
        error: () => {
          this.errorMap.set(symbol, 'Failed to load data');
          this.loadingMap.set(symbol, false);
          this.changeDetectorRef.markForCheck();
        }
      });
  }
}
