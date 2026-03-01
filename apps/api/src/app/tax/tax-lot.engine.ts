/**
 * tax-lot.engine.ts — Pure FIFO tax lot derivation from Order records.
 *
 * Atomic: derives lots from orders, no side effects
 * Idempotent: same orders → same lots
 * Deterministic: FIFO ordering is well-defined
 */
import { differenceInDays } from 'date-fns';

import type { DerivedTaxLot } from './interfaces/tax.interfaces';

interface OrderInput {
  id: string;
  date: Date;
  type: string; // 'BUY' | 'SELL'
  symbol: string;
  dataSource?: string;
  quantity: number;
  unitPrice: number;
  fee: number;
  currency?: string;
  accountId?: string;
}

/**
 * Derive tax lots from a list of orders using FIFO method.
 *
 * Algorithm:
 * 1. Sort all orders by date ASC
 * 2. Group by symbol
 * 3. For each symbol, process chronologically:
 *    - BUY → create new open lot
 *    - SELL → consume oldest open lots FIFO, calculate gain/loss
 * 4. Compute holding period: >365 days from acquiredDate = LONG_TERM
 */
export function deriveTaxLots(orders: OrderInput[]): DerivedTaxLot[] {
  const sorted = [...orders].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  // Group by symbol
  const bySymbol = new Map<string, OrderInput[]>();

  for (const order of sorted) {
    if (order.type !== 'BUY' && order.type !== 'SELL') {
      continue; // Only BUY and SELL create/consume lots
    }

    const existing = bySymbol.get(order.symbol) ?? [];
    existing.push(order);
    bySymbol.set(order.symbol, existing);
  }

  const allLots: DerivedTaxLot[] = [];
  let lotCounter = 0;

  for (const [symbol, symbolOrders] of bySymbol) {
    // Open lots queue (FIFO — oldest first)
    const openLots: DerivedTaxLot[] = [];

    for (const order of symbolOrders) {
      if (order.type === 'BUY') {
        lotCounter++;
        const costBasisPerShare = order.unitPrice + order.fee / order.quantity;
        const lot: DerivedTaxLot = {
          id: `lot-${lotCounter}`,
          symbol,
          dataSource: order.dataSource ?? 'YAHOO',
          acquiredDate: order.date,
          quantity: order.quantity,
          remainingQuantity: order.quantity,
          costBasisPerShare,
          costBasis: costBasisPerShare * order.quantity,
          currency: order.currency ?? 'USD',
          status: 'OPEN',
          holdingPeriod: computeHoldingPeriod(order.date, new Date()),
          accountId: order.accountId,
          sourceOrderId: order.id
        };

        openLots.push(lot);
        allLots.push(lot);
      } else if (order.type === 'SELL') {
        let remainingToSell = order.quantity;
        const sellPrice =
          order.unitPrice - order.fee / Math.max(order.quantity, 1);
        const sellDate = order.date;

        // Consume oldest lots first (FIFO)
        for (const lot of openLots) {
          if (remainingToSell <= 0) {
            break;
          }

          if (lot.remainingQuantity <= 0) {
            continue;
          }

          const quantityFromLot = Math.min(
            lot.remainingQuantity,
            remainingToSell
          );
          const proceeds = quantityFromLot * sellPrice;
          const costBasis = quantityFromLot * lot.costBasisPerShare;
          const gainLoss = proceeds - costBasis;
          const holdingPeriod = computeHoldingPeriod(
            lot.acquiredDate,
            sellDate
          );

          lot.remainingQuantity -= quantityFromLot;

          if (lot.remainingQuantity <= 0) {
            lot.status = 'CLOSED';
            lot.closedDate = sellDate;
            lot.closedQuantity = lot.quantity;
            lot.proceeds = (lot.proceeds ?? 0) + proceeds;
            lot.gainLoss = (lot.gainLoss ?? 0) + gainLoss;
            lot.holdingPeriod = holdingPeriod;
          } else {
            lot.status = 'PARTIAL';
            lot.closedQuantity = (lot.closedQuantity ?? 0) + quantityFromLot;
            lot.proceeds = (lot.proceeds ?? 0) + proceeds;
            lot.gainLoss = (lot.gainLoss ?? 0) + gainLoss;
          }

          remainingToSell -= quantityFromLot;
        }
      }
    }

    // Update holding periods for remaining open lots (relative to today)
    for (const lot of openLots) {
      if (lot.status === 'OPEN' || lot.status === 'PARTIAL') {
        lot.holdingPeriod = computeHoldingPeriod(lot.acquiredDate, new Date());
      }
    }
  }

  return allLots;
}

/**
 * Determine holding period based on acquisition date and reference date.
 * >365 days = LONG_TERM, otherwise SHORT_TERM.
 */
function computeHoldingPeriod(
  acquiredDate: Date,
  referenceDate: Date
): 'SHORT_TERM' | 'LONG_TERM' {
  const days = differenceInDays(referenceDate, acquiredDate);

  return days > 365 ? 'LONG_TERM' : 'SHORT_TERM';
}
