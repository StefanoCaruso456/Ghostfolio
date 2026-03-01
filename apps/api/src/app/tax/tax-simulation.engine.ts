/**
 * tax-simulation.engine.ts — Pure FIFO sell simulation with federal tax estimation.
 *
 * Atomic: simulation only, no mutations
 * Idempotent: same inputs → same output
 * Deterministic: FIFO + fixed bracket tables
 */
import {
  DEFAULT_SHORT_TERM_RATE,
  LONG_TERM_CAPITAL_GAINS_RATE,
  type ConsumedLot,
  type DerivedTaxLot,
  type SaleSimulationInput,
  type SaleSimulationResult,
  type TaxSummary
} from './interfaces/tax.interfaces';

/**
 * Simulate a sale using FIFO lot selection and estimate federal tax impact.
 *
 * @param openLots - Open (unsold) tax lots for the symbol, sorted acquiredDate ASC
 * @param input    - Sale parameters (symbol, quantity, optional price/bracket)
 * @param currentMarketPrice - Live market price from Yahoo Finance
 */
export function simulateSale(
  openLots: DerivedTaxLot[],
  input: SaleSimulationInput,
  currentMarketPrice: number
): SaleSimulationResult {
  const pricePerShare = input.pricePerShare ?? currentMarketPrice;
  const shortTermRate = input.taxBracketPct
    ? input.taxBracketPct / 100
    : DEFAULT_SHORT_TERM_RATE;
  const longTermRate = LONG_TERM_CAPITAL_GAINS_RATE;

  const assumptions: string[] = [];

  if (!input.pricePerShare) {
    assumptions.push(
      `Using current market price of $${pricePerShare.toFixed(2)} per share`
    );
  }

  if (!input.taxBracketPct) {
    assumptions.push(
      `Using default short-term rate of ${(shortTermRate * 100).toFixed(0)}% (ordinary income assumption)`
    );
  } else {
    assumptions.push(
      `Using user-specified short-term rate of ${(shortTermRate * 100).toFixed(0)}%`
    );
  }

  assumptions.push(
    `Using long-term capital gains rate of ${(longTermRate * 100).toFixed(0)}%`
  );
  assumptions.push('FIFO (First In, First Out) lot selection method');
  assumptions.push(
    'Federal tax estimate only — does not include state or local taxes'
  );
  assumptions.push(
    'This is an informational estimate, not tax advice. Consult a tax professional.'
  );

  // Sort open lots by acquired date (FIFO)
  const sortedLots = [...openLots]
    .filter((lot) => lot.remainingQuantity > 0)
    .sort((a, b) => a.acquiredDate.getTime() - b.acquiredDate.getTime());

  const totalAvailable = sortedLots.reduce(
    (sum, lot) => sum + lot.remainingQuantity,
    0
  );

  if (totalAvailable < input.quantity) {
    assumptions.push(
      `Warning: Only ${totalAvailable.toFixed(4)} shares available, but ${input.quantity} requested. Simulating partial sale.`
    );
  }

  const lotsConsumed: ConsumedLot[] = [];
  let remainingToSell = Math.min(input.quantity, totalAvailable);
  let shortTermGain = 0;
  let longTermGain = 0;
  let totalCostBasis = 0;
  let totalProceeds = 0;

  for (const lot of sortedLots) {
    if (remainingToSell <= 0) {
      break;
    }

    const quantityFromLot = Math.min(lot.remainingQuantity, remainingToSell);
    const costBasis = quantityFromLot * lot.costBasisPerShare;
    const proceeds = quantityFromLot * pricePerShare;
    const gainLoss = proceeds - costBasis;

    // Determine holding period relative to today
    const daysHeld = Math.floor(
      (Date.now() - lot.acquiredDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const holdingPeriod: 'SHORT_TERM' | 'LONG_TERM' =
      daysHeld > 365 ? 'LONG_TERM' : 'SHORT_TERM';

    if (holdingPeriod === 'SHORT_TERM') {
      shortTermGain += gainLoss;
    } else {
      longTermGain += gainLoss;
    }

    totalCostBasis += costBasis;
    totalProceeds += proceeds;

    lotsConsumed.push({
      lotId: lot.id,
      acquiredDate: lot.acquiredDate.toISOString().split('T')[0],
      quantityFromLot: round2(quantityFromLot),
      costBasisPerShare: round2(lot.costBasisPerShare),
      costBasis: round2(costBasis),
      proceeds: round2(proceeds),
      gainLoss: round2(gainLoss),
      holdingPeriod
    });

    remainingToSell -= quantityFromLot;
  }

  // Calculate estimated federal tax
  const shortTermTax = Math.max(0, shortTermGain) * shortTermRate;
  const longTermTax = Math.max(0, longTermGain) * longTermRate;
  const estimatedFederalTax = round2(shortTermTax + longTermTax);
  const totalGainLoss = round2(shortTermGain + longTermGain);
  const effectiveTaxRate =
    totalGainLoss > 0 ? round2((estimatedFederalTax / totalGainLoss) * 100) : 0;

  const summary: TaxSummary = {
    totalCostBasis: round2(totalCostBasis),
    totalProceeds: round2(totalProceeds),
    totalGainLoss,
    shortTermGain: round2(shortTermGain),
    longTermGain: round2(longTermGain),
    estimatedFederalTax,
    effectiveTaxRate,
    shortTermTaxRate: round2(shortTermRate * 100),
    longTermTaxRate: round2(longTermRate * 100),
    currency: openLots[0]?.currency ?? 'USD'
  };

  return {
    symbol: input.symbol,
    quantitySold: round2(input.quantity - remainingToSell),
    pricePerShare: round2(pricePerShare),
    totalProceeds: round2(totalProceeds),
    lotsConsumed,
    summary,
    assumptions
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
