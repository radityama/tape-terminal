import { AssetClass } from './types';

// TODO(asset-class): Cryptocurrency module plug-in for Phase 2
// Implements 24/7 continuous continuous trading, fractional Satoshi lot sizes, high-volatility regime jumps
export const CryptoAssetClassStub: AssetClass = {
  id: 'crypto',
  name: 'Cryptocurrencies',
  tradingHours: {
    openTime: '00:00',
    closeTime: '23:59',
    hasPreMarket: false,
    hasAfterHours: false,
    is24x7: true,
  },
  tickSize: 0.01,
  lotSize: 0.0001,
  pricingModel: 'high-vol-order-flow',
  feeModel: {
    basePerTrade: 0,
    perUnitFee: 0,
    percentageFee: 0.001, // 10 bps taker fee
    minimumFee: 0.5,
  },
  marginRules: {
    initialMarginRatio: 0.2, // 5:1 leverage
    maintenanceMarginRatio: 0.1,
    cushionWarningRatio: 0.15,
    borrowFeeAnnualRate: 0.08,
  },
  supportsShort: true,
  settlement: 'T+0',
  formatPrice: (price: number) => `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  formatQuantity: (qty: number) => `${qty.toFixed(4)} coins`,
  eventTypes: ['protocol_upgrade', 'regulatory_ruling', 'whale_transfer', 'exchange_liquidation'],
};
