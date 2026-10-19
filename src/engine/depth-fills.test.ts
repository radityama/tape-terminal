import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MarketSimulationEngine } from './market.ts';
import { walkDepth, OrderBookDepth, OrderBookEngine } from './orderbook.ts';
import { OrderMatchingEngine } from './matching.ts';
import { PortfolioEngine } from './portfolio.ts';
import { SeededRNG } from './rng.ts';

test('G9 reproduction: a limit cannot fill more shares than the eligible visible asks', () => {
  const engine = new MarketSimulationEngine('G9_RED', 1_000_000_000);
  const depth = engine.getDepth('HLVG')!;
  const quantity = depth.asks.reduce((sum, level) => sum + level.size, 0) + 100_000;
  const order = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity,
    limitPrice: 1000, timeInForce: 'GTC' });
  assert.equal(order.success, true);
  engine.tick(0.05);
  const trade = engine.exportState().portfolio.tradeHistory[0];
  const live = engine.exportState().openOrders.find((item) => item.id === order.orderId);
  assert.ok(trade.shares < quantity);
  assert.equal(live?.status, 'partially_filled');
});

test('the pure preview walks eligible levels, stops at visible depth, and does not mutate them', () => {
  const depth: OrderBookDepth = {
    ticker: 'HLVG', midPrice: 10, bestBid: 9, bestAsk: 10, spread: 1, spreadBps: 100,
    bids: [{ price: 9, size: 2, total: 2 }],
    asks: [{ price: 10, size: 2, total: 2 }, { price: 11, size: 3, total: 5 }, { price: 12, size: 4, total: 9 }],
    lastUpdate: 0,
  };
  const before = structuredClone(depth);
  const preview = walkDepth('buy', 100, depth, 11);
  assert.deepEqual([preview.filledQuantity, preview.averagePrice, preview.totalCost, preview.levelsWalked], [5, 10.6, 53, 2]);
  assert.equal(walkDepth('buy', 100, depth, 9).filledQuantity, 0);
  assert.deepEqual(depth, before);
  const matching = new OrderMatchingEngine(new OrderBookEngine(new SeededRNG(7)));
  const fill = matching.evaluatePendingOrder({ id: 'limit', ticker: 'HLVG', side: 'buy', type: 'limit',
    quantity: 100, filledQuantity: 0, limitPrice: 11, timeInForce: 'GTC', status: 'pending', createdAt: 1,
    commissionPaid: 0 }, depth, 10);
  assert.deepEqual([fill?.filledQuantity, fill?.fillPrice, fill?.totalCost], [5, 10.6, 53]);
});

test('market orders compete for one book and cannot refresh liquidity by placing another order', () => {
  const engine = new MarketSimulationEngine('G9_COMPETE', 10_000_000);
  const total = engine.getDepth('HLVG')!.asks.reduce((sum, level) => sum + level.size, 0);
  const first = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: total - 2, timeInForce: 'GTC' });
  const second = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 10, timeInForce: 'GTC' });
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  const state = engine.exportState();
  assert.deepEqual(state.portfolio.tradeHistory.map((trade) => trade.shares), [2, total - 2]);
  assert.equal(state.openOrders.find((order) => order.id === second.orderId)?.filledQuantity, 2);
  assert.equal(engine.getDepth('HLVG')!.asks.reduce((sum, level) => sum + level.size, 0), 0);
  engine.tick(0.05);
  assert.equal(engine.exportState().openOrders.some((order) => order.id === second.orderId), false);
  assert.equal(engine.exportState().portfolio.tradeHistory.filter((trade) => trade.orderId === second.orderId)
    .reduce((sum, trade) => sum + trade.shares, 0), 10);
});

