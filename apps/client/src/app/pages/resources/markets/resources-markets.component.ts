import { AiSidebarService } from '@ghostfolio/client/services/ai-sidebar.service';
import { UserService } from '@ghostfolio/client/services/user/user.service';
import {
  LineChartItem,
  LookupItem,
  MarketChartResponse,
  MarketScreenerItem,
  User
} from '@ghostfolio/common/interfaces';
import { ColorScheme } from '@ghostfolio/common/types';
import { GfLineChartComponent } from '@ghostfolio/ui/line-chart';
import { DataService } from '@ghostfolio/ui/services';

import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { newspaperOutline, refreshOutline } from 'ionicons/icons';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  filter,
  retry,
  switchMap,
  takeUntil,
  timer
} from 'rxjs';

type MarketView = 'stocks' | 'crypto';
type DisplayMode = 'charts' | 'table';

interface ChartConfig {
  label: string;
  symbol: string;
  visible: boolean;
  toggleable?: boolean;
  userAdded?: boolean;
}

interface TableCategoryOption {
  label: string;
  value: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    GfLineChartComponent,
    IonIcon,
    MatAutocompleteModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSortModule,
    MatTooltipModule,
    MatTableModule,
    ReactiveFormsModule
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-resources-markets',
  styleUrls: ['./resources-markets.component.scss'],
  templateUrl: './resources-markets.component.html'
})
export class ResourcesMarketsComponent implements OnInit, OnDestroy {
  @ViewChild(MatSort) public sort: MatSort;

  public displayMode: DisplayMode = 'charts';
  public marketView: MarketView = 'stocks';

  // Table view
  public tableCategories: TableCategoryOption[] = [
    { label: 'Most Active', value: 'most_actives' },
    { label: 'Trending Now', value: 'trending' },
    { label: 'Top Gainers', value: 'day_gainers' },
    { label: 'Top Losers', value: 'day_losers' }
  ];
  public tableCategory = 'most_actives';
  public tableColumns = [
    'news',
    'symbol',
    'name',
    'price',
    'change',
    'changePercent',
    'volume'
  ];
  public tableDataSource = new MatTableDataSource<MarketScreenerItem>([]);
  public tableLoading = false;
  public tableError = '';

  // Chart view
  private stockConfigs: ChartConfig[] = [
    { label: 'S&P 500', symbol: '^GSPC', visible: true },
    { label: 'Dow', symbol: '^DJI', visible: true },
    { label: 'Nasdaq', symbol: '^IXIC', visible: true },
    { label: 'Apple', symbol: 'AAPL', visible: true },
    { label: 'Nvidia', symbol: 'NVDA', visible: true },
    { label: 'Tesla', symbol: 'TSLA', visible: true },
    { label: 'Microsoft', symbol: 'MSFT', visible: false, toggleable: true },
    { label: 'AMD', symbol: 'AMD', visible: false, toggleable: true }
  ];

  private cryptoConfigs: ChartConfig[] = [
    { label: 'Bitcoin', symbol: 'BTC-USD', visible: true },
    { label: 'Ethereum', symbol: 'ETH-USD', visible: true },
    { label: 'Solana', symbol: 'SOL-USD', visible: true },
    { label: 'Dogecoin', symbol: 'DOGE-USD', visible: true },
    { label: 'Cardano', symbol: 'ADA-USD', visible: true },
    { label: 'XRP', symbol: 'XRP-USD', visible: true },
    {
      label: 'Avalanche',
      symbol: 'AVAX-USD',
      visible: false,
      toggleable: true
    },
    { label: 'Polygon', symbol: 'MATIC-USD', visible: false, toggleable: true }
  ];

  public get chartConfigs(): ChartConfig[] {
    return this.marketView === 'stocks'
      ? this.stockConfigs
      : this.cryptoConfigs;
  }

  public set chartConfigs(configs: ChartConfig[]) {
    if (this.marketView === 'stocks') {
      this.stockConfigs = configs;
    } else {
      this.cryptoConfigs = configs;
    }
  }

  public chartDataMap = new Map<string, LineChartItem[]>();
  public changePercentMap = new Map<string, number>();
  public colorScheme: ColorScheme;
  public errorMap = new Map<string, string>();
  public latestValueMap = new Map<string, number>();
  public loadingMap = new Map<string, boolean>();
  public ranges = ['5D', '1M', '6M', '1Y', '5Y', '10Y', 'MAX'];
  public searchControl = new FormControl('');
  public searchResults: LookupItem[] = [];
  public selectedRange = '1M';
  public user: User;

