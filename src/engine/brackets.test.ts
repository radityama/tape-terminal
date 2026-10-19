import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MarketSimulationEngine, MarketEngineState } from './market.ts';
import { Order } from './matching.ts';

const ENTRY = { ticker: 'HLVG', side: 'buy' as const, type: 'market' as const, quantity: 2 };

function openExits(engine: MarketSimulationEngine) {
  return engine.exportState().openOrders.filter((order) => order.isBracketChild);
}

function unlockShorting(engine: MarketSimulationEngine) {
  const state = engine.exportState();
  state.portfolio.shortingUnlocked = true;
  state.portfolio.marginUnlocked = true;
  engine.importState(state);
}

test('take-profit fills first and cancels the linked stop-loss', () => {
  const engine = new MarketSimulationEngine('G5_TP_FIRST', 100000);
  const entry = engine.placeOrder({ ...ENTRY, takeProfitPrice: 0.01, stopLossPrice: 0.01 });
  assert.equal(entry.success, true);

  const exits = openExits(engine);
  assert.equal(exits.length, 2);
  assert.deepEqual(exits.map((order) => [order.type, order.quantity, order.parentOrderId, order.isBracketChild]),
    [['limit', 2, entry.orderId, true], ['stop', 2, entry.orderId, true]]);

  engine.tick(0.05);

  const after = engine.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.openOrders.length, 0);
  assert.equal(after.portfolio.tradeHistory.length, 2);
  assert.equal(after.portfolio.tradeHistory[0].side, 'sell');
  assert.equal(after.portfolio.tradeHistory[0].orderId, `${entry.orderId}_tp`);
  assert.equal(after.portfolio.tradeHistory[0].shares, 2);
});

test('stop-loss fills first and cancels the linked take-profit', () => {
  const engine = new MarketSimulationEngine('G5_SL_FIRST', 100000);
  const entry = engine.placeOrder({ ...ENTRY, takeProfitPrice: 1000000, stopLossPrice: 1000000 });
  assert.equal(entry.success, true);

  engine.tick(0.05);

  const after = engine.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.openOrders.length, 0);
  assert.equal(after.portfolio.tradeHistory.length, 2);
  assert.equal(after.portfolio.tradeHistory[0].side, 'sell');
  assert.equal(after.portfolio.tradeHistory[0].orderId, `${entry.orderId}_sl`);
});

test('both exits triggering in one tick execute exactly one order', () => {
  const engine = new MarketSimulationEngine('G5_SAME_TICK', 100000);
  const entry = engine.placeOrder({ ...ENTRY, takeProfitPrice: 0.01, stopLossPrice: 1000000 });
  assert.equal(entry.success, true);

  engine.tick(0.05);

  const after = engine.exportState();
  assert.equal(after.portfolio.tradeHistory.length, 2, 'entry plus exactly one exit');
  assert.equal(after.portfolio.tradeHistory[0].orderId, `${entry.orderId}_tp`, 'creation order breaks the tie');
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.openOrders.length, 0);

  // A cancelled sibling must not execute from an already-created tick iteration or later.
  engine.tick(0.05);
  assert.equal(engine.exportState().portfolio.tradeHistory.length, 2);
  assert.equal(engine.exportState().openOrders.length, 0);
});

test('a manual close cancels active bracket exits without charging their commission', () => {
  const engine = new MarketSimulationEngine('G5_MANUAL_CLOSE', 100000);
  const entry = engine.placeOrder({ ...ENTRY, takeProfitPrice: 1000000, stopLossPrice: 0.01 });
  assert.equal(entry.success, true);
  assert.equal(openExits(engine).length, 2);

  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'market', quantity: 2 }).success, true);

  const after = engine.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.openOrders.length, 0);
  assert.equal(after.portfolio.tradeHistory.length, 2, 'manual close only');
  const cashAfterManualClose = after.portfolio.cash;

  engine.tick(0.05);
  assert.equal(engine.exportState().portfolio.tradeHistory.length, 2);
  assert.equal(engine.exportState().portfolio.cash, cashAfterManualClose);
});

test('cancelling a bracket parent before its fill leaves no executable children', () => {
  const engine = new MarketSimulationEngine('G5_PARENT_CANCEL', 100000);
  const parent = engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 2, limitPrice: 1,
    takeProfitPrice: 1000000, stopLossPrice: 0.01, timeInForce: 'GTC',
  });
  assert.equal(parent.success, true);
  assert.equal(engine.exportState().openOrders.length, 1);
  assert.equal(engine.exportState().openOrders[0].isBracketChild, undefined);

  assert.equal(engine.cancelOrder(parent.orderId!), true);
  engine.tick(0.05);

  const after = engine.exportState();
  assert.equal(after.openOrders.length, 0);
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.portfolio.tradeHistory.length, 0);
});