test('a market buy is admitted when only the first ask and its commission are affordable', () => {
  const source = new MarketSimulationEngine('G9_FIRST_ASK', 100_000);
  const book = source.getDepth('HLVG')!;
  const quantity = book.asks.reduce((sum, level) => sum + level.size, 0);
  const firstAsk = book.asks[0].price;
  assert.ok(walkDepth('buy', quantity, book).averagePrice > firstAsk);
  const saved = source.exportState();
  saved.portfolio.cash = String(firstAsk + 1.5 + 0.01);
  const engine = new MarketSimulationEngine(saved.seed);
  engine.importState(saved);
  const placed = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity, timeInForce: 'GTC' });
  assert.equal(placed.success, true);
  assert.equal(engine.exportState().portfolio.tradeHistory[0].shares, 1);
});

test('the public depth quote and spread track committed level consumption', () => {
  const engine = new MarketSimulationEngine('G9_BOOK_QUOTE', 10_000_000);
  const firstAsk = engine.getDepth('HLVG')!.asks[0];
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: firstAsk.size }).success, true);
  const book = engine.getDepth('HLVG')!;
  assert.equal(book.asks[0].size, 0);
  assert.equal(book.bestAsk, book.asks[1].price);
  assert.equal(book.midPrice, Math.round((book.bestAsk + book.bestBid) / 2 * 100) / 100);
  assert.equal(book.spread, Math.round((book.bestAsk - book.bestBid) * 100) / 100);
  assert.equal(book.spreadBps, Math.round(book.spread / book.midPrice * 100000) / 10);
});

test('a live order accumulates its executed-share VWAP and fees over multiple ticks', () => {
  const engine = new MarketSimulationEngine('G9_VWAP', 1_000_000_000);
  const capacity = engine.getDepth('HLVG')!.asks.reduce((sum, level) => sum + level.size, 0);
  const placed = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: capacity * 4,
    timeInForce: 'GTC' });
  assert.equal(placed.success, true);
  engine.tick(0.05);
  const state = engine.exportState();
  const order = state.openOrders.find((row) => row.id === placed.orderId)!;
  const fills = state.portfolio.tradeHistory.filter((trade) => trade.orderId === placed.orderId);
  assert.equal(fills.length, 2);
  assert.equal(order.filledQuantity, fills.reduce((sum, trade) => sum + trade.shares, 0));
  assert.equal(order.averageFillPrice, Math.round(fills.reduce((value, trade) => value + trade.shares * trade.price, 0)
    / order.filledQuantity * 100) / 100);
  assert.equal(order.commissionPaid, Math.round(fills.reduce((sum, trade) => sum + trade.commission, 0) * 100) / 100);
});

test('a legacy partial without prior VWAP does not average past shares against zero', () => {
  const source = new MarketSimulationEngine('G9_LEGACY_VWAP', 1_000_000_000);
  const capacity = source.getDepth('HLVG')!.asks.reduce((sum, level) => sum + level.size, 0);
  const placed = source.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: capacity * 4,
    limitPrice: 1000, timeInForce: 'GTC' });
  assert.equal(placed.success, true);
  const state = source.exportState();
  const order = state.openOrders.find((item) => item.id === placed.orderId)!;
  order.status = 'partially_filled';
  order.filledQuantity = 2;
  const engine = new MarketSimulationEngine(state.seed);
  engine.importState(state);
  engine.tick(0.05);
  const after = engine.exportState();
  assert.equal(after.openOrders.find((item) => item.id === placed.orderId)?.averageFillPrice,
    after.portfolio.tradeHistory[0].price);
});

test('public depth snapshots cannot replenish consumed liquidity', () => {
  const engine = new MarketSimulationEngine('G9_SNAPSHOT', 100_000);
  const copy = engine.getDepth('HLVG')!;
  copy.asks[0].size = 1_000_000;
  assert.notEqual(engine.getDepth('HLVG')!.asks[0].size, copy.asks[0].size);
});

