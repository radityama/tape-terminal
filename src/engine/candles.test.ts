import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MarketSimulationEngine } from './market.ts';
import { PricingEngine } from './pricing.ts';
import { SeededRNG } from './rng.ts';
import { COMPANY_MAP, COMPANIES } from '../data/companies.ts';
import { SIM_EPOCH_SEC, SIM_OPEN_SECONDS, simCandleBucket, simMarketTimestamp } from './sim-time.ts';

const TIMEFRAMES = [['1m', 60], ['5m', 300], ['15m', 900], ['1h', 3600], ['1D', 86400]] as const;

function candles(engine: MarketSimulationEngine, ticker = 'HLVG') {
  return TIMEFRAMES.map(([tf]) => engine.getCandles(ticker, tf));
}

function assertAscendingUnique(times: number[]) {
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] > times[i - 1], `candle times must increase: ${times[i - 1]} -> ${times[i]}`);
  }
}

test('simulated time maps one sim minute to one chart minute from a fixed epoch', () => {
  assert.equal(simMarketTimestamp(1, SIM_OPEN_SECONDS), SIM_EPOCH_SEC + SIM_OPEN_SECONDS);
  assert.equal(simMarketTimestamp(2, SIM_OPEN_SECONDS) - simMarketTimestamp(1, SIM_OPEN_SECONDS), 86400);
  assert.equal(simCandleBucket(simMarketTimestamp(1, SIM_OPEN_SECONDS), 60), simMarketTimestamp(1, SIM_OPEN_SECONDS));
  assert.equal(simCandleBucket(simMarketTimestamp(1, SIM_OPEN_SECONDS), 86400), simMarketTimestamp(1, SIM_OPEN_SECONDS));
  assert.equal(simCandleBucket(simMarketTimestamp(3, SIM_OPEN_SECONDS + 3600), 86400), simMarketTimestamp(3, SIM_OPEN_SECONDS));

  const engine = new MarketSimulationEngine('G7_EPOCH', 100_000);
  for (const [frame] of TIMEFRAMES) {
    const series = engine.getCandles('HLVG', frame);
    assert.ok(series.length > 0);
    assert.ok(series.every((candle) => candle.time > 1_700_000_000), 'no wall-clock timestamps');
    assertAscendingUnique(series.map((candle) => candle.time));
  }
});

test('historical hourly bars cover their clock-hour buckets', () => {
  const engine = new MarketSimulationEngine('G7_HISTORY_HOURS', 100_000);
  const minutes = engine.getCandles('HLVG', '1m');
  const hours = engine.getCandles('HLVG', '1h');
  const minuteBuckets = [...new Set(minutes.map((candle) => simCandleBucket(candle.time, 3600)))];
  assert.deepEqual(hours.map((hour) => hour.time), minuteBuckets);
  for (const hour of hours) {
    const expected = minutes.filter((candle) => simCandleBucket(candle.time, 3600) === hour.time);
    assert.ok(expected.length > 0);
    assert.equal(hour.open, expected[0].open);
    assert.equal(hour.high, Math.max(...expected.map((candle) => candle.high)));
    assert.equal(hour.low, Math.min(...expected.map((candle) => candle.low)));
    assert.equal(hour.close, expected.at(-1)!.close);
    assert.equal(hour.volume, expected.reduce((sum, candle) => sum + candle.volume, 0));
  }
});

