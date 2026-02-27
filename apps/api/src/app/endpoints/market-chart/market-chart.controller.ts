import { MarketChartResponse } from '@ghostfolio/common/interfaces';

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { MarketChartService } from './market-chart.service';

@Controller('market-chart')
export class MarketChartController {
  public constructor(
    private readonly marketChartService: MarketChartService
  ) {}

  @Get()
  @UseGuards(AuthGuard('jwt'))
  public async getChart(
    @Query('symbol') symbol: string,
    @Query('range') range: string = '1M'
  ): Promise<MarketChartResponse> {
    return this.marketChartService.getChart(symbol, range);
  }
}