test('sell limits respect eligible bids and short covers respect visible asks', () => {
  const engine = new MarketSimulationEngine('G9_SELL_COVER', 100_000_000);
  const state = engine.exportState();
  state.portfolio.shortingUnlocked = true;
  state.portfolio.marginUnlocked = true;
  engine.importState(state);
  const bids = engine.getDepth('HLVG')!.bids.reduce((sum, level) => sum + level.size, 0);
  const short = engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'limit', quantity: bids * 2,
    limitPrice: 0.01, timeInForce: 'GTC' });
  assert.equal(short.success, true);
  engine.tick(0.05);
  const partial = engine.exportState();
  const opened = partial.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares ?? 0;
  assert.ok(opened < 0 && opened > -bids * 2);
  assert.equal(partial.openOrders.find((order) => order.id === short.orderId)?.filledQuantity, -opened);
  const asks = engine.getDepth('HLVG')!.asks.reduce((sum, level) => sum + level.size, 0);
  const cover = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: -opened,
    timeInForce: 'GTC' });
  assert.equal(cover.success, true);
  const after = engine.exportState();
  assert.equal(after.portfolio.tradeHistory[0].shares, Math.min(-opened, asks));
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares ?? 0,
    opened + Math.min(-opened, asks));
  assert.equal(after.openOrders.find((order) => order.id === cover.orderId)?.filledQuantity ?? -opened,
    after.portfolio.tradeHistory[0].shares);
});

test('an affordable prefix fills with per-execution commission and cumulative order VWAP', () => {
  const source = new MarketSimulationEngine('G9_FUNDING', 100_000);
  const quote = source.getDepth('HLVG')!.asks[0].price;
  const placed = source.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 10,
    limitPrice: 1000, timeInForce: 'GTC' });
  assert.equal(placed.success, true);
  const saved = source.exportState();
  saved.portfolio.cash = String(quote * 3 + 1.5 + 0.1);
  const engine = new MarketSimulationEngine(saved.seed);
  engine.importState(saved);
  engine.tick(0.05);
  const partial = engine.exportState();
  const order = partial.openOrders.find((item) => item.id === placed.orderId)!;
  const trade = partial.portfolio.tradeHistory[0];
  assert.equal(trade.shares, 3);
  assert.equal(trade.commission, 1.5);
  assert.equal(order.filledQuantity, 3);
  assert.equal(order.commissionPaid, 1.5);
  assert.equal(order.averageFillPrice, trade.price);
  assert.equal(Number(partial.portfolio.cash) >= 0, true);
  partial.portfolio.cash = '100000';
  const resumed = new MarketSimulationEngine(saved.seed);
  resumed.importState(partial);
  resumed.tick(0.05);
  const finished = resumed.exportState();
  const next = finished.portfolio.tradeHistory[0];
  assert.equal(next.shares, 7);
  assert.equal(finished.openOrders.some((item) => item.id === placed.orderId), false);
  assert.equal(finished.portfolio.tradeHistory.filter((item) => item.orderId === placed.orderId)
    .reduce((fee, item) => fee + item.commission, 0), 3);
});

test('DAY expires a partially filled remainder while GTC continues, with no extra fee for expiry', () => {
  for (const timeInForce of ['DAY', 'GTC'] as const) {
    const engine = new MarketSimulationEngine(`G9_${timeInForce}`, 10_000_000);
    const qty = engine.getDepth('HLVG')!.asks.reduce((sum, level) => sum + level.size, 0) + 10;
    const placed = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: qty, timeInForce });
    assert.equal(placed.success, true);
    const before = engine.exportState();
    assert.equal(before.openOrders[0].status, 'partially_filled');
    const fees = before.portfolio.tradeHistory[0].commission;
    engine.skipToNextDay();
    assert.equal(engine.exportState().openOrders.length, timeInForce === 'DAY' ? 0 : 1);
    assert.equal(engine.exportState().portfolio.tradeHistory[0].commission, fees);
    if (timeInForce === 'GTC') {
      engine.tick(0.05);
      assert.equal(engine.exportState().openOrders.length, 0);
      assert.equal(engine.exportState().portfolio.tradeHistory.filter((item) => item.orderId === placed.orderId)
        .reduce((sum, item) => sum + item.shares, 0), qty);
    }
  }
});

