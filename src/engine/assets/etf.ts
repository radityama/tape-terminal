import { AssetClass } from './types';

// TODO(asset-class): Exchange Traded Funds (ETFs) module plug-in for Phase 2
// Implements creation/redemption arbitrage, net asset value (NAV) tracking, and sector baskets
export const ETFAssetClassStub: AssetClass = {
  id: 'etf',
  name: 'Exchange Traded Funds',
  tradingHours: {
    openTime: '09:30',
    closeTime: '16:00',
    hasPreMarket: true,
    hasAfterHours: true,
    is24x7: false,
  },
  tickSize: 0.01,
  lotSize: 1,
  pricingModel: 'nav-arbitrage-basket',
  feeModel: {
    basePerTrade: 0.5,
    perUnitFee: 0.003,
    percentageFee: 0.0001,
    minimumFee: 1.0,
  },
  marginRules: {
    initialMarginRatio: 0.5,
    maintenanceMarginRatio: 0.25,
    cushionWarningRatio: 0.35,
    borrowFeeAnnualRate: 0.02,
  },
  supportsShort: true,
  settlement: 'T+1',
  formatPrice: (price: number) => `$${price.toFixed(2)}`,
  formatQuantity: (qty: number) => `${Math.floor(qty).toLocaleString()} shs`,
  eventTypes: ['rebalancing', 'dividend_distribution', 'inflow_surge'],
};