test('1x, 5x and 20x advance candle time with simulated time', () => {
  for (const speed of [1, 5, 20] as const) {
    const engine = new MarketSimulationEngine(`G7_SPEED_${speed}`, 100_000);
    engine.setSpeed(speed);
    const before = engine.exportState();
    for (let i = 0; i < 5; i++) engine.tick(1);

    const after = engine.exportState();
    assert.equal(after.simSecondsOfDay - before.simSecondsOfDay, 325 * speed);
    const timestamp = simMarketTimestamp(after.simDay, after.simSecondsOfDay);

    const advanced = after.pricing.states.filter((state) => {
      const previous = before.pricing.states.find((candidate) => candidate.ticker === state.ticker)!;
      return state.candles1m.at(-1)!.time !== previous.candles1m.at(-1)!.time;
    });
    assert.ok(advanced.length > 0, `speed ${speed} generated at least one candle update`);
    for (const state of advanced) {
      assert.ok(state.candles1m.at(-1)!.time <= simCandleBucket(timestamp, 60));
      assert.ok(state.candles1h.at(-1)!.time <= simCandleBucket(timestamp, 3600));
      assert.ok(state.candles1D.at(-1)!.time <= simCandleBucket(timestamp, 86400));
    }
  }
});

test('pause and repeated reads do not advance or mutate candles', () => {
  const engine = new MarketSimulationEngine('G7_PAUSE', 100_000);
  engine.tick(1);
  engine.setSpeed(0);
  const before = JSON.stringify(engine.exportState().pricing.states.map((state) => candles(engine, state.ticker)));
  engine.tick(30);
  const after = JSON.stringify(engine.exportState().pricing.states.map((state) => candles(engine, state.ticker)));
  assert.equal(after, before);
});

test('actual volumeStep is added once to every timeframe', () => {
  const pricing = new PricingEngine(new SeededRNG('G7_VOLUME'), COMPANIES);
  const state = pricing.getState('HLVG')!;
  const start = simMarketTimestamp(2, 10 * 3600);
  const update = new Map([['HLVG', { price: 101, direction: 'up' as const, volumeStep: 37 }]]);
  pricing.updateCandles(start, update);
  pricing.updateCandles(start, update);

  for (const [, tf] of TIMEFRAMES) {
    const series = tf === 60 ? state.candles1m : tf === 300 ? state.candles5m
      : tf === 900 ? state.candles15m : tf === 3600 ? state.candles1h : state.candles1D;
    assert.equal(series.at(-1)!.volume, 74, `${tf}s candle counts each tick once`);
    assert.equal(series.at(-1)!.open, 101);
    assert.equal(series.at(-1)!.high, 101);
    assert.equal(series.at(-1)!.low, 101);
    assert.equal(series.at(-1)!.close, 101);
  }

  const snapshot = JSON.stringify(state);
  pricing.updateCandles(start, new Map());
  assert.equal(JSON.stringify(state), snapshot, 'no update means no volume or bar mutation');
});

test('higher timeframes reconcile with their lower-timeframe source', () => {
  const pricing = new PricingEngine(new SeededRNG('G7_ROLLUP'), COMPANIES);
  const state = pricing.getState('HLVG')!;
  const start = simMarketTimestamp(2, 10 * 3600);
  for (let minute = 0; minute < 5; minute++) {
    pricing.updateCandles(start + minute * 60, new Map([[
      'HLVG',
      { price: 100 + minute, direction: 'up' as const, volumeStep: minute + 1 },
    ]]));
  }
  const oneMinuteVolume = state.candles1m.slice(-5).reduce((sum, candle) => sum + candle.volume, 0);
  assert.equal(oneMinuteVolume, 15);
  assert.equal(state.candles5m.at(-1)!.volume, 15);
  assert.equal(state.candles15m.at(-1)!.volume, 15);
  assert.equal(state.candles1h.at(-1)!.volume, 15);
  assert.equal(state.candles1D.at(-1)!.volume, 15);
});

