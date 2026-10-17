import { Company } from '../data/companies';
import { FactorCorrelationModel, MarketRegime, REGIME_CONFIGS } from './correlation';
import { SeededRNG } from './rng';

export interface Candle {
  time: number; // Unix seconds (as expected by TradingView Lightweight Charts)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AssetPriceState {
  ticker: string;
  price: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  previousClose: number;
  change: number;
  changePercent: number;
  volume: number;
  currentVol: number; // instant conditional volatility (GARCH)
  vwap: number;
  cumulativeValue: number;
  cumulativeVolume: number;
  candles1m: Candle[];
  candles5m: Candle[];
  candles15m: Candle[];
  candles1h: Candle[];
  candles1D: Candle[];
  lastTickDirection: 'up' | 'down' | 'flat';
  lastMoveDirection: 'up' | 'down';
  baseLambda: number; // updates per real second at 1x: [0.4, 1.5]
  timeUntilNextUpdate: number; // countdown in real seconds
  accumulatedSimSeconds: number; // aggregated sim seconds since last tick
}

export interface PricingEngineState {
  regime: MarketRegime;
  regimeDurationDays: number;
  states: AssetPriceState[];
}

export class PricingEngine {
  private rng: SeededRNG;
  private factorModel: FactorCorrelationModel;
  private states: Map<string, AssetPriceState>;
  private regime: MarketRegime;
  private regimeDurationDays: number = 0;

  constructor(rng: SeededRNG, companies: Company[]) {
    this.rng = rng;
    this.factorModel = new FactorCorrelationModel(rng);
    this.states = new Map<string, AssetPriceState>();
    this.regime = 'bull';

    const nowSec = Math.floor(Date.now() / 1000);

    for (const company of companies) {
      const p = company.initialPrice;
      const initialCandles = this.generateHistoricalCandles(company, p, nowSec);

      // Tier-based liquidity lambda: higher for liquid names, lower for illiquid ones
      // Base rate at 1x: about 0.4 to 1.5 displayed updates per second per symbol
      const tierBase = {
        mega: 1.30,
        large: 1.05,
        mid: 0.75,
        small: 0.50,
      }[company.marketCapTier] ?? 0.8;

      // Seeded jitter [-0.1, 0.1] so each symbol has unique, reproducible rate
      const jitter = (this.rng.next() - 0.5) * 0.2;
      const baseLambda = Math.max(0.4, Math.min(1.5, Math.round((tierBase + jitter) * 100) / 100));

      // Stagger initial phase offset so 48 symbols do not pulse in sync
      const initialOffset = (this.rng.next() * 1.5) / baseLambda;

      this.states.set(company.ticker, {
        ticker: company.ticker,
        price: p,
        openPrice: p,
        highPrice: p,
        lowPrice: p,
        previousClose: p,
        change: 0,
        changePercent: 0,
        volume: 0,
        currentVol: company.baseVol,
        vwap: p,
        cumulativeValue: p * 1000,
        cumulativeVolume: 1000,
        candles1m: initialCandles.c1m,
        candles5m: initialCandles.c5m,
        candles15m: initialCandles.c15m,
        candles1h: initialCandles.c1h,
        candles1D: initialCandles.c1D,
        lastTickDirection: 'flat',
        lastMoveDirection: 'up',
        baseLambda,
        timeUntilNextUpdate: initialOffset,
        accumulatedSimSeconds: 0,
      });
    }
  }

  getRegime(): MarketRegime {
    return this.regime;
  }

  setRegime(regime: MarketRegime) {
    this.regime = regime;
  }

  getState(ticker: string): AssetPriceState | undefined {
    return this.states.get(ticker);
  }

  getAllStates(): AssetPriceState[] {
    return Array.from(this.states.values());
  }

  exportState(): PricingEngineState {
    return {
      regime: this.regime,
      regimeDurationDays: this.regimeDurationDays,
      states: this.getAllStates().map((s) => ({
        ...s,
        candles1m: s.candles1m.map((c) => ({ ...c })),
        candles5m: s.candles5m.map((c) => ({ ...c })),
        candles15m: s.candles15m.map((c) => ({ ...c })),
        candles1h: s.candles1h.map((c) => ({ ...c })),
        candles1D: s.candles1D.map((c) => ({ ...c })),
      })),
    };
  }

