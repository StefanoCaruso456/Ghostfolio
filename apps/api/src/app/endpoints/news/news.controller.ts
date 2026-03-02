import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { NewsService } from './news.service';

@Controller('news')
export class NewsController {
  public constructor(private readonly newsService: NewsService) {}

  @Get()
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  public async getNews(
    @Query('symbols') symbols?: string,
    @Query('limit') limit?: string
  ) {
    const symbolList = symbols
      ? symbols
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);

    return this.newsService.getNews(symbolList, parsedLimit);
  }
}
