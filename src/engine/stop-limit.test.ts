import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MarketSimulationEngine, MarketEngineState } from './market.ts';
import { Order, OrderMatchingEngine } from './matching.ts';
import { OrderBookDepth, OrderBookEngine } from './orderbook.ts';
import { SeededRNG } from './rng.ts';

const matching = new OrderMatchingEngine(new OrderBookEngine(new SeededRNG(7)));

function depth(bestBid: number, bestAsk: number): OrderBookDepth {
  return {
    ticker: 'HLVG',
    midPrice: (bestBid + bestAsk) / 2,
    bestBid,
    bestAsk,
    spread: bestAsk - bestBid,
    spreadBps: 0,
    bids: [{ price: bestBid, size: 1000, total: 1000 }],
    asks: [{ price: bestAsk, size: 1000, total: 1000 }],
    lastUpdate: 0,
  };
}

function stopLimit(overrides: Partial<Order> = {}): Order {
  return {
    id: 'g8_order', ticker: 'HLVG', side: 'buy', type: 'stop_limit',
    quantity: 1, filledQuantity: 0, stopPrice: 105, limitPrice: 106,
    timeInForce: 'GTC', status: 'pending', createdAt: 1, commissionPaid: 0,
    ...overrides,
  };
}

function openOrder(engine: MarketSimulationEngine, id?: string) {
  const orders = engine.exportState().openOrders;
  return id ? orders.find((order) => order.id === id) : orders[0];
}

test('audit reproduction: a buy stop-limit latches at $107 and fills later at $105', () => {
  const order = stopLimit();
  assert.equal(matching.evaluatePendingOrder(order, depth(106, 107), 107), null);
  assert.equal(order.stopTriggered, true);

  const fill = matching.evaluatePendingOrder(order, depth(104, 105), 104);
  assert.equal(fill?.shouldFill, true);
  assert.equal(fill?.fillPrice, 105);
  assert.equal(order.stopTriggered, true);
});

test('a sell stop-limit latches when the stop crosses and fills as a limit later', () => {
  const order = stopLimit({ side: 'sell', stopPrice: 100, limitPrice: 99 });
  assert.equal(matching.evaluatePendingOrder(order, depth(98, 99), 99), null);
  assert.equal(order.stopTriggered, true);

  const fill = matching.evaluatePendingOrder(order, depth(100, 101), 101);
  assert.equal(fill?.shouldFill, true);
  assert.equal(fill?.fillPrice, 100, 'sell limit fills at the bid only when it is at or above the limit');
});

test('the trigger never resets when price moves back across the stop', () => {
  const order = stopLimit();
  assert.equal(matching.evaluatePendingOrder(order, depth(106, 107), 107), null);
  assert.equal(order.stopTriggered, true);

  // Price is now far below the stop, but the order is a resting limit and fills.
  const fill = matching.evaluatePendingOrder(order, depth(104, 105), 50);
  assert.equal(fill?.shouldFill, true);
  assert.equal(fill?.fillPrice, 105);
});

test('a stop-limit can trigger and fill on the same tick without becoming a market order', () => {
  const order = stopLimit({ limitPrice: 110 });
  const fill = matching.evaluatePendingOrder(order, depth(106, 107), 107);
  assert.equal(fill?.shouldFill, true);
  assert.equal(fill?.fillPrice, 107);
  assert.equal(order.stopTriggered, true);

  const tooExpensive = stopLimit({ limitPrice: 106 });
  assert.equal(matching.evaluatePendingOrder(tooExpensive, depth(108, 109), 108), null);
  assert.equal(tooExpensive.stopTriggered, true);
});

test('a triggered GTC stop-limit survives export/import and fills on a later tick', () => {
  const engine = new MarketSimulationEngine('G8_GTC_SAVE', 100000);
  const placed = engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'stop_limit', quantity: 2,
    stopPrice: 1, limitPrice: 100, timeInForce: 'GTC',
  });
  assert.equal(placed.success, true);
  const before = engine.exportState();
  const powerBefore = engine.getSnapshot().riskMetrics.buyingPower;

  engine.tick(0.05);
  const triggered = engine.exportState();
  const live = triggered.openOrders.find((order) => order.id === placed.orderId);
  assert.equal(live?.stopTriggered, true);
  assert.equal(triggered.portfolio.tradeHistory.length, 0, 'activation alone never fills');
  assert.equal(triggered.portfolio.cash, before.portfolio.cash, 'activation alone never moves cash');
  assert.equal(triggered.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(engine.getSnapshot().riskMetrics.buyingPower, powerBefore,
    'the activated order keeps its limit-price reservation');
  assert.ok(triggered.actionSeq > before.actionSeq, 'the durable trigger advances the sequence');

  const priceState = triggered.pricing.states.find((state) => state.ticker === 'HLVG')!;
  priceState.price = 90;
  const restored = new MarketSimulationEngine(triggered.seed, 100000);
  restored.importState(triggered);
  assert.equal(openOrder(restored)?.stopTriggered, true);

  restored.tick(0.05);

  const after = restored.exportState();
  assert.equal(after.openOrders.length, 0);
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares, 2);
  assert.equal(after.portfolio.tradeHistory.length, 1);
  assert.ok(after.portfolio.tradeHistory[0].price <= 100);
});

