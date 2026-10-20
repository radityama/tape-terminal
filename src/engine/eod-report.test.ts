import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MarketSimulationEngine } from './market.ts';
import { COMPANY_MAP } from '../data/companies.ts';
import { Money } from '../lib/money.ts';
import type { TradeRecord } from './matching.ts';

function trade(id: string, overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id,
    orderId: `order_${id}`,
    ticker: 'HLVG',
    side: 'sell',
    shares: 1,
    price: 100,
    totalValue: 100,
    commission: 1,
    slippageDollars: 0,
    timestamp: 0,
    isClosingTrade: true,
    realizedPnl: 0,
    ...overrides,
  };
}

function withTrades(
  engine: MarketSimulationEngine,
  history: TradeRecord[],
  dayStartTradeCount?: number,
) {
  const state = engine.exportState();
  state.portfolio.tradeHistory = history;
  if (dayStartTradeCount === undefined) delete state.dayStartTradeCount;
  else state.dayStartTradeCount = dayStartTradeCount;
  engine.importState(state);
}

test('settlement uses the actual opening balance and reports post-financing equity', () => {
  const engine = new MarketSimulationEngine('G6_CAPITAL', 10_000);
  engine.skipToNextDay();

  const report = engine.getCurrentEodModal()!;
  assert.equal(report.startingEquity, 10_000);
  assert.equal(report.endingEquity, 10_000);
  assert.equal(report.netPnl, 0);
  assert.equal(report.returnPct, 0);
  assert.deepEqual(report.sectorAttribution, [], 'sector attribution is not fabricated');
  assert.equal(engine.exportState().portfolio.dayStartEquity, '10000');
});

test('a real market round trip reports the closing fill net of its commission', () => {
  const engine = new MarketSimulationEngine('G6_REAL_FILL', 100_000);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 2 }).success, true);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'market', quantity: 2 }).success, true);

  const closing = engine.exportState().portfolio.tradeHistory.find((entry) => entry.isClosingTrade)!;
  engine.skipToNextDay();
  const report = engine.getCurrentEodModal()!;

  assert.equal(report.bestTrade?.id, closing.id);
  assert.equal(report.worstTrade?.id, closing.id, 'a single close is both best and worst');
  assert.equal(
    Money.from(closing.realizedPnl!).sub(closing.commission).toNumber(),
    Money.from(report.bestTrade!.realizedPnl!).sub(report.bestTrade!.commission).toNumber(),
  );
  assert.equal(report.netPnl, Money.from(report.endingEquity).sub(report.startingEquity).toNumber());
  assert.ok(report.returnPct !== null && report.returnPct < 0, 'a losing session has a negative unrounded return');
  assert.equal(engine.exportState().portfolio.cash, engine.exportState().portfolio.dayStartEquity);
});

test('margin interest is applied once before the report and the next opening baseline', () => {
  const engine = new MarketSimulationEngine('G6_MARGIN_FEE', 10_000);
  const state = engine.exportState();
  state.portfolio.cash = '-10000';
  state.portfolio.dayStartEquity = '10000';
  engine.importState(state);
  engine.skipToNextDay();

  const report = engine.getCurrentEodModal()!;
  const interest = 10_000 * (0.08 / 360);
  const ending = Math.round((-10_000 - interest) * 100) / 100;

  assert.equal(report.startingEquity, 10_000);
  assert.equal(report.endingEquity, ending);
  assert.equal(report.netPnl, Math.round((ending - 10_000) * 100) / 100);
  assert.ok(report.returnPct !== null && report.returnPct < -199);
  assert.equal(engine.exportState().portfolio.dayStartEquity, String(ending));
});

