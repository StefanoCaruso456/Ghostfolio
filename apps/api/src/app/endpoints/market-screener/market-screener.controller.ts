import { MarketScreenerResponse } from '@ghostfolio/common/interfaces';

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { MarketScreenerService } from './market-screener.service';

@Controller('market-screener')
export class MarketScreenerController {
  public constructor(
    private readonly marketScreenerService: MarketScreenerService
  ) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  public async getScreener(
    @Query('category') category: string = 'most_actives',
    @Query('count') count: string = '20',
    @Query('market') market: string = 'stocks'
  ): Promise<MarketScreenerResponse> {
    const validCategories = [
      'most_actives',
      'day_gainers',
      'day_losers',
      'trending'
    ];

    const safeCategory = validCategories.includes(category)
      ? category
      : 'most_actives';

    const safeMarket = market === 'crypto' ? 'crypto' : 'stocks';

    return this.marketScreenerService.getScreener(
      safeCategory as any,
      Math.min(parseInt(count, 10) || 20, 50),
      safeMarket
    );
  }
}
