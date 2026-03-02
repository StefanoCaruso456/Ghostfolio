export interface MarketChartResponse {
  cached: boolean;
  currency: string;
  points: { t: number; v: number }[];
  range: string;
  source: string;
  symbol: string;
}