test('a legacy stop-limit without trigger state is treated as untriggered, never inferred', () => {
  const engine = new MarketSimulationEngine('G8_LEGACY', 100000);
  const placed = engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'stop_limit', quantity: 2,
    stopPrice: 1, limitPrice: 100, timeInForce: 'GTC',
  });
  assert.equal(placed.success, true);

  const state = engine.exportState();
  delete state.openOrders[0].stopTriggered;
  const restored = new MarketSimulationEngine(state.seed, 100000);
  restored.importState(state);
  assert.equal(openOrder(restored)?.stopTriggered, undefined);

  restored.tick(0.05);
  assert.equal(openOrder(restored)?.stopTriggered, true, 'the current tick evaluates the stop normally');
});

test('a DAY stop-limit that only triggered expires at the day boundary', () => {
  const engine = new MarketSimulationEngine('G8_DAY', 100000);
  const placed = engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'stop_limit', quantity: 2,
    stopPrice: 1, limitPrice: 100, timeInForce: 'DAY',
  });
  assert.equal(placed.success, true);

  engine.tick(0.05);
  assert.equal(openOrder(engine, placed.orderId)?.stopTriggered, true);
  assert.equal(engine.exportState().portfolio.tradeHistory.length, 0);

  engine.skipToNextDay();
  assert.equal(engine.exportState().openOrders.length, 0);
  engine.tick(0.05);
  assert.equal(engine.exportState().portfolio.tradeHistory.length, 0);
});

test('a triggered stop-limit can be cancelled manually without a fill', () => {
  const engine = new MarketSimulationEngine('G8_CANCEL', 100000);
  const placed = engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'stop_limit', quantity: 2,
    stopPrice: 1, limitPrice: 100, timeInForce: 'GTC',
  });
  assert.equal(placed.success, true);

  engine.tick(0.05);
  assert.equal(openOrder(engine, placed.orderId)?.stopTriggered, true);
  assert.equal(engine.cancelOrder(placed.orderId!), true);
  engine.tick(0.05);

  assert.equal(engine.exportState().openOrders.length, 0);
  assert.equal(engine.exportState().portfolio.tradeHistory.length, 0);
});

test('a partially filled triggered stop-limit fills only its remaining shares', () => {
  const engine = new MarketSimulationEngine('G8_PARTIAL', 100000);
  const placed = engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'stop_limit', quantity: 10,
    stopPrice: 1, limitPrice: 1000, timeInForce: 'GTC',
  });
  assert.equal(placed.success, true);

  const state = engine.exportState();
  const pending = state.openOrders.find((order) => order.id === placed.orderId)!;
  pending.status = 'partially_filled';
  pending.filledQuantity = 4;
  pending.commissionPaid = 1.5;
  pending.stopTriggered = true;
  const restored = new MarketSimulationEngine(state.seed, 100000);
  restored.importState(state);

  restored.tick(0.05);

  const after = restored.exportState();
  assert.equal(after.portfolio.tradeHistory[0].shares, 6, 'only the unfilled remainder executes');
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares, 6);
  assert.equal(after.openOrders.length, 0);
});

test('a triggered stop-limit that cannot be funded stays latched without executing', () => {
  const engine = new MarketSimulationEngine('G8_FUNDING', 100000);
  const placed = engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'stop_limit', quantity: 10,
    stopPrice: 1, limitPrice: 200, timeInForce: 'GTC',
  });
  assert.equal(placed.success, true);

  const state = engine.exportState();
  state.portfolio.cash = '0';
  const restored = new MarketSimulationEngine(state.seed, 100000);
  restored.importState(state);
  const before = restored.exportState();

  restored.tick(0.05);

  const after = restored.exportState();
  assert.equal(after.portfolio.cash, before.portfolio.cash);
  assert.equal(after.portfolio.tradeHistory.length, 0);
  assert.equal(after.portfolio.positions.length, 0);
  assert.equal(after.openOrders.length, 1);
  assert.equal(after.openOrders[0].stopTriggered, true);

  const funded = restored.exportState();
  funded.portfolio.cash = '100000';
  const retried = new MarketSimulationEngine(funded.seed, 100000);
  retried.importState(funded);
  retried.tick(0.05);

  assert.equal(retried.exportState().portfolio.tradeHistory[0].shares, 10);
  assert.equal(retried.exportState().openOrders.length, 0);
});

