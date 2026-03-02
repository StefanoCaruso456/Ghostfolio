/**
 * Tax Intelligence — Shared interfaces and constants.
 */

// ─── Tax Lot Interfaces ──────────────────────────────────────────────

export interface DerivedTaxLot {
  id: string;
  symbol: string;
  dataSource: string;
  acquiredDate: Date;
  quantity: number;
  remainingQuantity: number;
  costBasisPerShare: number;
  costBasis: number;
  currency: string;
  status: 'OPEN' | 'CLOSED' | 'PARTIAL';
  holdingPeriod: 'SHORT_TERM' | 'LONG_TERM';
  accountId?: string;
  sourceOrderId?: string;
  closedDate?: Date;
  closedQuantity?: number;
  proceeds?: number;
  gainLoss?: number;
}

// ─── Sale Simulation Interfaces ──────────────────────────────────────

export interface SaleSimulationInput {
  symbol: string;
  quantity: number;
  pricePerShare?: number;
  taxBracketPct?: number;
  stateTaxPct?: number;
  includeNIIT?: boolean;
}

export interface SaleSimulationResult {
  symbol: string;
  quantitySold: number;
  pricePerShare: number;
  totalProceeds: number;
  lotsConsumed: ConsumedLot[];
  summary: TaxSummary;
  assumptions: string[];
}

export interface ConsumedLot {
  lotId: string;
  acquiredDate: string;
  quantityFromLot: number;
  costBasisPerShare: number;
  costBasis: number;
  proceeds: number;
  gainLoss: number;
  holdingPeriod: 'SHORT_TERM' | 'LONG_TERM';
}

export interface TaxSummary {
  totalCostBasis: number;
  totalProceeds: number;
  totalGainLoss: number;
  shortTermGain: number;
  longTermGain: number;
  estimatedFederalTax: number;
  estimatedStateTax: number;
  estimatedNIIT: number;
  estimatedTotalTax: number;
  effectiveTaxRate: number;
  shortTermTaxRate: number;
  longTermTaxRate: number;
  stateTaxRate: number;
  niitRate: number;
  currency: string;
}

// ─── Connected Account Interfaces ────────────────────────────────────

export interface ConnectedAccountSummary {
  id: string;
  type: 'snaptrade' | 'plaid';
  brokerageName: string | null;
  institutionName: string | null;
  status: string;
  lastSyncedAt: string | null;
  accountCount: number;
}

export interface SyncResult {
  syncedAt: string;
  holdingsCount: number;
  transactionsCount: number;
  status: 'success' | 'error';
  message?: string;
}

// ─── Tax Holdings / Transactions ─────────────────────────────────────

export interface TaxHolding {
  symbol: string;
  name: string | null;
  quantity: number;
  marketPrice: number | null;
  marketValue: number | null;
  costBasis: number;
  unrealizedGainLoss: number | null;
  unrealizedGainLossPct: number | null;
  currency: string;
  accountName: string | null;
  dataSource: string;
}

export interface TaxTransaction {
  id: string;
  date: string;
  type: string;
  symbol: string;
  name: string | null;
  quantity: number;
  unitPrice: number;
  fee: number;
  currency: string | null;
  accountName: string | null;
}

// ─── Federal Tax Brackets (2024, Single Filer) ──────────────────────

export const FEDERAL_BRACKETS_2024 = [
  { min: 0, max: 11600, rate: 0.1 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: Infinity, rate: 0.37 }
];

// ─── Portfolio Liquidation ───────────────────────────────────────────

export interface PortfolioLiquidationInput {
  taxBracketPct?: number;
  stateTaxPct?: number;
  includeNIIT?: boolean;
  topN?: number;
}

export interface PortfolioLiquidationResult {
  holdings: PortfolioLiquidationHolding[];
  summary: TaxSummary;
  assumptions: string[];
  holdingsCount: number;
}

export interface PortfolioLiquidationHolding {
  symbol: string;
  name: string | null;
  quantity: number;
  marketPrice: number;
  totalProceeds: number;
  totalCostBasis: number;
  gainLoss: number;
  shortTermGain: number;
  longTermGain: number;
  estimatedTax: number;
}

// ─── Tax-Loss Harvesting ────────────────────────────────────────────

export interface TaxLossHarvestCandidate {
  symbol: string;
  name: string | null;
  quantity: number;
  marketPrice: number | null;
  costBasis: number;
  marketValue: number | null;
  unrealizedLoss: number;
  unrealizedLossPct: number;
  holdingPeriod: 'SHORT_TERM' | 'LONG_TERM' | 'MIXED';
  washSaleRisk: boolean;
  washSaleDetail: string | null;
}

export interface TaxLossHarvestResult {
  candidates: TaxLossHarvestCandidate[];
  totalHarvestableShortTerm: number;
  totalHarvestableLongTerm: number;
  totalHarvestable: number;
  potentialTaxSavings: number;
  assumptions: string[];
}

// ─── Wash Sale Detection ────────────────────────────────────────────

export interface WashSaleCheck {
  symbol: string;
  status: 'CLEAR' | 'WASH_SALE' | 'AT_RISK';
  detail: string;
  conflictingTransactions: WashSaleConflict[];
}

export interface WashSaleConflict {
  type: 'BUY' | 'SELL';
  date: string;
  quantity: number;
  unitPrice: number;
  daysFromSale: number;
}

export interface WashSaleResult {
  checks: WashSaleCheck[];
  assumptions: string[];
}

// ─── Constants ──────────────────────────────────────────────────────

/** Default long-term capital gains rate for most high-income investors */
export const LONG_TERM_CAPITAL_GAINS_RATE = 0.15;

/** Default short-term rate (ordinary income) for high-income assumption */
export const DEFAULT_SHORT_TERM_RATE = 0.24;

/** Net Investment Income Tax rate (3.8%) for AGI > $200K single / $250K married */
export const NIIT_RATE = 0.038;
