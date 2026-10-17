import { AssetClass } from './types';

// TODO(asset-class): Equity Options module plug-in for Phase 2
// Implements Black-Scholes pricing, Greeks (Delta, Gamma, Theta, Vega, Rho), expiration cycles, and exercise/assignment
export const OptionsAssetClassStub: AssetClass = {
  id: 'options',
  name: 'Equity Options',
  tradingHours: {
    openTime: '09:30',
    closeTime: '16:00',
    hasPreMarket: false,
    hasAfterHours: false,
    is24x7: false,
  },
  tickSize: 0.01,
  lotSize: 1, // 1 contract = 100 shares multiplier
  pricingModel: 'black-scholes-merton',
  feeModel: {
    basePerTrade: 1.0,
    perUnitFee: 0.65, // $0.65 per contract
    percentageFee: 0,
    minimumFee: 1.65,
  },
  marginRules: {
    initialMarginRatio: 1.0, // Long options 100% cash; Naked short options custom margin
    maintenanceMarginRatio: 1.0,
    cushionWarningRatio: 1.1,
    borrowFeeAnnualRate: 0,
  },
  supportsShort: true,
  settlement: 'T+1',
  formatPrice: (price: number) => `$${price.toFixed(2)}`,
  formatQuantity: (qty: number) => `${Math.floor(qty)} contracts`,
  eventTypes: ['implied_vol_crush', 'pin_risk', 'early_assignment'],
};