test('OCO cancellation removes a triggered stop-limit sibling before it can fill', () => {
  const engine = new MarketSimulationEngine('G8_OCO', 100000);
  const entry = engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'market', quantity: 2,
    takeProfitPrice: 1000000, stopLossPrice: 0.01,
  });
  assert.equal(entry.success, true);

  const state = engine.exportState();
  const takeProfit = state.openOrders.find((order) => order.id === `${entry.orderId}_tp`)!;
  const stopLoss = state.openOrders.find((order) => order.id === `${entry.orderId}_sl`)!;
  takeProfit.limitPrice = 0.01;
  takeProfit.createdAt = 1;
  stopLoss.type = 'stop_limit';
  stopLoss.limitPrice = 0.01;
  stopLoss.stopTriggered = true;
  stopLoss.createdAt = 2;
  const restored = new MarketSimulationEngine(state.seed, 100000);
  restored.importState(state);

  restored.tick(0.05);

  const after = restored.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.portfolio.tradeHistory.length, 2);
  assert.equal(after.portfolio.tradeHistory[0].orderId, `${entry.orderId}_tp`);
  assert.equal(after.openOrders.length, 0, 'the triggered stop-limit sibling is cancelled');

  restored.tick(0.05);
  assert.equal(restored.exportState().portfolio.tradeHistory.length, 2);
});

test('multiple stop-limits activate on the same tick and stay independently cancellable', () => {
  const engine = new MarketSimulationEngine('G8_SIMULTANEOUS', 100000);
  const first = engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'stop_limit', quantity: 2,
    stopPrice: 1, limitPrice: 100, timeInForce: 'GTC',
  });
  const second = engine.placeOrder({
    ticker: 'VCRX', side: 'buy', type: 'stop_limit', quantity: 2,
    stopPrice: 1, limitPrice: 100, timeInForce: 'GTC',
  });
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  const before = engine.exportState();

  engine.tick(0.05);

  const triggered = engine.exportState();
  assert.equal(triggered.openOrders.length, 2);
  assert.ok(triggered.openOrders.every((order) => order.stopTriggered === true));
  assert.equal(triggered.portfolio.tradeHistory.length, 0);
  assert.equal(triggered.actionSeq, before.actionSeq + 2, 'both latches advance the sequence');

  assert.equal(engine.cancelOrder(first.orderId!), true);
  assert.equal(engine.exportState().openOrders.length, 1);
  assert.equal(engine.exportState().openOrders[0].id, second.orderId);
  assert.equal(engine.exportState().openOrders[0].stopTriggered, true);
});

test('repeated evaluation is idempotent and equivalent state replays the same trigger outcome', () => {
  const idle = new MarketSimulationEngine('G8_IDEMPOTENT', 100000);
  const waiting = idle.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'stop_limit', quantity: 2,
    stopPrice: 1, limitPrice: 100, timeInForce: 'GTC',
  });
  assert.equal(waiting.success, true);
  idle.tick(0.05);
  const afterTrigger = idle.exportState();
  idle.tick(0.05);
  const afterSecondTick = idle.exportState();
  assert.equal(afterSecondTick.actionSeq, afterTrigger.actionSeq, 'a latched trigger is not re-applied');
  assert.equal(afterSecondTick.openOrders[0].stopTriggered, true);
  assert.equal(afterSecondTick.portfolio.tradeHistory.length, 0);

  const source = new MarketSimulationEngine('G8_REPLAY', 100000);
  const placed = source.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'stop_limit', quantity: 2,
    stopPrice: 1, limitPrice: 1000, timeInForce: 'GTC',
  });
  assert.equal(placed.success, true);
  const state = source.exportState();

  const normalize = (value: MarketEngineState) => ({
    cash: value.portfolio.cash,
    positions: value.portfolio.positions.map((position) => [position.ticker, position.shares]),
    trades: value.portfolio.tradeHistory.map((trade) => [trade.orderId, trade.side, trade.shares, trade.price, trade.commission]),
    orders: value.openOrders.map((order) => [order.id, order.status, order.stopTriggered, order.quantity]),
    actionSeq: value.actionSeq,
  });

  const run = () => {
    const engine = new MarketSimulationEngine(state.seed, 100000);
    engine.importState(state);
    engine.tick(0.05);
    return normalize(engine.exportState());
  };

  const first = run();
  const second = run();
  assert.deepEqual(first, second);
  assert.equal(first.trades.length, 1);
  assert.equal(first.orders.length, 0);
});