test('independent bracket groups on one ticker keep their own OCO pairs', () => {
  const engine = new MarketSimulationEngine('G5_MULTI_GROUP', 100000);
  const first = engine.placeOrder({ ...ENTRY, takeProfitPrice: 0.01, stopLossPrice: 0.01 });
  const second = engine.placeOrder({ ...ENTRY, takeProfitPrice: 1000000, stopLossPrice: 0.01 });
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(openExits(engine).length, 4);

  engine.tick(0.05);

  const after = engine.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares, 2);
  assert.equal(after.portfolio.tradeHistory.length, 3);
  assert.equal(after.portfolio.tradeHistory[0].orderId, `${first.orderId}_tp`);
  assert.deepEqual(after.openOrders.map((order) => order.parentOrderId), [second.orderId, second.orderId]);
  assert.ok(after.openOrders.every((order) => order.isBracketChild && order.quantity === 2));
});

test('a partially filled parent creates linked exits that cover the full position', () => {
  const engine = new MarketSimulationEngine('G5_PARTIAL_PARENT', 100000);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 2 }).success, true);
  const parent = engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 5, limitPrice: 1000,
    takeProfitPrice: 1000000, stopLossPrice: 0.01, timeInForce: 'GTC',
  });
  assert.equal(parent.success, true);

  const state = engine.exportState();
  const pending = state.openOrders.find((order) => order.id === parent.orderId)!;
  pending.status = 'partially_filled';
  pending.filledQuantity = 2;
  const restored = new MarketSimulationEngine(state.seed, 100000);
  restored.importState(state);

  restored.tick(0.05);

  const after = restored.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares, 5);
  assert.equal(after.portfolio.tradeHistory[0].shares, 3, 'only the remaining parent shares fill');
  assert.equal(after.openOrders.length, 2);
  assert.ok(after.openOrders.every((order) => order.parentOrderId === parent.orderId && order.quantity === 5));
});

test('a partially filled exit fills only its remainder and cancels its sibling', () => {
  const engine = new MarketSimulationEngine('G5_PARTIAL_CHILD', 100000);
  const entry = engine.placeOrder({ ...ENTRY, takeProfitPrice: 0.01, stopLossPrice: 0.01 });
  assert.equal(entry.success, true);

  const state = engine.exportState();
  const takeProfit = state.openOrders.find((order) => order.id === `${entry.orderId}_tp`)!;
  takeProfit.status = 'partially_filled';
  takeProfit.filledQuantity = 1;
  const position = state.portfolio.positions.find((item) => item.ticker === 'HLVG')!;
  position.shares = 1;
  position.marketValue = position.marketValue / 2;
  position.costBasis = position.costBasis / 2;
  const restored = new MarketSimulationEngine(state.seed, 100000);
  restored.importState(state);

  restored.tick(0.05);

  const after = restored.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.portfolio.tradeHistory[0].shares, 1, 'only the unfilled child shares execute');
  assert.equal(after.openOrders.length, 0, 'the stop-loss sibling is cancelled');
});

test('short-position brackets cover the short and cancel the opposing exit', () => {
  const engine = new MarketSimulationEngine('G5_SHORT_BRACKET', 100000);
  unlockShorting(engine);
  const entry = engine.placeOrder({
    ticker: 'HLVG', side: 'sell', type: 'market', quantity: 2,
    takeProfitPrice: 0.01, stopLossPrice: 0.01,
  });
  assert.equal(entry.success, true);

  const exits = openExits(engine);
  assert.equal(exits.length, 2);
  assert.deepEqual(exits.map((order) => [order.side, order.type]), [['buy', 'limit'], ['buy', 'stop']]);

  engine.tick(0.05);

  const after = engine.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.openOrders.length, 0);
  assert.equal(after.portfolio.tradeHistory.length, 2);
  assert.equal(after.portfolio.tradeHistory[0].side, 'buy');
  assert.equal(after.portfolio.tradeHistory[0].orderId, `${entry.orderId}_sl`);
});

