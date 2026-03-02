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

import {
  DEFAULT_SHORT_TERM_RATE,
  LONG_TERM_CAPITAL_GAINS_RATE,
  NIIT_RATE,
  type ConnectedAccountSummary,
  type DerivedTaxLot,
  type PortfolioLiquidationHolding,
  type PortfolioLiquidationInput,
  type PortfolioLiquidationResult,
  type SaleSimulationInput,
  type SaleSimulationResult,
  type SyncResult,
  type TaxHolding,
  type TaxLossHarvestCandidate,
  type TaxLossHarvestResult,
  type TaxTransaction,
  type WashSaleCheck,
  type WashSaleConflict,
  type WashSaleResult
} from './interfaces/tax.interfaces';
import { deriveTaxLots } from './tax-lot.engine';
import { computeTaxSummary, simulateSale } from './tax-simulation.engine';

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
    const lots = await this.deriveTaxLotsForUser(userId, {
      symbol: opts?.symbol
    });

    return this.buildTaxHoldingsFromLots(userId, lots, opts);
  }

  /**
   * Build TaxHolding[] from pre-computed lots. Extracted so that
   * simulatePortfolioLiquidation can reuse lots without re-deriving.
   */
  private async buildTaxHoldingsFromLots(
    userId: string,
    lots: DerivedTaxLot[],
    opts?: { symbol?: string; accountId?: string }
  ): Promise<TaxHolding[]> {
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

  public async deriveTaxLotsForUser(
    userId: string,
    opts?: { symbol?: string }
  ): Promise<DerivedTaxLot[]> {
    const where: any = {
      userId,
      isDraft: false,
      type: { in: ['BUY', 'SELL'] }
    };

    // When a symbol filter is provided, query only orders for that symbol.
    // This avoids deriving lots for all 100+ symbols when we only need one.
    if (opts?.symbol) {
      where.SymbolProfile = { symbol: opts.symbol };
    }

    const orders = await this.prismaService.order.findMany({
      where,
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
    const allLots = await this.deriveTaxLotsForUser(userId, {
      symbol: opts?.symbol
    });

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
    // Get open lots for this symbol only — filtered at the DB level
    // to avoid deriving lots for the entire portfolio.
    const allSymbolLots = await this.deriveTaxLotsForUser(userId, {
      symbol: input.symbol
    });
    const openLots = allSymbolLots.filter(
      (lot) => lot.status === 'OPEN' || lot.status === 'PARTIAL'
    );

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

  // ─── Portfolio Liquidation ───────────────────────────────────────

  public async simulatePortfolioLiquidation(
    userId: string,
    input: PortfolioLiquidationInput
  ): Promise<PortfolioLiquidationResult> {
    // Derive lots once and reuse — getTaxHoldings was calling
    // deriveTaxLotsForUser internally, causing a redundant second call.
    const allLots = await this.deriveTaxLotsForUser(userId);
    const holdings = await this.buildTaxHoldingsFromLots(userId, allLots);

    const shortTermRate = input.taxBracketPct
      ? input.taxBracketPct / 100
      : DEFAULT_SHORT_TERM_RATE;
    const longTermRate = LONG_TERM_CAPITAL_GAINS_RATE;
    const stateTaxRate = (input.stateTaxPct ?? 0) / 100;
    const includeNIIT = input.includeNIIT ?? true;

    // Limit to topN if specified
    const targetHoldings = input.topN
      ? holdings.slice(0, input.topN)
      : holdings;

    let totalShortTermGain = 0;
    let totalLongTermGain = 0;
    let totalCostBasis = 0;
    let totalProceeds = 0;

    const liquidationHoldings: PortfolioLiquidationHolding[] = [];

    for (const holding of targetHoldings) {
      if (!holding.marketPrice || holding.quantity <= 0) {
        continue;
      }

      const symbolLots = allLots.filter(
        (lot) => lot.symbol === holding.symbol && lot.remainingQuantity > 0
      );

      let shortTermGain = 0;
      let longTermGain = 0;
      let costBasis = 0;

      for (const lot of symbolLots) {
        const lotCost = lot.remainingQuantity * lot.costBasisPerShare;
        const lotProceeds = lot.remainingQuantity * holding.marketPrice;
        const lotGain = lotProceeds - lotCost;

        costBasis += lotCost;

        if (lot.holdingPeriod === 'SHORT_TERM') {
          shortTermGain += lotGain;
        } else {
          longTermGain += lotGain;
        }
      }

      const proceeds = holding.quantity * holding.marketPrice;
      const gainLoss = shortTermGain + longTermGain;

      // Per-holding estimated tax
      const holdingShortTax = Math.max(0, shortTermGain) * shortTermRate;
      const holdingLongTax = Math.max(0, longTermGain) * longTermRate;
      const holdingStateTax =
        stateTaxRate > 0 ? Math.max(0, gainLoss) * stateTaxRate : 0;
      const holdingNIIT =
        includeNIIT && gainLoss > 0 ? gainLoss * NIIT_RATE : 0;
      const estimatedTax =
        Math.round(
          (holdingShortTax + holdingLongTax + holdingStateTax + holdingNIIT) *
            100
        ) / 100;

      totalShortTermGain += shortTermGain;
      totalLongTermGain += longTermGain;
      totalCostBasis += costBasis;
      totalProceeds += proceeds;

      liquidationHoldings.push({
        symbol: holding.symbol,
        name: holding.name,
        quantity: holding.quantity,
        marketPrice: holding.marketPrice,
        totalProceeds: Math.round(proceeds * 100) / 100,
        totalCostBasis: Math.round(costBasis * 100) / 100,
        gainLoss: Math.round(gainLoss * 100) / 100,
        shortTermGain: Math.round(shortTermGain * 100) / 100,
        longTermGain: Math.round(longTermGain * 100) / 100,
        estimatedTax
      });
    }

    // Sort by tax impact descending
    liquidationHoldings.sort((a, b) => b.estimatedTax - a.estimatedTax);

    const summary = computeTaxSummary({
      shortTermGain: totalShortTermGain,
      longTermGain: totalLongTermGain,
      totalCostBasis,
      totalProceeds,
      shortTermRate,
      longTermRate,
      stateTaxRate,
      includeNIIT,
      currency: holdings[0]?.currency ?? 'USD'
    });

    const assumptions: string[] = [
      'Simulates liquidating all open positions at current market prices',
      `Short-term rate: ${(shortTermRate * 100).toFixed(0)}%, Long-term rate: ${(longTermRate * 100).toFixed(0)}%`,
      stateTaxRate > 0
        ? `State tax rate: ${(stateTaxRate * 100).toFixed(1)}%`
        : 'No state tax included',
      includeNIIT
        ? `NIIT (${(NIIT_RATE * 100).toFixed(1)}%) included for AGI > $200K/$250K`
        : 'NIIT not included',
      'FIFO lot selection, tax estimates only — consult a tax professional'
    ];

    return {
      holdings: liquidationHoldings,
      summary,
      assumptions,
      holdingsCount: liquidationHoldings.length
    };
  }

  // ─── Tax-Loss Harvesting ──────────────────────────────────────────

  public async findTaxLossHarvestCandidates(
    userId: string,
    opts?: { minLoss?: number; taxBracketPct?: number }
  ): Promise<TaxLossHarvestResult> {
    // Derive lots once and reuse for both holdings and lot analysis
    const allLots = await this.deriveTaxLotsForUser(userId);
    const holdings = await this.buildTaxHoldingsFromLots(userId, allLots);
    const minLoss = opts?.minLoss ?? 100;
    const shortTermRate = opts?.taxBracketPct
      ? opts.taxBracketPct / 100
      : DEFAULT_SHORT_TERM_RATE;

    // Get recent transactions for wash sale risk detection
    const recentTxResult = await this.getTaxTransactions(userId, {
      startDate: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      limit: 500
    });
    const recentBuys = recentTxResult.transactions.filter(
      (t) => t.type === 'BUY'
    );

    const candidates: TaxLossHarvestCandidate[] = [];
    let totalShortTerm = 0;
    let totalLongTerm = 0;

    for (const holding of holdings) {
      if (
        holding.unrealizedGainLoss === null ||
        holding.unrealizedGainLoss >= 0
      ) {
        continue; // Only losses
      }

      if (Math.abs(holding.unrealizedGainLoss) < minLoss) {
        continue; // Below threshold
      }

      // Determine holding period from lots
      const symbolLots = allLots.filter(
        (lot) => lot.symbol === holding.symbol && lot.remainingQuantity > 0
      );
      const hasShortTerm = symbolLots.some(
        (lot) => lot.holdingPeriod === 'SHORT_TERM'
      );
      const hasLongTerm = symbolLots.some(
        (lot) => lot.holdingPeriod === 'LONG_TERM'
      );
      const holdingPeriod: 'SHORT_TERM' | 'LONG_TERM' | 'MIXED' =
        hasShortTerm && hasLongTerm
          ? 'MIXED'
          : hasShortTerm
            ? 'SHORT_TERM'
            : 'LONG_TERM';

      // Check wash sale risk: any BUY of same symbol in last 30 days?
      const recentBuysForSymbol = recentBuys.filter(
        (t) => t.symbol === holding.symbol
      );
      const washSaleRisk = recentBuysForSymbol.length > 0;
      const washSaleDetail = washSaleRisk
        ? `Bought ${recentBuysForSymbol.length} time(s) within last 30 days — selling now may trigger wash sale`
        : null;

      // Compute short/long term loss split
      let shortTermLoss = 0;
      let longTermLoss = 0;

      for (const lot of symbolLots) {
        if (holding.marketPrice === null) {
          continue;
        }

        const lotValue = lot.remainingQuantity * holding.marketPrice;
        const lotCost = lot.remainingQuantity * lot.costBasisPerShare;
        const lotGain = lotValue - lotCost;

        if (lotGain < 0) {
          if (lot.holdingPeriod === 'SHORT_TERM') {
            shortTermLoss += lotGain;
          } else {
            longTermLoss += lotGain;
          }
        }
      }

      totalShortTerm += shortTermLoss;
      totalLongTerm += longTermLoss;

      candidates.push({
        symbol: holding.symbol,
        name: holding.name,
        quantity: holding.quantity,
        marketPrice: holding.marketPrice,
        costBasis: holding.costBasis,
        marketValue: holding.marketValue,
        unrealizedLoss: Math.round(holding.unrealizedGainLoss * 100) / 100,
        unrealizedLossPct: holding.unrealizedGainLossPct ?? 0,
        holdingPeriod,
        washSaleRisk,
        washSaleDetail
      });
    }

    // Sort by largest loss first
    candidates.sort((a, b) => a.unrealizedLoss - b.unrealizedLoss);

    const totalHarvestable =
      Math.round((totalShortTerm + totalLongTerm) * 100) / 100;
    const potentialTaxSavings =
      Math.round(
        Math.abs(
          totalShortTerm * shortTermRate +
            totalLongTerm * LONG_TERM_CAPITAL_GAINS_RATE
        ) * 100
      ) / 100;

    const assumptions: string[] = [
      `Minimum loss threshold: $${minLoss}`,
      `Short-term tax rate for savings estimate: ${(shortTermRate * 100).toFixed(0)}%`,
      `Long-term tax rate for savings estimate: ${(LONG_TERM_CAPITAL_GAINS_RATE * 100).toFixed(0)}%`,
      'Wash sale risk flagged if same symbol was purchased within last 30 days',
      'Tax-loss harvesting is a strategy — consult a tax professional before executing'
    ];

    return {
      candidates,
      totalHarvestableShortTerm: Math.round(totalShortTerm * 100) / 100,
      totalHarvestableLongTerm: Math.round(totalLongTerm * 100) / 100,
      totalHarvestable,
      potentialTaxSavings,
      assumptions
    };
  }

  // ─── Wash Sale Detection ──────────────────────────────────────────

  public async checkWashSales(
    userId: string,
    opts?: { symbol?: string; lookbackDays?: number }
  ): Promise<WashSaleResult> {
    const lookbackDays = opts?.lookbackDays ?? 61;
    const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - lookbackMs);

    // Get all transactions in the lookback window
    const txResult = await this.getTaxTransactions(userId, {
      startDate: cutoffDate.toISOString().split('T')[0],
      limit: 1000,
      ...(opts?.symbol ? { symbol: opts.symbol } : {})
    });

    const transactions = txResult.transactions;

    // Find loss sales — filter by symbol at DB level when provided
    const allLots = await this.deriveTaxLotsForUser(userId, {
      symbol: opts?.symbol
    });
    const closedLots = allLots.filter(
      (lot) =>
        lot.status === 'CLOSED' &&
        lot.closedDate &&
        lot.closedDate >= cutoffDate &&
        (lot.gainLoss ?? 0) < 0 &&
        (!opts?.symbol || lot.symbol === opts.symbol)
    );

    // Group loss sales by symbol
    const lossSalesBySymbol = new Map<string, DerivedTaxLot[]>();

    for (const lot of closedLots) {
      const existing = lossSalesBySymbol.get(lot.symbol) ?? [];
      existing.push(lot);
      lossSalesBySymbol.set(lot.symbol, existing);
    }

    const checks: WashSaleCheck[] = [];

    for (const [symbol, lossSales] of lossSalesBySymbol) {
      const symbolTx = transactions.filter((t) => t.symbol === symbol);
      const conflictingTransactions: WashSaleConflict[] = [];
      let hasWashSale = false;

      for (const lossSale of lossSales) {
        if (!lossSale.closedDate) {
          continue;
        }

        const saleDate = lossSale.closedDate.getTime();
        const windowStart = saleDate - 30 * 24 * 60 * 60 * 1000;
        const windowEnd = saleDate + 30 * 24 * 60 * 60 * 1000;

        // Check for BUY transactions within ±30 days of loss sale
        for (const tx of symbolTx) {
          if (tx.type !== 'BUY') {
            continue;
          }

          const txDate = new Date(tx.date).getTime();

          if (txDate >= windowStart && txDate <= windowEnd) {
            const daysFromSale = Math.round(
              (txDate - saleDate) / (24 * 60 * 60 * 1000)
            );

            conflictingTransactions.push({
              type: 'BUY',
              date: tx.date,
              quantity: tx.quantity,
              unitPrice: tx.unitPrice,
              daysFromSale
            });

            hasWashSale = true;
          }
        }
      }

      // Determine status
      let status: 'CLEAR' | 'WASH_SALE' | 'AT_RISK';
      let detail: string;

      if (hasWashSale) {
        status = 'WASH_SALE';
        detail = `${symbol}: Loss sale(s) with replacement purchase(s) within 30-day window — wash sale rule applies, loss deduction may be disallowed`;
      } else {
        // Check if there are recent loss sales without conflicting buys
        // but the window hasn't fully closed yet
        const mostRecentSale = lossSales.reduce((latest, lot) => {
          return lot.closedDate! > (latest?.closedDate ?? new Date(0))
            ? lot
            : latest;
        }, lossSales[0]);
        const daysSinceSale = Math.round(
          (Date.now() - mostRecentSale.closedDate!.getTime()) /
            (24 * 60 * 60 * 1000)
        );

        if (daysSinceSale < 30) {
          status = 'AT_RISK';
          detail = `${symbol}: Loss sale ${daysSinceSale} days ago — avoid repurchasing for ${30 - daysSinceSale} more days to avoid wash sale`;
        } else {
          status = 'CLEAR';
          detail = `${symbol}: Loss sale more than 30 days ago with no replacement purchase — no wash sale`;
        }
      }

      checks.push({ symbol, status, detail, conflictingTransactions });
    }

    // Sort: WASH_SALE first, then AT_RISK, then CLEAR
    const statusOrder = { WASH_SALE: 0, AT_RISK: 1, CLEAR: 2 };
    checks.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    const assumptions: string[] = [
      `Lookback window: ${lookbackDays} days from today`,
      'IRS wash sale rule: loss disallowed if substantially identical security purchased within 30 days before/after sale',
      'Only checks same-symbol transactions (does not detect substantially identical ETFs/funds)',
      'This is an informational check — consult a tax professional for definitive guidance'
    ];

    return { checks, assumptions };
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