  private unsubscribeSubject = new Subject<void>();

  public constructor(
    private aiSidebarService: AiSidebarService,
    private changeDetectorRef: ChangeDetectorRef,
    private dataService: DataService,
    private userService: UserService
  ) {
    addIcons({ newspaperOutline, refreshOutline });
  }

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

  public onDisplayModeChange(mode: DisplayMode) {
    this.displayMode = mode;

    if (mode === 'table') {
      this.loadTableData();
    }

    this.changeDetectorRef.markForCheck();
  }

  public onMarketViewChange(view: MarketView) {
    this.marketView = view;

    if (this.displayMode === 'charts') {
      this.loadAllVisibleCharts();
    } else {
      this.loadTableData();
    }

    this.changeDetectorRef.markForCheck();
  }

  public onTableCategoryChange(category: string) {
    this.tableCategory = category;
    this.loadTableData();
  }

  public onRetryTable() {
    this.loadTableData();
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

  public onFetchNews(symbol: string) {
    const prompt = [
      `Retrieve the latest news for stock symbol: ${symbol}.`,
      'Summarize the most recent articles.',
      'For each article include:',
      '- Headline',
      '- 3–5 bullet summary',
      '- Source',
      '- URL (as a clickable link)',
      '- Thumbnail image as a clickable link to the article (markdown: [![Headline](thumbnail_url)](article_url))',
      '',
      'Show the top 3 articles, each clearly separated.'
    ].join('\n');

    this.aiSidebarService.openWithPrompt(prompt);
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

  public formatPrice(value: number): string {
    if (value == null) {
      return '–';
    }

    return value.toLocaleString('en-US', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      style: 'currency',
      currency: 'USD'
    });
  }

  public formatChange(value: number): string {
    if (value == null) {
      return '–';
    }

    const sign = value >= 0 ? '+' : '';

    return `${sign}${value.toFixed(2)}`;
  }

  public formatChangePercent(change: number): string {
    if (change == null) {
      return '';
    }

    const sign = change >= 0 ? '+' : '';

    return `${sign}${change.toFixed(2)}%`;
  }

  public formatVolume(volume: number): string {
    if (volume == null) {
      return '–';
    }

    if (volume >= 1_000_000_000) {
      return `${(volume / 1_000_000_000).toFixed(2)}B`;
    }

    if (volume >= 1_000_000) {
      return `${(volume / 1_000_000).toFixed(2)}M`;
    }

    if (volume >= 1_000) {
      return `${(volume / 1_000).toFixed(1)}K`;
    }

    return volume.toLocaleString();
  }

  private getMarketDataErrorMessage(err: HttpErrorResponse): string {
    if (err?.status === 401) {
      return $localize`Please sign in to load market data.`;
    }
    const body = err?.error;
    if (body?.message && typeof body.message === 'string') {
      return body.message;
    }
    if (err?.status && err.status >= 500) {
      return $localize`Market data temporarily unavailable. Please try again.`;
    }
    if (err?.status === 0 || err?.message?.includes('Http failure')) {
      return $localize`Unable to reach server. Check your connection and try again.`;
    }
    return $localize`Failed to load market data. Please try again.`;
  }

  private loadTableData() {
    this.tableLoading = true;
    this.tableError = '';
    this.changeDetectorRef.markForCheck();

    this.dataService
      .fetchMarketScreener(this.tableCategory, 20, this.marketView)
      .pipe(takeUntil(this.unsubscribeSubject))
      .subscribe({
        next: (response) => {
          this.tableDataSource.data = response.items;

          if (this.sort) {
            this.tableDataSource.sort = this.sort;
          }

          this.tableLoading = false;
          this.changeDetectorRef.markForCheck();
        },
        error: (err: HttpErrorResponse) => {
          this.tableError = this.getMarketDataErrorMessage(err);
          this.tableLoading = false;
          this.changeDetectorRef.markForCheck();
        }
      });
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
      .pipe(
        retry({ count: 2, delay: (_, retryIndex) => timer(retryIndex * 2000) }),
        takeUntil(this.unsubscribeSubject)
      )
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