test('minute, hourly and daily boundaries plus gaps stay ordered', () => {
  const pricing = new PricingEngine(new SeededRNG('G7_BOUNDARIES'), COMPANIES);
  const state = pricing.getState('HLVG')!;
  const updates = (price: number) => new Map([['HLVG', { price, direction: 'up' as const, volumeStep: 5 }]]);

  pricing.updateCandles(simMarketTimestamp(2, 10 * 3600), updates(100));
  pricing.updateCandles(simMarketTimestamp(2, 10 * 3600 + 180), updates(101));
  pricing.updateCandles(simMarketTimestamp(2, 11 * 3600), updates(102));
  pricing.updateCandles(simMarketTimestamp(3, 9.5 * 3600), updates(103));

  const minuteTimes = state.candles1m.map((candle) => candle.time);
  assert.ok(minuteTimes.includes(simMarketTimestamp(2, 10 * 3600 + 180)));
  assert.ok(minuteTimes.includes(simMarketTimestamp(2, 11 * 3600)));
  assert.ok(!minuteTimes.includes(simMarketTimestamp(2, 10 * 3600 + 60)), 'empty minute buckets are gaps');
  const hourTimes = state.candles1h.map((candle) => candle.time);
  assert.ok(hourTimes.includes(simMarketTimestamp(2, 10 * 3600)));
  assert.ok(hourTimes.includes(simMarketTimestamp(2, 11 * 3600)));
  assert.equal(state.candles1h.at(-1)!.time, simMarketTimestamp(3, 9 * 3600));
  assert.equal(state.candles1D.slice(-2)[0].time, simMarketTimestamp(2, 9.5 * 3600));
  assert.equal(state.candles1D.at(-1)!.time, simMarketTimestamp(3, 9.5 * 3600));

  for (const series of [state.candles1m, state.candles5m, state.candles15m, state.candles1h, state.candles1D]) {
    assertAscendingUnique(series.map((candle) => candle.time));
  }
});

test('an update spanning several minute buckets starts at that update, not the last bar', () => {
  const pricing = new PricingEngine(new SeededRNG('G7_MULTI_INTERVAL'), COMPANIES);
  const state = pricing.getState('HLVG')!;
  const update = (price: number, volumeStep: number) =>
    new Map([['HLVG', { price, direction: 'up' as const, volumeStep }]]);

  pricing.updateCandles(simMarketTimestamp(2, 10 * 3600), update(100, 5));
  pricing.updateCandles(simMarketTimestamp(2, 10 * 3600 + 420), update(110, 7));

  const first = state.candles1m.find((candle) => candle.time === simMarketTimestamp(2, 10 * 3600))!;
  const second = state.candles1m.find((candle) => candle.time === simMarketTimestamp(2, 10 * 3600 + 420))!;
  assert.equal(first.volume, 5);
  assert.deepEqual(
    { open: second.open, high: second.high, low: second.low, close: second.close, volume: second.volume },
    { open: 110, high: 110, low: 110, close: 110, volume: 7 },
    'the later bar opens at its own update price',
  );
  assert.ok(!state.candles1m.some((candle) => candle.time === simMarketTimestamp(2, 10 * 3600 + 60)));
  assert.equal(state.candles1h.at(-1)!.volume, 12);
  assert.equal(state.candles1D.at(-1)!.volume, 12);
});

test('consecutive simulated days keep every series strictly increasing', () => {
  const engine = new MarketSimulationEngine('G7_DAYS', 100_000);
  for (let i = 0; i < 4; i++) engine.tick(1);
  const firstDay = engine.exportState();
  engine.skipToNextDay();
  for (let i = 0; i < 4; i++) engine.tick(1);

  for (const state of engine.exportState().pricing.states) {
    for (const series of [
      state.candles1m, state.candles5m, state.candles15m, state.candles1h, state.candles1D,
    ]) assertAscendingUnique(series.map((candle) => candle.time));
  }
  const before = firstDay.pricing.states;
  const current = engine.exportState();
  const expectedDay = simCandleBucket(
    simMarketTimestamp(current.simDay, current.simSecondsOfDay),
    86400,
  );
  const advanced = current.pricing.states.filter((state) => {
    const previous = before.find((entry) => entry.ticker === state.ticker)!;
    return state.candles1D.at(-1)!.time > previous.candles1D.at(-1)!.time;
  });
  assert.ok(advanced.length > 0, 'at least one symbol printed a day-2 daily bar');
  for (const state of advanced) {
    assert.equal(state.candles1D.at(-1)!.time, expectedDay);
  }
});

