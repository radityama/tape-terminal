import { AssetClass } from './types';

export const EquityAssetClass: AssetClass = {
  id: 'equity',
  name: 'Equities',
  tradingHours: {
    openTime: '09:30',
    closeTime: '16:00',
    hasPreMarket: true,
    hasAfterHours: true,
    is24x7: false,
  },
  tickSize: 0.01,
  lotSize: 1,
  pricingModel: 'geometric-brownian-cholesky',
  feeModel: {
    basePerTrade: 1.0, // $1 flat ticket
    perUnitFee: 0.005, // half a cent per share
    percentageFee: 0.0001, // 1 bp
    minimumFee: 1.5,
  },
  marginRules: {
    initialMarginRatio: 0.5, // 2:1 leverage on margin accounts
    maintenanceMarginRatio: 0.25, // 25% minimum equity cushion
    cushionWarningRatio: 0.35, // 35% warning banner
    borrowFeeAnnualRate: 0.035, // 3.5% annualized standard borrow
  },
  supportsShort: true,
  settlement: 'T+1',
  formatPrice: (price: number) => `$${price.toFixed(2)}`,
  formatQuantity: (qty: number) => `${Math.floor(qty).toLocaleString()} shs`,
  eventTypes: ['earnings', 'guidance', 'analyst_rating', 'fda_ruling', 'contract_award', 'merger_speculation', 'executive_change'],
};