test('an oversize linked exit is rejected without opening a short or charging commission', () => {
  const engine = new MarketSimulationEngine('G5_REJECTED_EXIT', 100000);
  const entry = engine.placeOrder({ ...ENTRY, takeProfitPrice: 0.01, stopLossPrice: 0.01 });
  assert.equal(entry.success, true);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'market', quantity: 1 }).success, true);

  // Simulate a saved exit that outlived its position: the toolkit clamps live fills,
  // but malformed legacy state can still hold an oversize linked sell.
  const state = engine.exportState();
  const takeProfit = state.openOrders.find((order) => order.id === `${entry.orderId}_tp`)!;
  takeProfit.status = 'pending';
  takeProfit.filledQuantity = 0;
  takeProfit.quantity = 2;
  // Even with shorting unlocked the linked exit cannot flip the book.
  state.portfolio.shortingUnlocked = true;
  state.portfolio.marginUnlocked = true;
  const restored = new MarketSimulationEngine(state.seed, 100000);
  restored.importState(state);
  const before = restored.exportState();

  restored.tick(0.05);

  const after = restored.exportState();
  assert.equal(after.portfolio.cash, before.portfolio.cash);
  assert.deepEqual(after.portfolio.positions.map((position) => [position.ticker, position.shares]),
    before.portfolio.positions.map((position) => [position.ticker, position.shares]));
  assert.deepEqual(after.portfolio.tradeHistory, before.portfolio.tradeHistory);
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares, 1);
  assert.equal(after.openOrders.length, 1, 'the rejected leg is gone and its sibling is clamped');
  assert.equal(after.openOrders[0].id, `${entry.orderId}_sl`);
  assert.equal(after.openOrders[0].quantity, 1);

  restored.tick(0.05);
  assert.deepEqual(restored.exportState().portfolio.tradeHistory, after.portfolio.tradeHistory,
    'a rejected exit never retries');
  assert.equal(restored.exportState().portfolio.cash, after.portfolio.cash);
});

test('a linked cover exit that cannot be funded is removed instead of retrying', () => {
  const engine = new MarketSimulationEngine('G5_FUNDING_REJECT', 100000);
  unlockShorting(engine);
  const entry = engine.placeOrder({
    ticker: 'HLVG', side: 'sell', type: 'market', quantity: 2,
    takeProfitPrice: 1000000, stopLossPrice: 1000000,
  });
  assert.equal(entry.success, true);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 1 }).success, true);

  const state = engine.exportState();
  state.portfolio.cash = '0';
  state.portfolio.marginUnlocked = false;
  state.portfolio.shortingUnlocked = false;
  const takeProfit = state.openOrders.find((order) => order.id === `${entry.orderId}_tp`)!;
  takeProfit.quantity = 5;
  const restored = new MarketSimulationEngine(state.seed, 100000);
  restored.importState(state);
  const before = restored.exportState();

  restored.tick(0.05);

  const after = restored.exportState();
  assert.equal(after.portfolio.cash, before.portfolio.cash);
  assert.deepEqual(after.portfolio.positions.map((position) => [position.ticker, position.shares]),
    before.portfolio.positions.map((position) => [position.ticker, position.shares]));
  assert.equal(after.portfolio.tradeHistory.length, before.portfolio.tradeHistory.length);
  assert.deepEqual(after.openOrders.map((order) => [order.id, order.quantity]), [[`${entry.orderId}_sl`, 1]]);
});

test('save and reload reconstruct explicit linked exits and their OCO behavior', () => {
  const engine = new MarketSimulationEngine('G5_SAVE_RELOAD', 100000);
  const entry = engine.placeOrder({ ...ENTRY, takeProfitPrice: 0.01, stopLossPrice: 0.01 });
  assert.equal(entry.success, true);

  const restored = new MarketSimulationEngine('G5_SAVE_RELOAD', 100000);
  restored.importState(engine.exportState());
  const exits = openExits(restored);
  assert.equal(exits.length, 2);
  assert.ok(exits.every((order) => order.parentOrderId === entry.orderId && order.isBracketChild === true));

  restored.tick(0.05);

  const after = restored.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.openOrders.length, 0);
  assert.equal(after.portfolio.tradeHistory.length, 2);
});

