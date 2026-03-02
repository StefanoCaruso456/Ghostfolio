export interface MarketScreenerItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  marketCap?: number;
  currency: string;
}

export interface MarketScreenerResponse {
  cached: boolean;
  category: string;
  items: MarketScreenerItem[];
}