test('short borrow fees are charged before settlement and carried into the next day', () => {
  const engine = new MarketSimulationEngine('G6_SHORT_FEE', 100_000);
  const state = engine.exportState();
  state.portfolio.cash = '110000';
  state.portfolio.dayStartEquity = '100000';
  state.portfolio.positions = [{
    ticker: 'HLVG', shares: -100, averageEntryPrice: 100, currentPrice: 100,
    marketValue: 10_000, costBasis: 10_000, unrealizedPnl: 0, unrealizedPnlPercent: 0,
    entryTimestamp: 1, borrowFeeAccumulated: 0,
  }];
  engine.importState(state);
  engine.skipToNextDay();

  const report = engine.getCurrentEodModal()!;
  const fee = 10_000 * COMPANY_MAP.get('HLVG')!.borrowCostRate / 360;
  const ending = Math.round((100_000 - fee) * 100) / 100;

  assert.equal(report.endingEquity, ending);
  assert.equal(report.netPnl, Math.round((ending - 100_000) * 100) / 100);
  assert.equal(engine.exportState().portfolio.dayStartEquity, String(ending));
});

test('the full history cursor attributes more than 50 trades and ranks net of commission', () => {
  const engine = new MarketSimulationEngine('G6_CURSOR_60', 100_000);
  const older = Array.from({ length: 60 }, (_, index) =>
    trade(`old_${index}`, { realizedPnl: 10_000 + index, commission: 1 }));
  const good = trade('today_good', { realizedPnl: 100, commission: 5 });
  const bad = trade('today_bad', { realizedPnl: -50, commission: 5 });
  withTrades(engine, [good, bad, ...older], older.length);

  engine.skipToNextDay();
  const report = engine.getCurrentEodModal()!;

  assert.equal(report.bestTrade?.id, 'today_good');
  assert.equal(report.worstTrade?.id, 'today_bad');
  assert.equal(engine.exportState().dayStartTradeCount, 62);
});

test('commission decides the best and worst closing fills, including zero results', () => {
  const engine = new MarketSimulationEngine('G6_COMMISSION_RANK', 100_000);
  const cheap = trade('cheap', { realizedPnl: 5, commission: 5 });
  const expensive = trade('expensive', { realizedPnl: 5, commission: 8 });
  withTrades(engine, [expensive, cheap], 0);

  engine.skipToNextDay();
  const report = engine.getCurrentEodModal()!;

  assert.equal(report.bestTrade?.id, 'cheap');
  assert.equal(report.worstTrade?.id, 'expensive');
  assert.equal(Money.from(report.bestTrade!.realizedPnl!).sub(report.bestTrade!.commission).toNumber(), 0);
});

test('loss-only, no-close and single-close days are represented honestly', () => {
  const lossEngine = new MarketSimulationEngine('G6_LOSS_ONLY', 100_000);
  withTrades(lossEngine, [
    trade('big_loss', { realizedPnl: -100, commission: 1 }),
    trade('small_loss', { realizedPnl: -10, commission: 1 }),
  ], 0);
  lossEngine.skipToNextDay();
  const lossReport = lossEngine.getCurrentEodModal()!;
  assert.equal(lossReport.bestTrade?.id, 'small_loss');
  assert.ok(lossReport.bestTrade!.realizedPnl! < 0, 'best trade may be a loss');
  assert.equal(lossReport.worstTrade?.id, 'big_loss');

  const noCloseEngine = new MarketSimulationEngine('G6_NO_CLOSE', 100_000);
  withTrades(noCloseEngine, [trade('open_only', { isClosingTrade: false, realizedPnl: undefined })], 0);
  noCloseEngine.skipToNextDay();
  const noCloseReport = noCloseEngine.getCurrentEodModal()!;
  assert.equal(noCloseReport.bestTrade, undefined);
  assert.equal(noCloseReport.worstTrade, undefined);

  const singleEngine = new MarketSimulationEngine('G6_SINGLE_CLOSE', 100_000);
  withTrades(singleEngine, [trade('only', { realizedPnl: 0, commission: 0 })], 0);
  singleEngine.skipToNextDay();
  const singleReport = singleEngine.getCurrentEodModal()!;
  assert.equal(singleReport.bestTrade?.id, 'only');
  assert.equal(singleReport.worstTrade?.id, 'only');
});