test('legacy unlinked exits stay independent and malformed rows remain cancellable', () => {
  const engine = new MarketSimulationEngine('G5_LEGACY', 100000);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 2 }).success, true);
  const limit = engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'limit', quantity: 1, limitPrice: 0.01 });
  const stop = engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'stop', quantity: 1, stopPrice: 1000000 });
  assert.equal(limit.success, true);
  assert.equal(stop.success, true);

  engine.tick(0.05);

  const after = engine.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.portfolio.tradeHistory.length, 3, 'both independent exits fill; neither is treated as OCO');
  assert.equal(after.openOrders.length, 0);

  const ambiguous: Order = {
    id: 'legacy_ambiguous', ticker: 'VCRX', side: 'sell', type: 'limit', quantity: 1,
    filledQuantity: 0, limitPrice: 1000000, timeInForce: 'GTC', status: 'pending',
    createdAt: 1, commissionPaid: 0, parentOrderId: 'missing_parent',
  };
  const malformed: Order = {
    id: 'legacy_malformed', ticker: 'VCRX', side: 'buy', type: 'limit', quantity: 0,
    filledQuantity: 0, limitPrice: 1000000, timeInForce: 'GTC', status: 'pending',
    createdAt: 2, commissionPaid: 0,
  };
  const state = engine.exportState();
  state.openOrders.push(ambiguous, malformed);
  const restored = new MarketSimulationEngine(state.seed, 100000);
  restored.importState(state);
  restored.tick(0.05);

  assert.deepEqual(restored.exportState().openOrders.map((order) => order.id), ['legacy_ambiguous', 'legacy_malformed']);
  assert.equal(restored.cancelOrder('legacy_ambiguous'), true);
  assert.equal(restored.cancelOrder('legacy_malformed'), true);
  assert.equal(restored.exportState().openOrders.length, 0);
});

test('cancelling a linked buy exit releases its buying-power reservation', () => {
  const engine = new MarketSimulationEngine('G5_RESERVATION', 100000);
  const state = engine.exportState();
  const child: Order = {
    id: 'legacy_linked_buy', ticker: 'VCRX', side: 'buy', type: 'limit', quantity: 2,
    filledQuantity: 0, limitPrice: 180, timeInForce: 'GTC', status: 'pending',
    createdAt: 1, commissionPaid: 0, parentOrderId: 'legacy_parent', isBracketChild: true,
  };
  state.openOrders.push(child);
  engine.importState(state);

  const before = engine.getSnapshot().riskMetrics.buyingPower;
  assert.equal(engine.cancelOrder(child.id), true);
  const after = engine.getSnapshot().riskMetrics.buyingPower;
  assert.ok(after >= before + 360, `released ${after - before} of reserved capital`);
});

test('the exit that closes the position is charged commission exactly once', () => {
  const engine = new MarketSimulationEngine('G5_COMMISSION', 100000);
  const entry = engine.placeOrder({ ...ENTRY, takeProfitPrice: 0.01, stopLossPrice: 1000000 });
  assert.equal(entry.success, true);
  engine.tick(0.05);

  const after = engine.exportState();
  const [exitTrade, entryTrade] = after.portfolio.tradeHistory;
  assert.equal(after.portfolio.tradeHistory.length, 2);
  assert.ok(exitTrade.commission > 0);
  const expectedCash = 100000 - entryTrade.totalValue - entryTrade.commission
    + exitTrade.totalValue - exitTrade.commission;
  assert.equal(Number(after.portfolio.cash), Math.round(expectedCash * 100) / 100);

  engine.tick(0.05);
  assert.equal(engine.exportState().portfolio.tradeHistory.length, 2);
  assert.equal(Number(engine.exportState().portfolio.cash), Math.round(expectedCash * 100) / 100);
});

test('equivalent state and actions replay the same OCO outcome', () => {
  const source = new MarketSimulationEngine('G5_REPLAY', 100000);
  const entry = source.placeOrder({ ...ENTRY, takeProfitPrice: 0.01, stopLossPrice: 1000000 });
  assert.equal(entry.success, true);
  const state = source.exportState();

  const normalize = (value: MarketEngineState) => ({
    cash: value.portfolio.cash,
    positions: value.portfolio.positions.map((position) => [position.ticker, position.shares]),
    trades: value.portfolio.tradeHistory.map((trade) => [trade.orderId, trade.side, trade.shares, trade.price, trade.commission]),
    orders: value.openOrders.map((order) => [order.id, order.status, order.side, order.type, order.quantity, order.parentOrderId]),
    actionSeq: value.actionSeq,
    rngState: value.rngState,
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
  assert.equal(first.trades.length, 2);
  assert.equal(first.trades[0][0], `${entry.orderId}_tp`);
});