  importState(state: PricingEngineState) {
    this.regime = state.regime;
    this.regimeDurationDays = state.regimeDurationDays;
    const next = new Map<string, AssetPriceState>();
    for (const s of state.states) {
      next.set(s.ticker, {
        ...s,
        candles1m: s.candles1m.map((c) => ({ ...c })),
        candles5m: s.candles5m.map((c) => ({ ...c })),
        candles15m: s.candles15m.map((c) => ({ ...c })),
        candles1h: s.candles1h.map((c) => ({ ...c })),
        candles1D: s.candles1D.map((c) => ({ ...c })),
      });
    }
    this.states = next;
  }

  getPriceMap(): Map<string, number> {
    const map = new Map<string, number>();
    for (const [t, s] of this.states.entries()) {
      map.set(t, s.price);
    }
    return map;
  }

  // Markov chain transition for market regimes
  stepRegimeDaily() {
    this.regimeDurationDays += 1;
    // Regime persistence: ~85% chance to stay in current regime, otherwise transition
    if (this.regimeDurationDays > 5 && this.rng.next() < 0.15) {
      const roll = this.rng.next();
      if (this.regime === 'bull') {
        this.regime = roll < 0.70 ? 'chop' : (roll < 0.90 ? 'bear' : 'panic');
      } else if (this.regime === 'bear') {
        this.regime = roll < 0.60 ? 'chop' : (roll < 0.85 ? 'bull' : 'panic');
      } else if (this.regime === 'chop') {
        this.regime = roll < 0.45 ? 'bull' : (roll < 0.80 ? 'bear' : 'panic');
      } else if (this.regime === 'panic') {
        // Panic regimes are short-lived
        this.regime = roll < 0.50 ? 'bear' : 'chop';
      }
      this.regimeDurationDays = 0;
    }
  }

