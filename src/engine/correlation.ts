import { Sector, SECTORS } from '../data/companies';
import { SeededRNG } from './rng';

export type MarketRegime = 'bull' | 'bear' | 'chop' | 'panic';

export interface RegimeParameters {
  name: MarketRegime;
  marketDriftDaily: number; // annualized or daily drift
  baseVolMultiplier: number;
  marketCorrelation: number; // weight of global market factor
  sectorCorrelation: number; // weight of sector factor
  spreadMultiplier: number; // bid-ask widening in stress
  jumpProbabilityDaily: number;
}

export const REGIME_CONFIGS: Record<MarketRegime, RegimeParameters> = {
  bull: {
    name: 'bull',
    marketDriftDaily: 0.0006, // +15% annual
    baseVolMultiplier: 0.85,
    marketCorrelation: 0.35,
    sectorCorrelation: 0.25,
    spreadMultiplier: 1.0,
    jumpProbabilityDaily: 0.04,
  },
  bear: {
    name: 'bear',
    marketDriftDaily: -0.0008, // -20% annual
    baseVolMultiplier: 1.35,
    marketCorrelation: 0.55,
    sectorCorrelation: 0.25,
    spreadMultiplier: 1.25,
    jumpProbabilityDaily: 0.09,
  },
  chop: {
    name: 'chop',
    marketDriftDaily: 0.00005, // flat
    baseVolMultiplier: 1.0,
    marketCorrelation: 0.30,
    sectorCorrelation: 0.30,
    spreadMultiplier: 1.0,
    jumpProbabilityDaily: 0.05,
  },
  panic: {
    name: 'panic',
    marketDriftDaily: -0.0035, // sharp crash
    baseVolMultiplier: 2.50,
    marketCorrelation: 0.82, // correlations spike toward 1
    sectorCorrelation: 0.12,
    spreadMultiplier: 2.8,
    jumpProbabilityDaily: 0.25,
  },
};

// Generates correlated asset shocks across market factor, sector factors, and idiosyncratic noise
export class FactorCorrelationModel {
  private rng: SeededRNG;

  constructor(rng: SeededRNG) {
    this.rng = rng;
  }

  // Generate correlated return innovations for all stocks in the universe
  generateFactorShocks(
    regime: MarketRegime,
    companies: Array<{ ticker: string; sector: Sector; beta: number }>
  ): Map<string, number> {
    const config = REGIME_CONFIGS[regime];

    // 1. Common Market Factor Shock
    const marketShock = this.rng.nextGaussian(0, 1);

    // 2. Sector Factor Shocks
    const sectorShocks = new Map<Sector, number>();
    for (const sector of SECTORS) {
      sectorShocks.set(sector, this.rng.nextGaussian(0, 1));
    }

    // 3. Composite asset shock combining market + sector + idiosyncratic
    const assetShocks = new Map<string, number>();

    const wM = config.marketCorrelation;
    const wS = config.sectorCorrelation;

    for (const comp of companies) {
      const sShock = sectorShocks.get(comp.sector) ?? 0;
      const idioShock = this.rng.nextGaussian(0, 1);

      // Clamp factor weights to prevent negative radical under extreme beta
      const effectiveMarketWeight = Math.min(0.9, wM * Math.max(0.5, Math.min(2.0, comp.beta)));
      const effectiveSectorWeight = wS;
      const combinedWeight = effectiveMarketWeight ** 2 + effectiveSectorWeight ** 2;
      const idioWeight = Math.sqrt(Math.max(0.04, 1 - combinedWeight));

      const shock = (effectiveMarketWeight * marketShock) + (effectiveSectorWeight * sShock) + (idioWeight * idioShock);
      assetShocks.set(comp.ticker, shock);
    }

    return assetShocks;
  }
}