test('a market buy can enter with funds for one share and cannot spend beyond them', () => {
  const engine = new MarketSimulationEngine('G9_MARKET_FUNDING', 500);
  const order = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 100, timeInForce: 'GTC' });
  assert.equal(order.success, true);
  const state = engine.exportState();
  assert.ok(state.portfolio.tradeHistory[0].shares > 0);
  assert.ok(state.portfolio.tradeHistory[0].shares < 100);
  assert.equal(state.portfolio.tradeHistory[0].shares, state.openOrders[0].filledQuantity);
  assert.ok(Number(state.portfolio.cash) >= 0);
});

test('failed funding consumes no depth, while locked oversize sells close only owned shares', () => {
  const source = new MarketSimulationEngine('G9_REJECT', 100_000);
  const pending = source.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 10,
    limitPrice: 1000, timeInForce: 'GTC' });
  assert.equal(pending.success, true);
  const state = source.exportState();
  state.portfolio.cash = '0';
  const engine = new MarketSimulationEngine(state.seed);
  engine.importState(state);
  engine.tick(0.05);
  const after = engine.exportState();
  assert.equal(after.portfolio.tradeHistory.length, 0);
  assert.equal(after.openOrders[0].filledQuantity, 0);
  assert.equal(engine.getDepth('HLVG')!.asks.reduce((sum, level) => sum + level.size, 0) > 0, true);

  const locked = new MarketSimulationEngine('G9_LOCKED_SELL', 100_000);
  assert.equal(locked.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 2 }).success, true);
  const bids = locked.getDepth('HLVG')!.bids.reduce((sum, level) => sum + level.size, 0);
  const sell = locked.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'market', quantity: 3 });
  assert.equal(locked.exportState().portfolio.positions.length, 0);
  assert.equal(locked.exportState().portfolio.tradeHistory.filter((trade) => trade.side === 'sell')[0].shares, 2);
  assert.equal(locked.exportState().openOrders.find((order) => order.id === sell.orderId)?.filledQuantity, 2);
  assert.equal(locked.getDepth('HLVG')!.bids.reduce((sum, level) => sum + level.size, 0), bids - 2);
  assert.equal(sell.success, true);
});

test('cancelling one exit of a partially filled parent cannot recreate it after reload', () => {
  const engine = new MarketSimulationEngine('G9_CANCEL_CHILD', 100_000_000);
  const visible = engine.getDepth('HLVG')!.asks.reduce((sum, level) => sum + level.size, 0);
  const parent = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: visible + 5,
    timeInForce: 'GTC', takeProfitPrice: 1000000, stopLossPrice: 0.01 });
  assert.equal(parent.success, true);
  assert.equal(engine.cancelOrder(`${parent.orderId}_tp`), true);
  const saved = engine.exportState();
  assert.equal(saved.openOrders.find((order) => order.id === parent.orderId)?.takeProfitPrice, undefined);
  const restored = new MarketSimulationEngine(saved.seed);
  restored.importState(saved);
  restored.tick(0.05);
  const after = restored.exportState();
  assert.equal(after.openOrders.some((order) => order.id === `${parent.orderId}_tp`), false);
  assert.equal(after.openOrders.find((order) => order.id === `${parent.orderId}_sl`)?.quantity, visible + 5);
});

test('stop metadata is validated independently of the partial fill quantity', () => {
  const portfolio = new PortfolioEngine(1000);
  const fill = { orderId: 'legacy_stop', ticker: 'HLVG', side: 'buy' as const,
    shares: 100, price: 1, commission: 1.5, slippageDollars: 0, timestamp: 1, initialStopPrice: 1e12 };
  assert.equal(portfolio.checkFill(fill), null);
  assert.equal(portfolio.executeFill(fill).success, true);
  assert.equal(portfolio.getPosition('HLVG')?.initialStopPrice, 1e12);
});

