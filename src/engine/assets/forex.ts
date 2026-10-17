import { AssetClass } from './types';

// TODO(asset-class): Forex module plug-in for Phase 2
// Implements 24h currency pair quote conventions (EUR/USD, USD/JPY, GBP/USD), pip calculations, and rollover swaps
export const ForexAssetClassStub: AssetClass = {
  id: 'forex',
  name: 'Foreign Exchange',
  tradingHours: {
    openTime: '17:00 Sun',
    closeTime: '17:00 Fri',
    hasPreMarket: false,
    hasAfterHours: false,
    is24x7: false,
  },
  tickSize: 0.0001, // 1 pip (0.01 for JPY pairs)
  lotSize: 100000, // standard lot
  pricingModel: 'order-flow-macro',
  feeModel: {
    basePerTrade: 0,
    perUnitFee: 0.00002,
    percentageFee: 0.00005,
    minimumFee: 2.0,
  },
  marginRules: {
    initialMarginRatio: 0.02, // 50:1 leverage
    maintenanceMarginRatio: 0.01,
    cushionWarningRatio: 0.015,
    borrowFeeAnnualRate: 0.02,
  },
  supportsShort: true,
  settlement: 'T+2',
  formatPrice: (price: number) => price.toFixed(4),
  formatQuantity: (qty: number) => `${(qty / 1000).toFixed(0)}k units`,
  eventTypes: ['central_bank_rates', 'cpi_print', 'trade_balance', 'fx_intervention'],
};
