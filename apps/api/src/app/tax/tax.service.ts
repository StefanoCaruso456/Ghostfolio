/**
 * TaxService — Tax Intelligence business logic.
 *
 * Provides: tax lot derivation, sale simulation, connected account
 * aggregation, normalized holdings/transactions, and adjustment CRUD.
 */
import { PlaidService } from '@ghostfolio/api/app/plaid/plaid.service';
import { SnaptradeService } from '@ghostfolio/api/app/snaptrade/snaptrade.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { Injectable, Logger } from '@nestjs/common';
import { DataSource, TaxAdjustmentType } from '@prisma/client';

import type {
  ConnectedAccountSummary,
  DerivedTaxLot,
  SaleSimulationInput,
  SaleSimulationResult,
  SyncResult,
  TaxHolding,
  TaxTransaction
} from './interfaces/tax.interfaces';
import { deriveTaxLots } from './tax-lot.engine';
import { simulateSale } from './tax-simulation.engine';

@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  public constructor(
    private readonly prismaService: PrismaService,
    private readonly dataProviderService: DataProviderService,
    private readonly plaidService: PlaidService,
    private readonly snaptradeService: SnaptradeService
  ) {}

  // ─── Connected Accounts ──────────────────────────────────────────

  public async listConnectedAccounts(
    userId: string
  ): Promise<ConnectedAccountSummary[]> {
    const [snapConnections, plaidItems] = await Promise.all([
      this.prismaService.snapTradeConnection.findMany({
        where: { userId }
      }),
      this.prismaService.plaidItem.findMany({
        where: { userId }
      })
    ]);

    // Count accounts per connection
    const accounts = await this.prismaService.account.findMany({
      where: { userId },
      select: { id: true, comment: true, plaidAccountId: true }
    });

    const result: ConnectedAccountSummary[] = [];

    for (const conn of snapConnections) {
      const accountCount = accounts.filter((a) =>
        a.comment?.startsWith('snaptrade:')
      ).length;

      result.push({
        id: conn.id,
        type: 'snaptrade',
        brokerageName: conn.brokerageName,
        institutionName: null,
        status: conn.status,
        lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null,
        accountCount
      });
    }

    for (const item of plaidItems) {
      const accountCount = accounts.filter(
        (a) => a.plaidAccountId != null
      ).length;

      result.push({
        id: item.id,
        type: 'plaid',
        brokerageName: null,
        institutionName: item.institutionName,
        status: item.status,
        lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
        accountCount
      });
    }

    return result;
  }

  public async syncAccount(
    userId: string,
    connectionId: string,
    type: 'snaptrade' | 'plaid'
  ): Promise<SyncResult> {
    try {
      if (type === 'snaptrade') {
        await this.snaptradeService.syncConnection(userId, connectionId);
      } else {
        await this.plaidService.syncItem(userId, connectionId);
      }

      // Count synced holdings and transactions
      const [holdingsCount, transactionsCount] = await Promise.all([
        this.prismaService.order.count({
          where: { userId, type: 'BUY' }
        }),
        this.prismaService.order.count({
          where: { userId }
        })
      ]);

      return {
        syncedAt: new Date().toISOString(),
        holdingsCount,
        transactionsCount,
        status: 'success'
      };
    } catch (error) {
      this.logger.error(
        `syncAccount failed for ${type}:${connectionId}: ${error instanceof Error ? error.message : error}`
      );

      return {
        syncedAt: new Date().toISOString(),
        holdingsCount: 0,
        transactionsCount: 0,
        status: 'error',
        message: error instanceof Error ? error.message : 'Sync failed'
      };
    }
  }

  // ─── Tax Holdings (Normalized View) ──────────────────────────────

  public async getTaxHoldings(
    userId: string,
    opts?: { symbol?: string; accountId?: string }
  ): Promise<TaxHolding[]> {
    // Derive tax lots to compute cost basis
    const lots = await this.deriveTaxLotsForUser(userId);

    // Get current market prices
    const openLots = lots.filter(
      (lot) =>
        lot.remainingQuantity > 0 &&
        (!opts?.symbol || lot.symbol === opts.symbol)
    );

    // Aggregate by symbol
    const bySymbol = new Map<
      string,
      { lots: DerivedTaxLot[]; totalQty: number; totalCostBasis: number }
    >();

    for (const lot of openLots) {
      if (opts?.accountId && lot.accountId !== opts.accountId) {
        continue;
      }

      const existing = bySymbol.get(lot.symbol) ?? {
        lots: [],
        totalQty: 0,
        totalCostBasis: 0
      };

      existing.lots.push(lot);
      existing.totalQty += lot.remainingQuantity;
      existing.totalCostBasis += lot.remainingQuantity * lot.costBasisPerShare;
      bySymbol.set(lot.symbol, existing);
    }

    // Fetch symbol profiles for names
    const symbols = Array.from(bySymbol.keys());
    const profiles = await this.prismaService.symbolProfile.findMany({
      where: { symbol: { in: symbols } },
      select: { symbol: true, name: true, currency: true, dataSource: true }
    });

    const profileMap = new Map(profiles.map((p) => [p.symbol, p]));

    // Fetch current prices
    const quoteMap: Record<string, number> = {};

    try {
      const items = profiles.map((p) => ({
        dataSource: p.dataSource as DataSource,
        symbol: p.symbol
      }));

      if (items.length > 0) {
        const quotes = await this.dataProviderService.getQuotes({ items });

        for (const [symbol, quote] of Object.entries(quotes)) {
          if (quote?.marketPrice) {
            quoteMap[symbol] = quote.marketPrice;
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to fetch quotes for tax holdings: ${error}`);
    }

    // Get account names
    const accountMap = new Map<string, string>();
    const accts = await this.prismaService.account.findMany({
      where: { userId },
      select: { id: true, name: true }
    });

    for (const a of accts) {
      accountMap.set(a.id, a.name ?? a.id);
    }

    const holdings: TaxHolding[] = [];

    for (const [symbol, data] of bySymbol) {
      const profile = profileMap.get(symbol);
      const marketPrice = quoteMap[symbol] ?? null;
      const marketValue = marketPrice ? data.totalQty * marketPrice : null;
      const unrealizedGainLoss =
        marketValue != null ? marketValue - data.totalCostBasis : null;
      const unrealizedGainLossPct =
        unrealizedGainLoss != null && data.totalCostBasis > 0
          ? Math.round((unrealizedGainLoss / data.totalCostBasis) * 10000) / 100
          : null;

      // Use the first lot's accountId for account name
      const accountName = data.lots[0]?.accountId
        ? (accountMap.get(data.lots[0].accountId) ?? null)
        : null;

      holdings.push({
        symbol,
        name: profile?.name ?? null,
        quantity: Math.round(data.totalQty * 10000) / 10000,
        marketPrice: marketPrice ? Math.round(marketPrice * 100) / 100 : null,
        marketValue: marketValue ? Math.round(marketValue * 100) / 100 : null,
        costBasis: Math.round(data.totalCostBasis * 100) / 100,
        unrealizedGainLoss:
          unrealizedGainLoss != null
            ? Math.round(unrealizedGainLoss * 100) / 100
            : null,
        unrealizedGainLossPct,
        currency: profile?.currency ?? data.lots[0]?.currency ?? 'USD',
        accountName,
        dataSource: profile?.dataSource ?? 'YAHOO'
      });
    }

    // Sort by market value descending
    holdings.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

    return holdings;
  }

  // ─── Tax Transactions ────────────────────────────────────────────

  public async getTaxTransactions(
    userId: string,
    opts?: {
      symbol?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
    }
  ): Promise<{ transactions: TaxTransaction[]; totalCount: number }> {
    const where: any = { userId };

    if (opts?.symbol) {
      where.SymbolProfile = { symbol: opts.symbol };
    }

    if (opts?.startDate || opts?.endDate) {
      where.date = {};

      if (opts.startDate) {
        where.date.gte = new Date(opts.startDate);
      }

      if (opts.endDate) {
        where.date.lte = new Date(opts.endDate);
      }
    }

    const [orders, totalCount] = await Promise.all([
      this.prismaService.order.findMany({
        where,
        include: {
          SymbolProfile: { select: { symbol: true, name: true } },
          account: { select: { name: true } }
        },
        orderBy: { date: 'desc' },
        take: opts?.limit ?? 100
      }),
      this.prismaService.order.count({ where })
    ]);

    const transactions: TaxTransaction[] = orders.map((order) => ({
      id: order.id,
      date: order.date.toISOString().split('T')[0],
      type: order.type,
      symbol: order.SymbolProfile?.symbol ?? '',
      name: order.SymbolProfile?.name ?? null,
      quantity: order.quantity,
      unitPrice: order.unitPrice,
      fee: order.fee,
      currency: order.currency,
      accountName: (order as any).account?.name ?? null
    }));

    return { transactions, totalCount };
  }

  // ─── Tax Lots ────────────────────────────────────────────────────

  public async deriveTaxLotsForUser(userId: string): Promise<DerivedTaxLot[]> {
    const orders = await this.prismaService.order.findMany({
      where: {
        userId,
        isDraft: false,
        type: { in: ['BUY', 'SELL'] }
      },
      include: {
        SymbolProfile: {
          select: { symbol: true, dataSource: true, currency: true }
        }
      },
      orderBy: { date: 'asc' }
    });

    const orderInputs = orders.map((order) => ({
      id: order.id,
      date: order.date,
      type: order.type,
      symbol: order.SymbolProfile?.symbol ?? '',
      dataSource: order.SymbolProfile?.dataSource ?? 'YAHOO',
      quantity: order.quantity,
      unitPrice: order.unitPrice,
      fee: order.fee,
      currency: order.currency ?? order.SymbolProfile?.currency ?? 'USD',
      accountId: order.accountId ?? undefined
    }));

    return deriveTaxLots(orderInputs);
  }

  public async getTaxLots(
    userId: string,
    opts?: { symbol?: string; status?: 'OPEN' | 'CLOSED' | 'ALL' }
  ): Promise<DerivedTaxLot[]> {
    const allLots = await this.deriveTaxLotsForUser(userId);

    return allLots.filter((lot) => {
      if (opts?.symbol && lot.symbol !== opts.symbol) {
        return false;
      }

      if (opts?.status && opts.status !== 'ALL') {
        if (opts.status === 'OPEN') {
          return lot.status === 'OPEN' || lot.status === 'PARTIAL';
        }

        return lot.status === opts.status;
      }

      return true;
    });
  }

  // ─── Sale Simulation ─────────────────────────────────────────────

  public async simulateSaleForUser(
    userId: string,
    input: SaleSimulationInput
  ): Promise<SaleSimulationResult> {
    // Get open lots for the symbol
    const openLots = await this.getTaxLots(userId, {
      symbol: input.symbol,
      status: 'OPEN'
    });

    // Get current market price if not provided
    let currentMarketPrice = input.pricePerShare ?? 0;

    if (!input.pricePerShare) {
      try {
        const profile = await this.prismaService.symbolProfile.findFirst({
          where: { symbol: input.symbol },
          select: { dataSource: true, symbol: true }
        });

        if (profile) {
          const quotes = await this.dataProviderService.getQuotes({
            items: [
              {
                dataSource: profile.dataSource as DataSource,
                symbol: profile.symbol
              }
            ]
          });

          currentMarketPrice = quotes[profile.symbol]?.marketPrice ?? 0;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to fetch market price for ${input.symbol}: ${error}`
        );
      }
    }

    return simulateSale(openLots, input, currentMarketPrice);
  }

  // ─── Adjustments CRUD ────────────────────────────────────────────

  public async createAdjustment(
    userId: string,
    data: {
      symbol: string;
      adjustmentType: TaxAdjustmentType;
      data: Record<string, any>;
      note?: string;
      dataSource?: string;
    }
  ) {
    return this.prismaService.taxAdjustment.create({
      data: {
        userId,
        symbol: data.symbol,
        dataSource: data.dataSource,
        adjustmentType: data.adjustmentType,
        data: data.data,
        note: data.note
      }
    });
  }

  public async updateAdjustment(
    _userId: string,
    id: string,
    data: { data?: Record<string, any>; note?: string }
  ) {
    return this.prismaService.taxAdjustment.update({
      where: { id },
      data: {
        ...(data.data != null ? { data: data.data } : {}),
        ...(data.note != null ? { note: data.note } : {})
      }
    });
  }

  public async deleteAdjustment(_userId: string, id: string) {
    return this.prismaService.taxAdjustment.delete({
      where: { id }
    });
  }

  public async getAdjustments(userId: string, opts?: { symbol?: string }) {
    return this.prismaService.taxAdjustment.findMany({
      where: {
        userId,
        ...(opts?.symbol ? { symbol: opts.symbol } : {})
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}
