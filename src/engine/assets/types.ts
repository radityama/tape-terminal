// Core asset class interface for extensible multi-asset trading engine
// Stocks implemented in Phase 1; Forex, Crypto, ETF, Options plug in via this contract

export interface TradingHours {
  openTime: string; // e.g. "09:30"
  closeTime: string; // e.g. "16:00"
  hasPreMarket: boolean;
  hasAfterHours: boolean;
  is24x7: boolean;
}

export interface FeeModel {
  basePerTrade: number; // in cents or dollars
  perUnitFee: number; // per share or contract
  percentageFee: number; // basis points / 10000
  minimumFee: number;
}

export interface MarginRules {
  initialMarginRatio: number; // e.g. 0.50 (2x leverage)
  maintenanceMarginRatio: number; // e.g. 0.25
  cushionWarningRatio: number; // e.g. 0.35 banner warning
  borrowFeeAnnualRate: number; // e.g. 0.03
}

export interface AssetClass<T = any> {
  id: string; // "equity", "forex", "crypto", "etf", "options"
  name: string;
  tradingHours: TradingHours;
  tickSize: number; // min price increment (e.g. 0.01)
  lotSize: number; // min trading unit (e.g. 1 share)
  pricingModel: string; // "geometric-brownian-cholesky", "order-flow", "black-scholes"
  feeModel: FeeModel;
  marginRules: MarginRules;
  supportsShort: boolean;
  settlement: 'T+0' | 'T+1' | 'T+2';
  formatPrice: (price: number) => string;
  formatQuantity: (qty: number) => string;
  eventTypes: string[];
}