test('save and reload mid-candle preserves simulated bars and marker', () => {
  const engine = new MarketSimulationEngine('G7_RELOAD', 100_000);
  for (let i = 0; i < 3; i++) engine.tick(1);
  const state = engine.exportState();
  assert.equal(state.pricing.candleTimeMode, 'sim');

  const restored = new MarketSimulationEngine('G7_RELOAD', 100_000);
  restored.importState(state);
  restored.tick(1);
  const reloaded = restored.exportState();
  const source = reloaded.pricing.states.find((entry) => entry.ticker === 'HLVG')!;
  for (const series of [source.candles1m, source.candles5m, source.candles15m, source.candles1h, source.candles1D]) {
    assertAscendingUnique(series.map((candle) => candle.time));
  }
  assert.ok(source.candles1m.at(-1)!.volume > 0);
});

test('legacy wall-clock candles are discarded without touching player state', () => {
  const engine = new MarketSimulationEngine('G7_LEGACY', 100_000);
  const state = engine.exportState();
  delete state.pricing.candleTimeMode;
  state.simDay = 4;
  state.simSecondsOfDay = 10 * 3600;
  const legacyState = state.pricing.states[0];
  const legacyBar = { time: 1_700_000_000, open: 1, high: 1, low: 1, close: 1, volume: 123 };
  legacyState.candles1m = [{ ...legacyBar }];
  legacyState.candles5m = [{ ...legacyBar }];
  legacyState.candles15m = [{ ...legacyBar }];
  legacyState.candles1h = [{ ...legacyBar }];
  legacyState.candles1D = [{ ...legacyBar }];
  const cash = state.portfolio.cash;

  const restored = new MarketSimulationEngine('G7_LEGACY', 100_000);
  restored.importState(state);
  const current = restored.exportState().pricing.states[0];
  const expectedTime = (timeframeSec: number) =>
    simCandleBucket(simMarketTimestamp(4, 10 * 3600), timeframeSec);
  const series = [
    [current.candles1m, 60],
    [current.candles5m, 300],
    [current.candles15m, 900],
    [current.candles1h, 3600],
    [current.candles1D, 86400],
  ] as const;
  for (const [candles, timeframeSec] of series) {
    assert.equal(candles.length, 1);
    assert.equal(candles[0].time, expectedTime(timeframeSec));
    assert.equal(candles[0].volume, 0);
    assert.equal(candles[0].open, current.price);
  }
  assert.equal(restored.exportState().portfolio.cash, cash);
});

test('equivalent state replays deterministically', () => {
  const left = new MarketSimulationEngine('G7_REPLAY', 100_000);
  const right = new MarketSimulationEngine('G7_REPLAY', 100_000);
  for (let i = 0; i < 4; i++) {
    left.tick(1);
    right.tick(1);
  }
  assert.deepEqual(
    left.exportState().pricing.states.map((state) => candles(left, state.ticker)),
    right.exportState().pricing.states.map((state) => candles(right, state.ticker)),
  );
});

test('all chart timeframes are ascending and use supported timestamps', () => {
  const engine = new MarketSimulationEngine('G7_TIMEFRAMES', 100_000);
  for (let i = 0; i < 6; i++) engine.tick(1);
  for (const state of engine.exportState().pricing.states) {
    for (const [tf] of TIMEFRAMES) {
      const series = engine.getCandles(state.ticker, tf);
      assert.ok(series.length > 0);
      assertAscendingUnique(series.map((candle) => candle.time));
      assert.ok(series.every((candle) => Number.isSafeInteger(candle.time)));
    }
  }
  assert.ok(COMPANY_MAP.has('HLVG'));
});
