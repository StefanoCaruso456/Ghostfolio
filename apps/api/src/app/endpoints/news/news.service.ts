import { getMarketDataProvider } from '@ghostfolio/api/app/endpoints/ai/providers/market-data.provider';
import type { NormalizedNewsItem } from '@ghostfolio/api/app/endpoints/ai/providers/market-data.types';

import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'GOOGL', 'AMZN'];

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  public async getNews(
    symbols: string[],
    limit: number
  ): Promise<{ items: NormalizedNewsItem[] }> {
    const provider = getMarketDataProvider();
    const targetSymbols = symbols.length > 0 ? symbols : DEFAULT_SYMBOLS;
    const perSymbolLimit = Math.max(Math.ceil(limit / targetSymbols.length), 2);

    const allItems: NormalizedNewsItem[] = [];

    for (const symbol of targetSymbols) {
      try {
        const result = await provider.fetchNews(symbol, perSymbolLimit, 7);

        if (result.items?.length) {
          allItems.push(...result.items);
        }

        if (result.rateLimited) {
          this.logger.warn(`Rate limited fetching news for ${symbol}`);
          break;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to fetch news for ${symbol}: ${error.message}`
        );
      }
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const unique = allItems.filter((item) => {
      if (!item.url || seen.has(item.url)) {
        return false;
      }

      seen.add(item.url);

      return true;
    });

    // Sort by publishedAt descending
    unique.sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

    return { items: unique.slice(0, limit) };
  }
}
