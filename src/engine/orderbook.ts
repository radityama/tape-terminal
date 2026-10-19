import { Company } from '../data/companies';
import { MarketRegime, REGIME_CONFIGS } from './correlation';
import { SeededRNG } from './rng';

export interface BookLevel {
  price: number;
  size: number; // in shares
  total: number; // cumulative size
}

export interface OrderBookDepth {
  ticker: string;
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  bids: BookLevel[]; // 5 levels sorted high to low
  asks: BookLevel[]; // 5 levels sorted low to high
  lastUpdate: number;
}

export interface FillSimulation {
  filledQuantity: number;
  fills: Array<{ level: number; shares: number }>;
  averagePrice: number;
  slippageDollars: number;
  slippageBps: number;
  basePrice: number;
  totalCost: number;
  levelsWalked: number;
}

export function walkDepth(side: 'buy' | 'sell', quantity: number, depth: OrderBookDepth, limitPrice?: number): FillSimulation {
  const levels = side === 'buy' ? depth.asks : depth.bids;
  const first = levels.find((level) => level.size > 0);
  const basePrice = first?.price ?? (side === 'buy' ? depth.bestAsk : depth.bestBid);
  let remaining = Math.max(0, Math.floor(quantity));
  let value = 0;
  const fills: FillSimulation['fills'] = [];
  for (const [levelIndex, level] of levels.entries()) {
    if (!remaining || (limitPrice !== undefined && (side === 'buy' ? level.price > limitPrice : level.price < limitPrice))) break;
    const shares = Math.min(remaining, level.size);
    if (!shares) continue;
    fills.push({ level: levelIndex, shares });
    value += shares * level.price;
    remaining -= shares;
  }
  const filledQuantity = Math.max(0, Math.floor(quantity)) - remaining;
  const averagePrice = filledQuantity ? Math.round(value / filledQuantity * 100) / 100 : 0;
  const slippageDollars = filledQuantity ? Math.abs(averagePrice - basePrice) : 0;
  return {
    filledQuantity, fills, averagePrice, slippageDollars,
    slippageBps: basePrice > 0 ? Math.round(slippageDollars / basePrice * 100000) / 10 : 0,
    basePrice, totalCost: Math.round(value * 100) / 100, levelsWalked: fills.length,
  };
}

export class OrderBookEngine {
  private rng: SeededRNG;

  constructor(rng: SeededRNG) {
    this.rng = rng;
  }

  // Generates 5-level depth ladder based on current price, liquidity tier, and market regime
  generateDepth(
    company: Company,
    currentPrice: number,
    regime: MarketRegime,
    eventVolMultiplier: number = 1.0
  ): OrderBookDepth {
    const regimeConfig = REGIME_CONFIGS[regime];
    const tier = company.marketCapTier;

    // Base spread in basis points depending on cap tier
    let baseSpreadBps = 3.5; // mega (3.5 bps)
    let baseLevelShares = 2500;

    if (tier === 'large') {
      baseSpreadBps = 6.0;
      baseLevelShares = 1500;
    } else if (tier === 'mid') {
      baseSpreadBps = 12.0;
      baseLevelShares = 800;
    } else if (tier === 'small') {
      baseSpreadBps = 24.0;
      baseLevelShares = 400;
    }

    // Volatility and regime adjustment
    const volRatio = (company.baseVol / 0.25);
    const totalMultiplier = regimeConfig.spreadMultiplier * eventVolMultiplier * volRatio;
    const effectiveSpreadBps = Math.max(2.0, baseSpreadBps * totalMultiplier);

    // Compute nominal half-spread with 1 cent minimum
    const halfSpread = Math.max(0.01, Math.round((currentPrice * (effectiveSpreadBps / 10000) / 2) * 100) / 100);
    const bestBid = Math.max(0.01, Math.round((currentPrice - halfSpread) * 100) / 100);
    const bestAsk = Math.max(bestBid + 0.01, Math.round((currentPrice + halfSpread) * 100) / 100);
    const spread = Math.round((bestAsk - bestBid) * 100) / 100;
    const spreadBps = Math.round((spread / currentPrice) * 10000 * 10) / 10;

    // Tick increment between depth ladder levels
    const levelTick = Math.max(0.01, Math.round((spread * 0.75) * 100) / 100);

    const bids: BookLevel[] = [];
    let cumBid = 0;
    for (let i = 0; i < 5; i++) {
      const p = Math.max(0.01, Math.round((bestBid - i * levelTick) * 100) / 100);
      const sizeNoise = 0.75 + this.rng.next() * 0.5;
      const size = Math.round((baseLevelShares * (1 + i * 0.4) * sizeNoise) / 10) * 10;
      cumBid += size;
      bids.push({ price: p, size, total: cumBid });
    }

    const asks: BookLevel[] = [];
    let cumAsk = 0;
    for (let i = 0; i < 5; i++) {
      const p = Math.round((bestAsk + i * levelTick) * 100) / 100;
      const sizeNoise = 0.75 + this.rng.next() * 0.5;
      const size = Math.round((baseLevelShares * (1 + i * 0.4) * sizeNoise) / 10) * 10;
      cumAsk += size;
      asks.push({ price: p, size, total: cumAsk });
    }

    return {
      ticker: company.ticker,
      midPrice: Math.round(((bestBid + bestAsk) / 2) * 100) / 100,
      bestBid,
      bestAsk,
      spread,
      spreadBps,
      bids,
      asks,
      lastUpdate: Date.now(),
    };
  }

  simulateFill(side: 'buy' | 'sell', quantity: number, depth: OrderBookDepth, limitPrice?: number): FillSimulation {
    return walkDepth(side, quantity, depth, limitPrice);
  }
}
