import { expect, test } from 'vitest';
import { COMPANY_MAP, COMPANIES } from '../data/companies';
import { MarketSimulationEngine } from './market';
import {
  MAX_PRICE_FACTOR,
  MIN_PRICE_FACTOR,
  PricingEngine,
  VOL_CEIL_MULT,
  VOL_FLOOR_MULT,
} from './pricing';
import { SeededRNG } from './rng';

function priceFloor(fairValue: number): number {
  return Math.max(0.5, fairValue * MIN_PRICE_FACTOR);
}

function priceCeiling(fairValue: number): number {
  return fairValue * MAX_PRICE_FACTOR;
}

test('panic and bear regimes cannot grow conditional volatility without bound', () => {
  for (const regime of ['bear', 'panic'] as const) {
    const pricing = new PricingEngine(new SeededRNG(`GARCH_${regime}`), COMPANIES);
    pricing.setRegime(regime);
    for (let i = 0; i < 400; i++) {
      pricing.stepTick(COMPANIES, 0.5, 1, 65, new Map(), 1);
    }
    for (const state of pricing.getAllStates()) {
      const company = COMPANY_MAP.get(state.ticker);
      expect(company, state.ticker).toBeDefined();
      if (!company) continue;
      expect(Number.isFinite(state.currentVol), `${state.ticker} vol finite`).toBe(true);
      expect(state.currentVol, `${state.ticker} vol ceiling`).toBeLessThanOrEqual(
        company.baseVol * VOL_CEIL_MULT + 1e-12
      );
      expect(state.currentVol, `${state.ticker} vol floor`).toBeGreaterThanOrEqual(
        company.baseVol * VOL_FLOOR_MULT - 1e-12
      );
      expect(Number.isFinite(state.price), `${state.ticker} price finite`).toBe(true);
      expect(state.price, `${state.ticker} price ceiling`).toBeLessThanOrEqual(
        priceCeiling(company.fundamentals.fairValue) + 0.01
      );
      expect(state.price, `${state.ticker} price floor`).toBeGreaterThanOrEqual(
        priceFloor(company.fundamentals.fairValue) - 0.01
      );
    }
  }
});

test('volatility only recurs when a price step actually happens', () => {
  const pricing = new PricingEngine(new SeededRNG('NO_UPDATE'), COMPANIES);
  const before = pricing.getAllStates().map((s) => s.currentVol);
  // Zero elapsed time: no Poisson arrival can fire.
  for (let i = 0; i < 25; i++) {
    pricing.stepTick(COMPANIES, 0.5, 0, 0, new Map(), 1);
  }
  const after = pricing.getAllStates().map((s) => s.currentVol);
  expect(after).toEqual(before);
});

const SEEDS = ['PROP_A', 'PROP_B', 'PROP_C', 'PROP_D', 'PROP_E'];
const DAYS = 750;
const DAY_SIM_SECONDS = 7 * 3600;

function annualizedVol(closes: number[]): number {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function runMarket(seed: string, speed: 1 | 20) {
  const engine = new MarketSimulationEngine(seed);
  engine.setSpeed(speed);
  const realStep = speed === 1 ? 10 : 1;
  const simPerTick = realStep * 65 * speed;
  // A tick that lands on the close advances the day without stepping prices, so budget one
  // extra tick per day on top of the pure sim-seconds estimate.
  const maxTicks = Math.ceil(((DAYS + 3) * DAY_SIM_SECONDS) / simPerTick) + DAYS + 20;
  const dailyCloses = new Map<string, number[]>();
  let day = 1;
  let tape50Finite = true;

  for (let i = 0; i < maxTicks && day <= DAYS; i++) {
    engine.tick(realStep);
    const snapshot = engine.getSnapshot();
    if (!Number.isFinite(snapshot.tape50.value)) tape50Finite = false;
    if (snapshot.simDay !== day) {
      day = snapshot.simDay;
      for (const quote of snapshot.prices) {
        const closes = dailyCloses.get(quote.ticker) ?? [];
        closes.push(quote.price);
        dailyCloses.set(quote.ticker, closes);
      }
    }
  }

  return { day, dailyCloses, tape50Finite, finalSnapshot: engine.getSnapshot() };
}

for (const speed of [1, 20] as const) {
  for (const seed of SEEDS) {
    test(
      `750 sim days stay finite and bounded at ${speed}x (seed ${seed})`,
      () => {
        const { day, dailyCloses, tape50Finite, finalSnapshot } = runMarket(seed, speed);

        expect(day, 'simulated the full career').toBeGreaterThanOrEqual(DAYS);
        expect(tape50Finite, 'TAPE50 index stayed finite').toBe(true);
        expect(Number.isFinite(finalSnapshot.tape50.value)).toBe(true);
        expect(finalSnapshot.prices).toHaveLength(COMPANIES.length);

        for (const quote of finalSnapshot.prices) {
          const company = COMPANY_MAP.get(quote.ticker);
          expect(company, quote.ticker).toBeDefined();
          if (!company) continue;
          const floor = priceFloor(company.fundamentals.fairValue);
          const ceiling = priceCeiling(company.fundamentals.fairValue);

          expect(Number.isFinite(quote.price), `${quote.ticker} finite`).toBe(true);
          expect(quote.price, `${quote.ticker} within soft bounds`).toBeGreaterThanOrEqual(floor - 0.01);
          expect(quote.price, `${quote.ticker} within soft bounds`).toBeLessThanOrEqual(ceiling + 0.01);

          const closes = dailyCloses.get(quote.ticker) ?? [];
          expect(closes.length, `${quote.ticker} daily closes`).toBeGreaterThanOrEqual(DAYS - 5);
          const vol = annualizedVol(closes);
          expect(Number.isFinite(vol), `${quote.ticker} vol finite`).toBe(true);
          expect(vol, `${quote.ticker} annualized vol plausible`).toBeGreaterThan(0.02);
          expect(vol, `${quote.ticker} annualized vol plausible`).toBeLessThan(3);

          const stuck = closes.filter(
            (price) => price <= floor * 1.001 || price >= ceiling * 0.999
          ).length;
          expect(
            stuck / closes.length,
            `${quote.ticker} not stuck at a bound for most of the run`
          ).toBeLessThan(0.5);
        }
      },
      180000
    );
  }
}