test('a legacy save starts attribution from its current full history length', () => {
  const engine = new MarketSimulationEngine('G6_LEGACY_CURSOR', 100_000);
  withTrades(engine, [trade('prior_day', { realizedPnl: 500 })], undefined);

  assert.equal(engine.exportState().dayStartTradeCount, 1);
  engine.skipToNextDay();
  const report = engine.getCurrentEodModal()!;
  assert.equal(report.bestTrade, undefined, 'pre-load history is never guessed into today');
});

test('the cursor survives a serialized reload and is independent of wall-clock timestamps and speed', () => {
  const source = new MarketSimulationEngine('G6_RELOAD', 100_000);
  withTrades(source, [trade('just_closed', { realizedPnl: 25, commission: 1 })], 0);

  const restored = new MarketSimulationEngine(source.seed);
  restored.importState(JSON.parse(JSON.stringify(source.exportState())));
  restored.skipToNextDay();
  assert.equal(restored.getCurrentEodModal()!.bestTrade?.id, 'just_closed');

  for (const speed of [1, 5, 20] as const) {
    const engine = new MarketSimulationEngine(`G6_SPEED_${speed}`, 100_000);
    withTrades(engine, [trade('old_clock', { realizedPnl: 10, timestamp: 0 })], 0);
    engine.setSpeed(speed);
    engine.skipToNextDay();
    assert.equal(engine.getCurrentEodModal()!.bestTrade?.id, 'old_clock');
  }
});

test('zero and negative opening equity report an unavailable return, not NaN', () => {
  for (const opening of [0, -1_000]) {
    const engine = new MarketSimulationEngine(`G6_OPEN_${opening}`, 10_000);
    const state = engine.exportState();
    state.portfolio.cash = String(opening);
    state.portfolio.dayStartEquity = String(opening);
    engine.importState(state);
    engine.skipToNextDay();

    const report = engine.getCurrentEodModal()!;
    assert.equal(report.startingEquity, opening);
    assert.equal(report.returnPct, null);
    assert.equal(report.netPnl, Money.from(report.endingEquity).sub(opening).toNumber());
    assert.ok(opening === 0 ? report.netPnl === 0 : report.netPnl < 0);
  }
});

test('accelerated ticks at 1x, 5x and 20x settle each simulated day once', () => {
  for (const speed of [1, 5, 20] as const) {
    const engine = new MarketSimulationEngine(`G6_TICK_${speed}`, 10_000);
    engine.setSpeed(speed);
    const realSecondsToClose = 400 / speed;

    for (let day = 1; day <= 3; day += 1) {
      engine.tick(realSecondsToClose);
      const report = engine.getCurrentEodModal()!;
      assert.equal(report.day, day);
      assert.equal(report.startingEquity, 10_000);
      assert.equal(report.endingEquity, 10_000);
      assert.equal(report.returnPct, 0);
      assert.equal(engine.exportState().simDay, day + 1);
    }
  }
});

test('consecutive settlements attribute each day once, including split partial exits', () => {
  const engine = new MarketSimulationEngine('G6_CONSECUTIVE', 100_000);
  withTrades(engine, [trade('day1_partial', { orderId: 'split_exit', shares: 40, realizedPnl: 40 })], 0);
  engine.skipToNextDay();
  const dayOne = engine.getCurrentEodModal()!;

  const state = engine.exportState();
  state.portfolio.tradeHistory.unshift(
    trade('day2_partial', { orderId: 'split_exit', shares: 60, realizedPnl: -60 }));
  engine.importState(state);
  engine.skipToNextDay();
  const dayTwo = engine.getCurrentEodModal()!;

  assert.equal(dayOne.bestTrade?.id, 'day1_partial');
  assert.equal(dayTwo.bestTrade?.id, 'day2_partial');
  assert.notEqual(dayOne.bestTrade?.id, dayTwo.bestTrade?.id);
  assert.equal(engine.exportState().dayStartTradeCount, 2);
});
