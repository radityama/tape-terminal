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
  averagePrice: number;
  slippageDollars: number;
  slippageBps: number;
  basePrice: number;
  totalCost: number;
  levelsWalked: number;
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

  // Simulates market order fill by walking through the book levels (slippage modeling)
  simulateFill(
    side: 'buy' | 'sell',
    quantity: number,
    depth: OrderBookDepth
  ): FillSimulation {
    const qty = Math.max(1, Math.floor(quantity));
    const levels = side === 'buy' ? depth.asks : depth.bids;
    const basePrice = side === 'buy' ? depth.bestAsk : depth.bestBid;

    let remainingQty = qty;
    let accumulatedValue = 0;
    let levelsWalked = 0;

    for (let i = 0; i < levels.length; i++) {
      if (remainingQty <= 0) break;
      levelsWalked = i + 1;
      const level = levels[i];
      const fillAtLevel = Math.min(remainingQty, level.size);
      accumulatedValue += fillAtLevel * level.price;
      remainingQty -= fillAtLevel;
    }

    // If order is massive and completely sweeps the 5 visible levels:
    if (remainingQty > 0) {
      const lastLevel = levels[levels.length - 1];
      const overflowStep = depth.spread * 1.5;
      const overflowPrice = side === 'buy'
        ? lastLevel.price + overflowStep
        : Math.max(0.01, lastLevel.price - overflowStep);

      accumulatedValue += remainingQty * overflowPrice;
      levelsWalked += 1;
    }

    const averagePrice = Math.round((accumulatedValue / qty) * 100) / 100;
    const slippageDollars = Math.abs(averagePrice - basePrice);
    const slippageBps = Math.round((slippageDollars / basePrice) * 10000 * 10) / 10;
    const totalCost = Math.round(accumulatedValue * 100) / 100;

    return {
      averagePrice,
      slippageDollars,
      slippageBps,
      basePrice,
      totalCost,
      levelsWalked,
    };
  }
}