  // Advance intraday price step with per-symbol Poisson-style arrivals and speed-aware aggregation
  stepTick(
    companies: Company[],
    intradayFraction: number, // 0.0 at 09:30, 1.0 at 16:00
    realSecondsElapsed: number,
    simSecondsElapsed: number,
    activeJumpEvents: Map<string, number>, // ticker -> jump delta
    speed: number = 1
  ): Map<string, { price: number; direction: 'up' | 'down' | 'flat'; volumeStep: number }> {
    const config = REGIME_CONFIGS[this.regime];
    const factorShocks = this.factorModel.generateFactorShocks(this.regime, companies);
    const tickResult = new Map<string, { price: number; direction: 'up' | 'down' | 'flat'; volumeStep: number }>();

    // Intraday U-shaped volume and volatility curve:
    // High at open (0.0) and close (1.0), lower in midday (0.5)
    const uCurve = 1.0 + 1.2 * (2 * intradayFraction - 1) ** 2;

    // Rate multiplier by speed: 1x = 1, 5x = 2, 20x = 3.5. Do NOT multiply linearly.
    const speedMultiplier = speed >= 20 ? 3.5 : speed >= 5 ? 2.0 : speed >= 1 ? 1.0 : 0;

    for (const comp of companies) {
      const state = this.states.get(comp.ticker);
      if (!state) continue;

      const shock = factorShocks.get(comp.ticker) ?? 0;

      // 1. GARCH(1,1) Volatility clustering:
      const omega = 0.05 * (comp.baseVol ** 2);
      const alpha = 0.12;
      const beta = 0.83;
      const nextVariance = omega + alpha * (shock ** 2) * (state.currentVol ** 2) + beta * (state.currentVol ** 2);
      state.currentVol = Math.sqrt(nextVariance) * config.baseVolMultiplier;

      // Accumulate elapsed sim seconds for this symbol
      state.accumulatedSimSeconds += simSecondsElapsed;

      // Update Poisson arrival countdown in real seconds
      if (speed > 0) {
        state.timeUntilNextUpdate -= realSecondsElapsed;
      }

      const hasJump = activeJumpEvents.has(comp.ticker);
      const currentLambda = Math.max(0.1, state.baseLambda * speedMultiplier);
      const shouldUpdate = speed > 0 && (state.timeUntilNextUpdate <= 0 || hasJump);

      if (!shouldUpdate) {
        // Did not tick this cycle: direction is flat, no price movement emitted
        state.lastTickDirection = 'flat';
        continue;
      }

      // Draw next Poisson inter-arrival delay from exponential distribution
      const u = Math.max(1e-6, this.rng.next());
      const nextDelay = -Math.log(u) / currentLambda;
      state.timeUntilNextUpdate = nextDelay;

      // Aggregate the extra sim time into larger price steps instead of emitting more ticks
      const simSecs = Math.max(1, state.accumulatedSimSeconds);
      state.accumulatedSimSeconds = 0;

      const dt = simSecs / (6.5 * 3600);

      // 2. Mean reversion toward fundamental fair value
      const fairValue = comp.fundamentals.fairValue;
      const meanReversionDrift = 0.02 * (fairValue - state.price) / fairValue;

      // 3. Asset drift = market regime drift + mean reversion
      const totalDrift = config.marketDriftDaily / 6.5 + meanReversionDrift;

      // 4. Volatility diffusion scaled with sqrt(simSecs)
      const stepVol = (state.currentVol * Math.sqrt(simSecs / (252 * 6.5 * 3600))) * uCurve;
      const diffusion = stepVol * shock;

      // 5. Jump shock from news/earnings
      const jump = activeJumpEvents.get(comp.ticker) || 0;

      // Composite percentage return
      const ret = totalDrift * dt + diffusion + jump;
      const oldPrice = state.price;
      const rawNewPrice = Math.max(0.50, oldPrice * (1 + ret));

      // 1. Quantize before comparing: round to asset's tick size ($0.01)
      const newPrice = Math.round(rawNewPrice * 100) / 100;
      const oldQuantized = Math.round(oldPrice * 100) / 100;

      let direction: 'up' | 'down' | 'flat' = 'flat';
      if (newPrice > oldQuantized) {
        direction = 'up';
        state.lastMoveDirection = 'up';
      } else if (newPrice < oldQuantized) {
        direction = 'down';
        state.lastMoveDirection = 'down';
      }

      state.lastTickDirection = direction;
      state.price = newPrice;

      // Update session high/low
      if (newPrice > state.highPrice) state.highPrice = newPrice;
      if (newPrice < state.lowPrice) state.lowPrice = newPrice;

      state.change = Math.round((newPrice - state.previousClose) * 100) / 100;
      state.changePercent = state.previousClose > 0
        ? Math.round((state.change / state.previousClose) * 10000) / 100
        : 0;

      // Volume generation based on liquidity and U-curve
      const baseTickVol = (comp.averageDailyVolume / (6.5 * 3600)) * uCurve * simSecs;
      const volNoise = 0.5 + this.rng.next();
      const volumeStep = Math.max(10, Math.round(baseTickVol * volNoise * (1 + Math.abs(shock) * 1.5)));
      state.volume += volumeStep;

      // VWAP
      state.cumulativeValue += newPrice * volumeStep;
      state.cumulativeVolume += volumeStep;
      state.vwap = Math.round((state.cumulativeValue / state.cumulativeVolume) * 100) / 100;

      tickResult.set(comp.ticker, { price: newPrice, direction, volumeStep });
    }

    return tickResult;
  }

  // Update real-time candle aggregations
  updateCandles(simTimeSec: number) {
    for (const state of this.states.values()) {
      const p = state.price;
      const v = state.volume;

      // Update 1m candle (rounded to minute boundary)
      this.accumulateCandle(state.candles1m, p, v, simTimeSec, 60);

      // Update 5m candle
      this.accumulateCandle(state.candles5m, p, v, simTimeSec, 300);

      // Update 15m candle
      this.accumulateCandle(state.candles15m, p, v, simTimeSec, 900);

      // Update 1h candle
      this.accumulateCandle(state.candles1h, p, v, simTimeSec, 3600);

      // Update 1D candle
      this.accumulateCandle(state.candles1D, p, v, simTimeSec, 86400);
    }
  }

  private accumulateCandle(
    candles: Candle[],
    price: number,
    volume: number,
    simTimeSec: number,
    timeframeSec: number
  ) {
    const bucketTime = Math.floor(simTimeSec / timeframeSec) * timeframeSec;
    const last = candles[candles.length - 1];

    if (!last || last.time < bucketTime) {
      candles.push({
        time: bucketTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
      });
      // Keep candle memory bounded
      if (candles.length > 300) {
        candles.shift();
      }
    } else {
      if (price > last.high) last.high = price;
      if (price < last.low) last.low = price;
      last.close = price;
      last.volume += 100;
    }
  }