test('each partial parent fill adds only new exposure to its linked exits', () => {
  const engine = new MarketSimulationEngine('G9_PARENT', 100_000_000);
  const visible = engine.getDepth('HLVG')!.asks.reduce((sum, level) => sum + level.size, 0);
  const entry = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: visible + 5,
    timeInForce: 'GTC', takeProfitPrice: 1000000, stopLossPrice: 0.01 });
  assert.equal(entry.success, true);
  const partial = engine.exportState();
  assert.equal(partial.openOrders.find((order) => order.id === entry.orderId)?.filledQuantity, visible);
  assert.deepEqual(partial.openOrders.filter((order) => order.isBracketChild).map((order) => order.quantity), [visible, visible]);
  engine.tick(0.05);
  const after = engine.exportState();
  assert.equal(after.openOrders.some((order) => order.id === entry.orderId), false);
  assert.deepEqual(after.openOrders.filter((order) => order.isBracketChild).map((order) => order.quantity), [visible + 5, visible + 5]);
});

test('a depth-limited exit keeps its sibling live for the remaining protected shares', () => {
  const engine = new MarketSimulationEngine('G9_EXIT', 100_000_000);
  const bids = engine.getDepth('HLVG')!.bids.reduce((sum, level) => sum + level.size, 0);
  const entry = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: bids * 3,
    timeInForce: 'GTC', takeProfitPrice: 1000000, stopLossPrice: 0.01 });
  assert.equal(entry.success, true);
  for (let tick = 0; tick < 12 && engine.exportState().openOrders.some((order) => order.id === entry.orderId); tick++) engine.tick(0.05);
  const before = engine.exportState();
  assert.equal(before.openOrders.some((order) => order.id === entry.orderId), false);
  assert.ok(before.portfolio.positions.find((position) => position.ticker === 'HLVG')!.shares > bids);
  before.openOrders.find((order) => order.id === `${entry.orderId}_tp`)!.limitPrice = 0.01;
  const restored = new MarketSimulationEngine(before.seed);
  restored.importState(before);
  restored.tick(0.05);
  const after = restored.exportState();
  const remaining = after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares ?? 0;
  assert.ok(remaining > 0);
  assert.equal(after.openOrders.filter((order) => order.isBracketChild).length, 2);
  assert.ok(after.openOrders.filter((order) => order.isBracketChild)
    .every((order) => order.quantity - order.filledQuantity === remaining));
});

test('triggered stop-limits fill eligible depth over ticks and keep the trigger after reload', () => {
  const engine = new MarketSimulationEngine('G9_STOP_LIMIT', 1_000_000_000);
  const qty = engine.getDepth('HLVG')!.asks.reduce((sum, level) => sum + level.size, 0) * 2;
  const placed = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'stop_limit', quantity: qty,
    stopPrice: 0.01, limitPrice: 1000, timeInForce: 'GTC' });
  assert.equal(placed.success, true);
  engine.tick(0.05);
  const partial = engine.exportState();
  const pending = partial.openOrders.find((order) => order.id === placed.orderId)!;
  assert.equal(pending.stopTriggered, true);
  assert.equal(pending.status, 'partially_filled');
  assert.ok(pending.filledQuantity < qty);
  const restored = new MarketSimulationEngine(partial.seed);
  restored.importState(partial);
  for (let tick = 0; tick < 10 && restored.exportState().openOrders.some((order) => order.id === placed.orderId); tick++) restored.tick(0.05);
  assert.equal(restored.exportState().portfolio.tradeHistory.filter((trade) => trade.orderId === placed.orderId)
    .reduce((sum, trade) => sum + trade.shares, 0), qty);
});