  // Session reset for new trading day
  startNewDay(simTimeSec: number) {
    this.stepRegimeDaily();

    for (const state of this.states.values()) {
      state.previousClose = state.price;
      state.openPrice = state.price;
      state.highPrice = state.price;
      state.lowPrice = state.price;
      state.change = 0;
      state.changePercent = 0;
      state.volume = 0;
      state.cumulativeValue = state.price * 100;
      state.cumulativeVolume = 100;
      state.vwap = state.price;
      state.accumulatedSimSeconds = 0;
      state.timeUntilNextUpdate = (this.rng.next() * 1.5) / state.baseLambda;
    }
  }

  // Generate realistic historical daily and intraday candles for initial chart display
  private generateHistoricalCandles(
    company: Company,
    initialPrice: number,
    endTimeSec: number
  ): { c1m: Candle[]; c5m: Candle[]; c15m: Candle[]; c1h: Candle[]; c1D: Candle[] } {
    const c1D: Candle[] = [];
    const c1h: Candle[] = [];
    const c15m: Candle[] = [];
    const c5m: Candle[] = [];
    const c1m: Candle[] = [];

    let curP = initialPrice * 0.90; // started 10% lower 30 days ago
    const daySec = 86400;

    // 1. Generate 30 daily candles
    for (let d = 30; d >= 1; d--) {
      const t = endTimeSec - d * daySec;
      const drift = 0.001;
      const shock = this.rng.nextGaussian(drift, company.baseVol / Math.sqrt(252));
      const open = curP;
      const close = Math.round(open * (1 + shock) * 100) / 100;
      const high = Math.round(Math.max(open, close) * (1 + Math.abs(this.rng.nextGaussian(0, 0.008))) * 100) / 100;
      const low = Math.round(Math.min(open, close) * (1 - Math.abs(this.rng.nextGaussian(0, 0.008))) * 100) / 100;
      const vol = Math.round(company.averageDailyVolume * (0.8 + this.rng.next() * 0.4));

      c1D.push({ time: t, open, high, low, close, volume: vol });
      curP = close;
    }

    // 2. Generate 1h, 15m, 5m, 1m for today
    const baseTodayOpen = curP;
    let minutePrice = baseTodayOpen;

    for (let m = 60; m >= 0; m--) {
      const t = endTimeSec - m * 60;
      const mShock = this.rng.nextGaussian(0, 0.0012);
      const open = minutePrice;
      const close = Math.round(open * (1 + mShock) * 100) / 100;
      const high = Math.round(Math.max(open, close) * 1.0008 * 100) / 100;
      const low = Math.round(Math.min(open, close) * 0.9992 * 100) / 100;
      const vol = Math.round((company.averageDailyVolume / 390) * (0.8 + this.rng.next() * 0.5));

      c1m.push({ time: t, open, high, low, close, volume: vol });
      minutePrice = close;
    }

    // 5m candles
    for (let i = 0; i < c1m.length; i += 5) {
      const chunk = c1m.slice(i, i + 5);
      if (chunk.length === 0) continue;
      c5m.push({
        time: chunk[0].time,
        open: chunk[0].open,
        high: Math.max(...chunk.map(c => c.high)),
        low: Math.min(...chunk.map(c => c.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((acc, c) => acc + c.volume, 0),
      });
    }

    // 15m candles
    for (let i = 0; i < c1m.length; i += 15) {
      const chunk = c1m.slice(i, i + 15);
      if (chunk.length === 0) continue;
      c15m.push({
        time: chunk[0].time,
        open: chunk[0].open,
        high: Math.max(...chunk.map(c => c.high)),
        low: Math.min(...chunk.map(c => c.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((acc, c) => acc + c.volume, 0),
      });
    }

    // 1h candles
    for (let i = 0; i < c1m.length; i += 60) {
      const chunk = c1m.slice(i, i + 60);
      if (chunk.length === 0) continue;
      c1h.push({
        time: chunk[0].time,
        open: chunk[0].open,
        high: Math.max(...chunk.map(c => c.high)),
        low: Math.min(...chunk.map(c => c.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((acc, c) => acc + c.volume, 0),
      });
    }

    return { c1m, c5m, c15m, c1h, c1D };
  }
}
