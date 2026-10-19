import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SeededRNG } from './rng.ts';
import { Money } from '../lib/money.ts';
import { OrderBookEngine } from './orderbook.ts';
import { OrderMatchingEngine } from './matching.ts';
import { PortfolioEngine } from './portfolio.ts';
import { PricingEngine } from './pricing.ts';
import { MarketSimulationEngine } from './market.ts';
import { COMPANIES, COMPANY_MAP } from '../data/companies.ts';

test('Seeded RNG is strictly deterministic given the same seed', () => {
  const rng1 = new SeededRNG('TAPE_ALPHA_SEED');
  const rng2 = new SeededRNG('TAPE_ALPHA_SEED');

  const seq1 = [rng1.next(), rng1.next(), rng1.nextGaussian(), rng1.nextInt(10, 100)];
  const seq2 = [rng2.next(), rng2.next(), rng2.nextGaussian(), rng2.nextInt(10, 100)];

  assert.deepEqual(seq1, seq2, 'Identical seed must produce identical pseudo-random numbers');
});

test('Exact decimal Money math prevents floating point drift', () => {
  let m = Money.from(100000);
  m = m.sub(151.70 * 100); // 15170
  m = m.sub(1.76); // commission
  assert.equal(m.toNumber(), 84828.24);
  assert.equal(m.format(), '$84,828.24');

  // Verify negative handling
  const neg = Money.from(-450.50);
  assert.equal(neg.format(), '-$450.50');
});

test('Order matching commission math adheres to equity schedule', () => {
  const rng = new SeededRNG(42);
  const bookEngine = new OrderBookEngine(rng);
  const matching = new OrderMatchingEngine(bookEngine);

  // 100 shares at $150 = $15,000 value
  // Base $1.00 + 100 * $0.005 ($0.50) + 0.0001 * $15000 ($1.50) = $3.00
  const comm = matching.calculateCommission(100, 150);
  assert.equal(comm, 3.0);

  // Small order minimum commission ($1.50)
  const smallComm = matching.calculateCommission(1, 10);
  assert.equal(smallComm, 1.5);
});

test('Orderbook slippage walks 5-level depth ladder accurately', () => {
  const rng = new SeededRNG(99);
  const bookEngine = new OrderBookEngine(rng);
  const company = COMPANIES[0]; // HLVG
  const depth = bookEngine.generateDepth(company, 150.0, 'bull');

  assert.equal(depth.bids.length, 5);
  assert.equal(depth.asks.length, 5);
  assert.ok(depth.bestAsk > depth.bestBid, 'Best ask must exceed best bid');

  // Small fill should execute right at best ask with minimal slippage
  const smallFill = bookEngine.simulateFill('buy', 50, depth);
  assert.equal(smallFill.averagePrice, depth.bestAsk);
  assert.equal(smallFill.slippageDollars, 0);

  // Large sweep should walk multiple levels and incur slippage
  const largeFill = bookEngine.simulateFill('buy', 5000, depth);
  assert.ok(largeFill.levelsWalked > 1, 'Large order must walk multiple depth levels');
  assert.ok(largeFill.averagePrice >= depth.bestAsk, 'Large buy average price must be at or above best ask');
});

test('a negative market order cannot mint cash or enter the trade history', () => {
  const engine = new MarketSimulationEngine('G0_NEGATIVE', 10000);
  const before = engine.exportState();

  const result = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: -10 });

  assert.equal(result.success, false);
  assert.deepEqual(engine.exportState(), before);
});

test('all order types reject invalid quantity and price inputs before changing the engine', () => {
  const base = { ticker: 'HLVG', side: 'buy' as const, type: 'market' as const, quantity: 1 };
  const invalid = [
    { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: NaN },
    { quantity: Infinity }, { quantity: Number.MAX_SAFE_INTEGER + 1 },
    { type: 'limit' as const }, { type: 'limit' as const, limitPrice: 0 },
    { type: 'limit' as const, limitPrice: Infinity }, { type: 'limit' as const, limitPrice: NaN },
    { type: 'limit' as const, limitPrice: 1e-12 },
    { type: 'limit' as const, limitPrice: 1e-8 },
    { type: 'stop' as const }, { type: 'stop' as const, stopPrice: -1 },
    { type: 'stop_limit' as const, stopPrice: 100 },
    { type: 'stop_limit' as const, limitPrice: 100 },
    { type: 'trailing_stop' as const }, { type: 'trailing_stop' as const, trailingAmount: 0 },
    { type: 'market' as const, takeProfitPrice: -1 },
    { type: 'market' as const, stopLossPrice: NaN },
    { type: 'market' as const, limitPrice: Infinity },
    { type: 'limit' as const, quantity: 100, limitPrice: 1e14 },
  ];

  for (const change of invalid) {
    const engine = new MarketSimulationEngine('G0_INVALID_INPUT', 10000);
    const before = engine.exportState();
    const result = engine.placeOrder({ ...base, ...change });
    assert.equal(result.success, false, JSON.stringify(change));
    assert.ok(result.error, JSON.stringify(change));
    assert.deepEqual(engine.exportState(), before, JSON.stringify(change));
  }
});

test('valid market and pending orders still execute and keep their quantities', () => {
  const engine = new MarketSimulationEngine('G0_VALID', 100000);
  const fill = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 10 });
  assert.equal(fill.success, true);
  assert.equal(engine.getSnapshot().positions.find((p) => p.ticker === 'HLVG')?.shares, 10);
  assert.equal(engine.getSnapshot().recentTrades[0]?.shares, 10);

  const types = [
    { type: 'limit' as const, limitPrice: 1 },
    { type: 'stop' as const, stopPrice: 100000 },
    { type: 'stop_limit' as const, stopPrice: 100000, limitPrice: 1 },
    { type: 'trailing_stop' as const, trailingAmount: 1 },
  ];
  for (const order of types) {
    const result = engine.placeOrder({ ticker: 'HLVG', side: 'buy', quantity: 2, ...order });
    assert.equal(result.success, true, order.type);
    assert.equal(engine.getSnapshot().openOrders.find((o) => o.id === result.orderId)?.quantity, 2);
  }

  const pending = engine.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'limit', quantity: 3, limitPrice: 1000 });
  assert.equal(pending.success, true);
  engine.tick(0.05);
  assert.equal(engine.getSnapshot().openOrders.some((o) => o.id === pending.orderId), false);
  assert.equal(engine.getSnapshot().positions.find((p) => p.ticker === 'VCRX')?.shares, 3);
});

test('a restored partially filled order executes only its remaining shares', () => {
  const engine = new MarketSimulationEngine('G0_PARTIAL', 1000000);
  assert.equal(engine.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'market', quantity: 997 }).success, true);
  const placed = engine.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'limit', quantity: 1000, limitPrice: 800, takeProfitPrice: 3000, stopLossPrice: 1 });
  assert.equal(placed.success, true);
  const saved = engine.exportState();
  const pending = saved.openOrders.find((order) => order.id === placed.orderId)!;
  pending.status = 'partially_filled';
  pending.filledQuantity = 997;
  pending.commissionPaid = 1.5;
  const restored = new MarketSimulationEngine(saved.seed, 1000000);
  restored.importState(saved);
  const before = restored.exportState();

  restored.tick(0.05);

  const after = restored.getSnapshot();
  assert.equal(after.openOrders.some((order) => order.id === placed.orderId), false);
  assert.equal(after.recentTrades[0].shares, 3);
  assert.equal(after.recentTrades[0].commission, 1.5);
  assert.equal(after.positions.find((position) => position.ticker === 'VCRX')?.shares, 1000);
  assert.equal(before.portfolio.positions.find((position) => position.ticker === 'VCRX')?.shares, 997);
  assert.deepEqual(after.openOrders.filter((order) => order.ticker === 'VCRX').map((order) => [order.type, order.quantity]), [['limit', 3], ['stop', 3]]);
});

test('a partial sell closes only its remaining long shares', () => {
  const engine = new MarketSimulationEngine('G0_PARTIAL_SELL', 100000);
  assert.equal(engine.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'market', quantity: 3 }).success, true);
  const placed = engine.placeOrder({ ticker: 'VCRX', side: 'sell', type: 'limit', quantity: 1000, limitPrice: 1 });
  assert.equal(placed.success, true);
  const saved = engine.exportState();
  const pending = saved.openOrders.find((order) => order.id === placed.orderId)!;
  pending.status = 'partially_filled';
  pending.filledQuantity = 997;
  const restored = new MarketSimulationEngine(saved.seed, 100000);
  restored.importState(saved);

  restored.tick(0.05);

  assert.equal(restored.getSnapshot().recentTrades[0].shares, 3);
  assert.equal(restored.getSnapshot().positions.find((position) => position.ticker === 'VCRX'), undefined);
});

test('Portfolio long execution, mark to market, and PnL calculation', () => {
  const portfolio = new PortfolioEngine(100000, false, false);

  const fill = portfolio.executeFill({
    orderId: 'test_order_1',
    ticker: 'HLVG',
    side: 'buy',
    shares: 100,
    price: 150.0,
    commission: 3.0,
    slippageDollars: 0,
    timestamp: 1000,
  });

  assert.ok(fill.success, 'Fill must succeed');
  assert.equal(portfolio.getCash(), 100000 - 15000 - 3.0);

  const pos = portfolio.getPosition('HLVG');
  assert.ok(pos, 'Position must exist');
  assert.equal(pos?.shares, 100);
  assert.equal(pos?.averageEntryPrice, 150.0);

  // Mark to market at $155 (+5.00/share = +$500.00 unrealized PnL)
  portfolio.updateMarketPrices(new Map([['HLVG', 155.0]]));
  assert.equal(pos?.unrealizedPnl, 500.0);

  // Sell 50 shares at $155 (realized PnL = 50 * $5 = $250)
  const sellFill = portfolio.executeFill({
    orderId: 'test_order_2',
    ticker: 'HLVG',
    side: 'sell',
    shares: 50,
    price: 155.0,
    commission: 2.5,
    slippageDollars: 0,
    timestamp: 2000,
  });

  assert.ok(sellFill.success);
  assert.equal(sellFill.tradeRecord?.realizedPnl, 250.0);
  assert.equal(portfolio.getPosition('HLVG')?.shares, 50);
});

test('marked long equity includes unrealized profit exactly once', () => {
  const portfolio = new PortfolioEngine(10000);
  assert.equal(portfolio.executeFill({
    orderId: 'long', ticker: 'HLVG', side: 'buy', shares: 10, price: 100,
    commission: 0, slippageDollars: 0, timestamp: 1000,
  }).success, true);
  portfolio.updateMarketPrices(new Map([['HLVG', 110]]));

  assert.equal(portfolio.getPosition('HLVG')?.unrealizedPnl, 100);
  assert.equal(portfolio.calculateRiskMetrics(COMPANY_MAP).netLiquidationValue, 10100);
  portfolio.updateMarketPrices(new Map([['HLVG', 90]]));
  assert.equal(portfolio.calculateRiskMetrics(COMPANY_MAP).netLiquidationValue, 9900);
  assert.equal(portfolio.exportState().peakEquity, '10100');
  assert.equal(portfolio.exportState().maxDrawdownPercent, 2);
});

test('short sale proceeds are offset by marked liability and commissions', () => {
  const portfolio = new PortfolioEngine(10000, true, true);
  assert.equal(portfolio.executeFill({
    orderId: 'short', ticker: 'HLVG', side: 'sell', shares: 10, price: 100,
    commission: 2, slippageDollars: 0, timestamp: 1000,
  }).success, true);
  assert.equal(portfolio.getCash(), 10998);
  assert.equal(portfolio.calculateRiskMetrics(COMPANY_MAP).netLiquidationValue, 9998);

  portfolio.updateMarketPrices(new Map([['HLVG', 90]]));
  assert.equal(portfolio.getPosition('HLVG')?.unrealizedPnl, 100);
  const risk = portfolio.calculateRiskMetrics(COMPANY_MAP);
  assert.equal(risk.netLiquidationValue, 10098);
  assert.equal(risk.buyingPower, 19296);
  assert.equal(risk.marginCushionPercent, 4388);

  const cover = portfolio.executeFill({
    orderId: 'cover', ticker: 'HLVG', side: 'buy', shares: 4, price: 90,
    commission: 1, slippageDollars: 0, timestamp: 2000,
  });
  assert.equal(cover.tradeRecord?.realizedPnl, 40);
  assert.equal(portfolio.getPosition('HLVG')?.shares, -6);
  assert.equal(portfolio.getPosition('HLVG')?.unrealizedPnl, 60);
  assert.equal(portfolio.calculateRiskMetrics(COMPANY_MAP).netLiquidationValue, 10097);
  portfolio.updateMarketPrices(new Map([['HLVG', 120]]));
  assert.equal(portfolio.getPosition('HLVG')?.unrealizedPnl, -120);
  assert.equal(portfolio.calculateRiskMetrics(COMPANY_MAP).netLiquidationValue, 9917);
});

test('partial close moves marked gain into realized profit without changing equity except commission', () => {
  const portfolio = new PortfolioEngine(10000);
  assert.equal(portfolio.executeFill({
    orderId: 'open', ticker: 'HLVG', side: 'buy', shares: 10, price: 100,
    commission: 2, slippageDollars: 0, timestamp: 1000,
  }).success, true);
  portfolio.updateMarketPrices(new Map([['HLVG', 110]]));
  assert.equal(portfolio.calculateRiskMetrics(COMPANY_MAP).netLiquidationValue, 10098);

  const close = portfolio.executeFill({
    orderId: 'close', ticker: 'HLVG', side: 'sell', shares: 4, price: 110,
    commission: 1, slippageDollars: 0, timestamp: 2000,
  });
  assert.equal(close.success, true);
  assert.equal(close.tradeRecord?.realizedPnl, 40);
  assert.equal(portfolio.getPosition('HLVG')?.shares, 6);
  assert.equal(portfolio.getPosition('HLVG')?.unrealizedPnl, 60);
  assert.equal(portfolio.calculateRiskMetrics(COMPANY_MAP).netLiquidationValue, 10097);
});

test('portfolio rejects invalid internal fills without changing cash, positions or history', () => {
  const valid = { orderId: 'bad_fill', ticker: 'HLVG', side: 'buy' as const, shares: 10, price: 100, commission: 1.5, slippageDollars: 0, timestamp: 1000 };
  const invalid = [
    { shares: -10 }, { shares: 0 }, { shares: 1.5 }, { shares: NaN },
    { shares: Infinity }, { shares: Number.MAX_SAFE_INTEGER + 1 },
    { price: -1 }, { price: 0 }, { price: NaN }, { price: Infinity },
    { price: 1e-12 },
    { shares: 1, price: 1e-8 },
    { shares: 10, price: 1e14 }, { commission: NaN }, { slippageDollars: -1 },
    { initialStopPrice: Infinity },
  ];

  for (const change of invalid) {
    const portfolio = new PortfolioEngine(10000);
    const before = portfolio.exportState();
    const result = portfolio.executeFill({ ...valid, ...change });
    assert.equal(result.success, false, JSON.stringify(change));
    assert.deepEqual(portfolio.exportState(), before, JSON.stringify(change));
  }

  const portfolio = new PortfolioEngine(10000);
  assert.equal(portfolio.executeFill(valid).success, true);
  const before = portfolio.exportState();
  assert.equal(portfolio.executeFill({ ...valid, orderId: 'bad_sell', side: 'sell', shares: -10 }).success, false);
  assert.deepEqual(portfolio.exportState(), before, 'rejected fill must preserve an existing position too');
});

test('locked shorting rejects an oversized sell before changing the portfolio', () => {
  const portfolio = new PortfolioEngine(10000);
  const fill = (side: 'buy' | 'sell', shares: number) => portfolio.executeFill({
    orderId: `${side}_${shares}`, ticker: 'HLVG', side, shares, price: 100,
    commission: 1.5, slippageDollars: 0, timestamp: 1000,
  });

  assert.equal(fill('buy', 10).success, true);
  const before = portfolio.exportState();
  assert.equal(fill('sell', 11).success, false);
  assert.deepEqual(portfolio.exportState(), before);
  assert.equal(fill('sell', 11).success, false);
  assert.deepEqual(portfolio.exportState(), before, 'retries cannot charge a second commission or create a trade');
  assert.equal(fill('sell', 4).success, true);
  assert.equal(portfolio.getPosition('HLVG')?.shares, 6);
  assert.equal(fill('sell', 6).success, true);
  assert.equal(portfolio.getPosition('HLVG'), undefined);
  const empty = portfolio.exportState();
  assert.equal(fill('sell', 1).success, false);
  assert.deepEqual(portfolio.exportState(), empty);
});

test('unlocked shorts can be increased, covered and reversed; locked restored shorts can only be covered', () => {
  const portfolio = new PortfolioEngine(10000, true, true);
  const fill = (target: PortfolioEngine, side: 'buy' | 'sell', shares: number) => target.executeFill({
    orderId: `${side}_${shares}`, ticker: 'HLVG', side, shares, price: 100,
    commission: 1.5, slippageDollars: 0, timestamp: 1000,
  });

  assert.equal(fill(portfolio, 'sell', 3).success, true);
  assert.equal(fill(portfolio, 'sell', 2).success, true);
  assert.equal(portfolio.getPosition('HLVG')?.shares, -5);
  const saved = portfolio.exportState();
  saved.shortingUnlocked = false;
  const restored = new PortfolioEngine();
  restored.importState(saved);
  assert.deepEqual(restored.exportState(), saved, 'existing saved positions are not rewritten');
  const before = restored.exportState();
  assert.equal(fill(restored, 'sell', 1).success, false);
  assert.deepEqual(restored.exportState(), before);
  assert.equal(fill(restored, 'buy', 2).success, true);
  assert.equal(restored.getPosition('HLVG')?.shares, -3);
  assert.equal(fill(restored, 'buy', 4).success, true);
  assert.equal(restored.getPosition('HLVG')?.shares, 1);
  const reversed = restored.exportState();
  assert.equal(fill(restored, 'sell', 2).success, false);
  assert.deepEqual(restored.exportState(), reversed);

  assert.equal(fill(portfolio, 'buy', 7).success, true);
  assert.equal(portfolio.getPosition('HLVG')?.shares, 2);
  assert.equal(fill(portfolio, 'sell', 4).success, true);
  assert.equal(portfolio.getPosition('HLVG')?.shares, -2);
});

test('automatic bracket exits cannot sell beyond a locked long position', () => {
  const engine = new MarketSimulationEngine('G3_BRACKET', 100000);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 2,
    takeProfitPrice: 1, stopLossPrice: 100000 }).success, true);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'market', quantity: 1 }).success, true);
  const initial = engine.exportState();
  assert.equal(initial.openOrders.length, 2);
  assert.ok(initial.openOrders.every((order) => order.parentOrderId && order.isBracketChild));

  engine.tick(0.05);
  const after = engine.exportState();
  // The manual close clamps both linked exits to the one remaining share; the first
  // exit to fill closes the position and cancels its OCO sibling.
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.portfolio.tradeHistory.length, initial.portfolio.tradeHistory.length + 1);
  assert.equal(after.openOrders.length, 0);

  engine.tick(0.05);
  assert.equal(engine.exportState().portfolio.tradeHistory.length, after.portfolio.tradeHistory.length);
  assert.equal(engine.exportState().portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(engine.exportState().openOrders.length, 0);
});

test('pending buys reserve cash across orders and cancellation releases it', () => {
  const engine = new MarketSimulationEngine('G2_RESERVE', 1000);
  const first = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 5, limitPrice: 180, timeInForce: 'GTC' });
  assert.equal(first.success, true);
  const before = engine.exportState();
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 5, limitPrice: 180 }).success, false);
  assert.deepEqual(engine.exportState(), before, 'rejection cannot use RNG, seq or change orders');
  assert.equal(engine.cancelOrder(first.orderId!), true);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 5, limitPrice: 180 }).success, true);
});

test('an internal buy fill cannot overdraw cash, but covering a saved short is allowed', () => {
  const portfolio = new PortfolioEngine(1000);
  const fill = (side: 'buy' | 'sell', shares: number, price: number) => portfolio.executeFill({
    orderId: `${side}_${shares}`, ticker: 'HLVG', side, shares, price,
    commission: 1.5, slippageDollars: 0, timestamp: 1000,
  });
  const before = portfolio.exportState();
  assert.equal(fill('buy', 10, 101).success, false);
  assert.deepEqual(portfolio.exportState(), before);

  const savedShort = new PortfolioEngine(1000, true, true);
  assert.equal(savedShort.executeFill({ orderId: 'short', ticker: 'HLVG', side: 'sell', shares: 10,
    price: 100, commission: 1.5, slippageDollars: 0, timestamp: 1000 }).success, true);
  const saved = savedShort.exportState();
  saved.marginUnlocked = false;
  saved.shortingUnlocked = false;
  portfolio.importState(saved);
  assert.equal(fill('buy', 10, 500).success, true, 'closing a legacy short is permitted even when the cash balance becomes negative');
  assert.equal(portfolio.getPosition('HLVG'), undefined);
  const covered = portfolio.exportState();
  assert.equal(fill('buy', 1, 100).success, false);
  assert.deepEqual(portfolio.exportState(), covered);
});

test('same-tick legacy buys compete deterministically across tickers without overdrawing', () => {
  const source = new MarketSimulationEngine('G2_SAME_TICK', 1000);
  const first = source.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 5, limitPrice: 180 });
  assert.equal(first.success, true);
  const state = source.exportState();
  state.openOrders[0].createdAt = 2000;
  state.openOrders.push({ ...state.openOrders[0], id: 'legacy_vcrx', ticker: 'VCRX', createdAt: 1000 });
  const results = [];
  for (let i = 0; i < 2; i++) {
    const engine = new MarketSimulationEngine(state.seed, 1000);
    engine.importState(state);
    engine.tick(0.05);
    const after = engine.exportState();
    assert.equal(after.portfolio.positions.find((position) => position.ticker === 'VCRX')?.shares, 5);
    assert.ok((after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares ?? 0) > 0);
    assert.ok((after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares ?? 0) < 5);
    assert.ok(Number(after.portfolio.cash) >= 0);
    assert.deepEqual(after.openOrders.map((order) => [order.id, order.status]), [[first.orderId, 'partially_filled']]);
    assert.equal(after.portfolio.tradeHistory.length, 2);
    results.push([after.portfolio.cash, after.portfolio.positions.map(({ entryTimestamp, ...position }) => position),
      after.openOrders, after.actionSeq, after.rngState]);
  }
  assert.deepEqual(results[0], results[1]);
});

test('saved order sequence breaks ties when two pending buys have the same creation time', () => {
  const source = new MarketSimulationEngine('G2_SAME_AGE', 1000);
  const first = source.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 5, limitPrice: 180 });
  assert.equal(first.success, true);
  const state = source.exportState();
  state.openOrders.push({ ...state.openOrders[0], id: 'legacy_vcrx', ticker: 'VCRX' });
  const restored = new MarketSimulationEngine(state.seed, 1000);
  restored.importState(state);
  restored.tick(0.05);
  const after = restored.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares, 5);
  assert.ok((after.portfolio.positions.find((position) => position.ticker === 'VCRX')?.shares ?? 0) > 0);
  assert.ok((after.portfolio.positions.find((position) => position.ticker === 'VCRX')?.shares ?? 0) < 5);
  assert.deepEqual(after.openOrders.map((order) => [order.id, order.status]), [['legacy_vcrx', 'partially_filled']]);
  assert.equal(after.portfolio.tradeHistory.length, 2);
});

test('own reservation is not charged again when a pending buy fills after a market buy', () => {
  const engine = new MarketSimulationEngine('G2_OWN_RESERVE', 700);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 3, limitPrice: 180 }).success, true);
  assert.equal(engine.getSnapshot().riskMetrics.buyingPower, 158.5);
  assert.equal(engine.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'market', quantity: 1 }).success, true);
  engine.tick(0.05);
  const after = engine.exportState();
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares, 3);
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'VCRX')?.shares, 1);
  assert.ok(Number(after.portfolio.cash) >= 0);
  assert.equal(after.openOrders.length, 0);
});

test('DAY expiry and GTC cancellation release derived reservations', () => {
  const engine = new MarketSimulationEngine('G2_DAY_GTC', 2000);
  const day = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 4, limitPrice: 180, timeInForce: 'DAY' });
  const gtc = engine.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'stop_limit', quantity: 4,
    stopPrice: 1000, limitPrice: 180, timeInForce: 'GTC' });
  assert.equal(day.success, true);
  assert.equal(gtc.success, true);
  assert.equal(engine.getSnapshot().riskMetrics.buyingPower, 557);
  engine.skipToNextDay();
  assert.deepEqual(engine.getSnapshot().openOrders.map((order) => order.id), [gtc.orderId]);
  assert.equal(engine.getSnapshot().riskMetrics.buyingPower, 1278.5);
  assert.equal(engine.cancelOrder(gtc.orderId!), true);
  assert.equal(engine.getSnapshot().riskMetrics.buyingPower, 2000);
});

test('limit, stop-limit, stop and trailing buys share the same available capital', () => {
  const engine = new MarketSimulationEngine('G2_ORDER_TYPES', 1000);
  const orders = [
    { ticker: 'HLVG', side: 'buy' as const, type: 'limit' as const, quantity: 1, limitPrice: 180 },
    { ticker: 'VCRX', side: 'buy' as const, type: 'stop_limit' as const, quantity: 1, stopPrice: 300, limitPrice: 180 },
    { ticker: 'HLVG', side: 'buy' as const, type: 'stop' as const, quantity: 1, stopPrice: 300 },
    { ticker: 'VCRX', side: 'buy' as const, type: 'trailing_stop' as const, quantity: 1, trailingAmount: 300 },
  ];
  for (const order of orders) assert.equal(engine.placeOrder(order).success, true);
  const before = engine.exportState();
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 3,
    limitPrice: 180 }).success, false);
  assert.deepEqual(engine.exportState(), before);
  assert.equal(engine.getSnapshot().openOrders.length, 4);
  assert.ok(engine.getSnapshot().riskMetrics.buyingPower > 0);
  assert.ok(engine.getSnapshot().riskMetrics.buyingPower < 400);
});

test('a manual partial close clamps a linked exit before it can sell the remaining long', () => {
  const engine = new MarketSimulationEngine('G2_BRACKET', 1000);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 2,
    takeProfitPrice: 1, stopLossPrice: 100000 }).success, true);
  const held = engine.getSnapshot().positions.find((position) => position.ticker === 'HLVG')!.shares;
  assert.equal(held, 2);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'market', quantity: 1 }).success, true);
  engine.tick(0.05);
  const after = engine.exportState();
  // The remaining linked exit closes the final share; neither leg can open a short.
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG'), undefined);
  assert.equal(after.portfolio.tradeHistory.length, 3);
  assert.equal(after.openOrders.filter((order) => order.side === 'sell').length, 0);
});

test('restored partial buys reserve only their remaining shares', () => {
  const engine = new MarketSimulationEngine('G2_PARTIAL', 500);
  const placed = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 2, limitPrice: 180 });
  assert.equal(placed.success, true);
  const state = engine.exportState();
  state.openOrders[0].status = 'partially_filled';
  state.openOrders[0].filledQuantity = 1;
  const restored = new MarketSimulationEngine(state.seed, 500);
  restored.importState(state);
  assert.equal(restored.getSnapshot().riskMetrics.buyingPower, 318.5);
  assert.equal(restored.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'limit', quantity: 1, limitPrice: 180 }).success, true);
  assert.equal(restored.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'limit', quantity: 1, limitPrice: 180 }).success, false);
  restored.tick(0.05);
  assert.equal(restored.exportState().portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares, 1);
  assert.equal(restored.exportState().openOrders.length, 0);
});

test('one short position cannot fund two independent covering orders', () => {
  const engine = new MarketSimulationEngine('G2_SHORT_COVER_RESERVE', 100);
  const short = new PortfolioEngine(100, false, true);
  assert.equal(short.executeFill({ orderId: 'old_short', ticker: 'HLVG', side: 'sell', shares: 2,
    price: 100, commission: 1.5, slippageDollars: 0, timestamp: 1000 }).success, true);
  short.setUnlockedFeatures(false, false);
  const state = engine.exportState();
  state.portfolio = short.exportState();
  state.portfolio.cash = '10';
  engine.importState(state);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 2, limitPrice: 180 }).success, true);
  const before = engine.exportState();
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 1, limitPrice: 180 }).success, false);
  assert.deepEqual(engine.exportState(), before);
  assert.equal(engine.getSnapshot().riskMetrics.buyingPower, 0);
});

test('a buy stop gap fills only the affordable prefix at its actual price', () => {
  const engine = new MarketSimulationEngine('G2_GAP', 1000);
  const placed = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'stop', quantity: 5, stopPrice: 200 });
  assert.equal(placed.success, true);
  const state = engine.exportState();
  state.pricing.states.find((price) => price.ticker === 'HLVG')!.price = 300;
  const restored = new MarketSimulationEngine(state.seed, 1000);
  restored.importState(state);
  const before = restored.exportState();
  restored.tick(0.05);
  const after = restored.exportState();
  assert.equal(before.portfolio.tradeHistory.length, 0);
  assert.equal(after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares, 3);
  assert.equal(after.portfolio.tradeHistory[0].commission, 1.5);
  assert.equal(after.openOrders[0].filledQuantity, 3);
  assert.equal(after.openOrders[0].stopTriggered, true);
  assert.ok(after.actionSeq > before.actionSeq);
});

test('pending fills use the current tick mark when another position moves', () => {
  const source = new MarketSimulationEngine('G2_STALE_MARK', 1000);
  const placed = source.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 5, limitPrice: 180 });
  assert.equal(placed.success, true);
  const portfolio = new PortfolioEngine(1000, true, false);
  assert.equal(portfolio.executeFill({ orderId: 'long', ticker: 'VCRX', side: 'buy', shares: 10,
    price: 100, commission: 0, slippageDollars: 0, timestamp: 1000 }).success, true);
  const state = source.exportState();
  state.portfolio = portfolio.exportState();
  state.pricing.states.find((price) => price.ticker === 'VCRX')!.price = 50;
  const engine = new MarketSimulationEngine(state.seed, 1000);
  engine.importState(state);
  const before = engine.exportState();
  engine.tick(0.05);
  const after = engine.exportState();
  assert.ok((after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares ?? 0) > 0,
    'only an affordable prefix of the HLVG order can fill after VCRX moves');
  assert.ok((after.portfolio.positions.find((position) => position.ticker === 'HLVG')?.shares ?? 0) < 5);
  assert.equal(after.portfolio.tradeHistory.length, before.portfolio.tradeHistory.length + 1);
  assert.ok(after.portfolio.positions.find((position) => position.ticker === 'VCRX')!.marketValue < 600);
  assert.deepEqual(after.openOrders.map((order) => [order.id, order.status]), [[placed.orderId, 'partially_filled']]);
});

test('cash accounts refuse leveraged buys while margin accounts allow only funded 2:1 exposure', () => {
  const fill = (target: PortfolioEngine, shares: number) => target.executeFill({
    orderId: `buy_${shares}`, ticker: 'HLVG', side: 'buy', shares, price: 150,
    commission: 1.5, slippageDollars: 0, timestamp: 1000,
  });
  const cash = new PortfolioEngine(1000);
  const before = cash.exportState();
  assert.equal(fill(cash, 12).success, false);
  assert.deepEqual(cash.exportState(), before);
  const margin = new PortfolioEngine(1000, true, false);
  assert.equal(fill(margin, 12).success, true);
  assert.equal(margin.getCash(), -801.5);
  const leveraged = margin.exportState();
  assert.equal(fill(margin, 2).success, false);
  assert.deepEqual(margin.exportState(), leveraged);
});

test('cash accounts cannot spend unsettled short proceeds on new long positions', () => {
  const portfolio = new PortfolioEngine(1000, false, true);
  assert.equal(portfolio.executeFill({ orderId: 'short', ticker: 'HLVG', side: 'sell', shares: 5,
    price: 100, commission: 1.5, slippageDollars: 0, timestamp: 1000 }).success, true);
  assert.equal(portfolio.getCash(), 1498.5);
  assert.equal(portfolio.getBuyingPower(), 998.5);
  const before = portfolio.exportState();
  assert.equal(portfolio.executeFill({ orderId: 'long', ticker: 'VCRX', side: 'buy', shares: 10,
    price: 120, commission: 1.5, slippageDollars: 0, timestamp: 2000 }).success, false);
  assert.deepEqual(portfolio.exportState(), before);
  assert.equal(portfolio.executeFill({ orderId: 'cover', ticker: 'HLVG', side: 'buy', shares: 5,
    price: 100, commission: 1.5, slippageDollars: 0, timestamp: 2000 }).success, true);
});

test('margin short fills cannot exceed the same 2:1 buying-power limit as buys', () => {
  const portfolio = new PortfolioEngine(1000, true, true);
  const short = (shares: number) => portfolio.executeFill({ orderId: `short_${shares}`, ticker: 'HLVG',
    side: 'sell', shares, price: 150, commission: 1.5, slippageDollars: 0, timestamp: 1000 });
  assert.equal(short(12).success, true);
  const before = portfolio.exportState();
  assert.equal(short(2).success, false);
  assert.deepEqual(portfolio.exportState(), before);
});

test('cash-account short proceeds cannot pay a commission greater than the remaining collateral', () => {
  const portfolio = new PortfolioEngine(1, false, true);
  const before = portfolio.exportState();
  assert.equal(portfolio.executeFill({ orderId: 'tiny_short', ticker: 'HLVG', side: 'sell', shares: 1,
    price: 0.01, commission: 1.5, slippageDollars: 0, timestamp: 1000 }).success, false);
  assert.deepEqual(portfolio.exportState(), before);
});

test('a short-to-long reversal may use buying power released by covering the short', () => {
  const source = new MarketSimulationEngine('G2_MARGIN_REVERSAL', 1000);
  const portfolio = new PortfolioEngine(1000, true, true);
  assert.equal(portfolio.executeFill({ orderId: 'short', ticker: 'HLVG', side: 'sell', shares: 13,
    price: 151.7, commission: 1.5, slippageDollars: 0, timestamp: 1000 }).success, true);
  const state = source.exportState();
  state.portfolio = portfolio.exportState();
  const engine = new MarketSimulationEngine(state.seed, 1000);
  engine.importState(state);
  assert.ok(engine.getSnapshot().riskMetrics.buyingPower < 100);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 14,
    limitPrice: 200 }).success, true);
  engine.tick(0.05);
  assert.equal(engine.getSnapshot().positions.find((position) => position.ticker === 'HLVG')?.shares, 1);
});

test('filled positions are re-marked at the current market price after matching', () => {
  const engine = new MarketSimulationEngine('G2_REMARK', 100000);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 5, limitPrice: 1000, timeInForce: 'GTC' }).success, true);
  engine.tick(0.5);

  const snapshot = engine.getSnapshot();
  const position = snapshot.positions.find((p) => p.ticker === 'HLVG');
  const mark = snapshot.prices.find((p) => p.ticker === 'HLVG')!.price;
  assert.ok(position);
  assert.equal(position.currentPrice, mark, 'a fill must not leave the tick marked at its execution price');
  assert.equal(position.marketValue, Math.round(position.shares * mark * 100) / 100);
});

test('career objectives award reputation once and unlock Junior Trader deterministically', () => {
  const engine = new MarketSimulationEngine('G4_CAREER_PATH', 140000);
  assert.equal(engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'market', quantity: 1, stopLossPrice: 0.01, timeInForce: 'GTC',
  }).success, true);
  let career = engine.exportState().career;
  assert.equal(career.reputation, 0);
  assert.equal(career.objectives.find((o) => o.id.endsWith('_1'))?.progressText, '1 of 3 stop orders set');
  assert.equal(career.objectives.find((o) => o.id.endsWith('_3'))?.progressText, '1 of 3 sectors held');

  for (const ticker of ['BWTR', 'KNRG']) {
    assert.equal(engine.placeOrder({
      ticker, side: 'buy', type: 'market', quantity: 1, stopLossPrice: 0.01, timeInForce: 'GTC',
    }).success, true);
  }

  career = engine.exportState().career;
  assert.equal(career.reputation, 75, 'three protected trades and three sectors each award once');
  assert.equal(career.objectives.find((o) => o.id.endsWith('_1'))?.completed, true);
  assert.equal(career.objectives.find((o) => o.id.endsWith('_3'))?.completed, true);

  // A saved position held through earnings closes profitably.
  const state = engine.exportState();
  state.career.earningsHeldTickers = ['HLVG'];
  const held = state.portfolio.positions.find((p) => p.ticker === 'HLVG')!;
  held.averageEntryPrice = 0.01;
  held.costBasis = 0.01;
  engine.importState(state);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'market', quantity: 1 }).success, true);

  career = engine.exportState().career;
  assert.equal(career.reputation, 125, 'the earnings objective awards its defined 50 points once');
  assert.ok(career.objectives.every((o) => o.completed));

  engine.tick(0.05);
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.career.rank.order, 2, 'equity and reputation promote the player');
  assert.equal(snapshot.career.nextRank.order, 3);
  assert.equal(engine.exportState().portfolio.shortingUnlocked, true);
  assert.equal(engine.exportState().portfolio.marginUnlocked, false);

  engine.tick(0.05);
  assert.equal(engine.getSnapshot().career.reputation, 125, 'repeat ticks must not farm the same objective');

  const restored = new MarketSimulationEngine(state.seed, 140000);
  restored.importState(engine.exportState());
  restored.tick(0.05);
  assert.equal(restored.getSnapshot().career.reputation, 125, 'reloads must not re-award completed objectives');
  assert.equal(restored.getSnapshot().career.rank.order, 2);
});

test('a rejected locked sell cannot award reputation or mutate career progress', () => {
  const engine = new MarketSimulationEngine('G4_REJECTED_SELL', 140000);
  assert.equal(engine.placeOrder({
    ticker: 'HLVG', side: 'buy', type: 'market', quantity: 1, stopLossPrice: 0.01, timeInForce: 'GTC',
  }).success, true);
  const before = engine.exportState();
  assert.equal(before.portfolio.tradeHistory.length, 1);

  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'market', quantity: 2 }).success, true);
  engine.tick(0.05);

  const after = engine.exportState();
  assert.equal(after.career.reputation, before.career.reputation);
  assert.deepEqual(after.career.objectives, before.career.objectives);
  assert.equal(after.portfolio.tradeHistory.length, 1, 'a refused fill leaves no trade record');
});

test('held scheduled earnings are recorded before the next day starts', () => {
  const engine = new MarketSimulationEngine('G4_EARNINGS_HELD', 140000);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 1 }).success, true);
  const state = engine.exportState();
  const earnings = state.upcomingEarnings.find((event) => event.ticker === 'HLVG')!;
  state.simDay = earnings.simDay;
  engine.importState(state);
  engine.skipToNextDay();

  const career = engine.exportState().career;
  assert.deepEqual(career.earningsHeldTickers, ['HLVG']);
  assert.ok(career.objectives.find((o) => o.id.endsWith('_2'))?.progressText.includes('awaiting profitable close'));
  assert.equal(career.objectives.find((o) => o.id.endsWith('_2'))?.completed, false);
});

test('career ranks beyond Junior Trader unlock margin and weekly objectives rotate without losing reputation', () => {
  const engine = new MarketSimulationEngine('G4_RANK3_WEEK', 180000);
  const state = engine.exportState();
  state.career.currentRankIndex = 1;
  state.career.reputation = 250;
  state.simDay = 5;
  state.career.objectiveWeek = 1;
  state.career.objectives = state.career.objectives.map((objective) => ({
    ...objective, completed: true, progressText: 'Complete',
  }));
  state.career.protectedOrderIds = ['one', 'two', 'three'];
  state.career.earningsHeldTickers = ['HLVG'];
  engine.importState(state);

  engine.tick(0.05);
  assert.equal(engine.getSnapshot().career.rank.order, 3);
  assert.equal(engine.exportState().portfolio.marginUnlocked, true);

  engine.skipToNextDay();
  const career = engine.exportState().career;
  assert.equal(career.objectiveWeek, 2);
  assert.equal(career.reputation, 250, 'rotation preserves reputation');
  assert.deepEqual(career.objectives.map((objective) => objective.id), ['obj_2_1', 'obj_2_2', 'obj_2_3']);
  assert.ok(career.objectives.every((objective) => !objective.completed));
  assert.deepEqual(career.protectedOrderIds, []);
  assert.deepEqual(career.earningsHeldTickers, ['HLVG'], 'a hold that spans the week boundary stays eligible until closed');

  // The earnings hold closes in week 2 and pays the new week's objective once.
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 1 }).success, true);
  const closingState = engine.exportState();
  const closingPosition = closingState.portfolio.positions.find((position) => position.ticker === 'HLVG')!;
  closingPosition.averageEntryPrice = 0.01;
  closingPosition.costBasis = 0.01;
  engine.importState(closingState);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'market', quantity: 1 }).success, true);
  const afterClose = engine.exportState().career;
  assert.equal(afterClose.reputation, 300, 'the week-2 earnings objective awards its 50 points once');
  assert.equal(afterClose.objectives.find((objective) => objective.id.endsWith('_2'))?.completed, true);
  assert.deepEqual(afterClose.earningsHeldTickers, []);
});

test('a losing close consumes an earnings hold so later re-entry cannot farm the objective', () => {
  const engine = new MarketSimulationEngine('G4_LOSS', 140000);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 1 }).success, true);
  const heldState = engine.exportState();
  heldState.career.earningsHeldTickers = ['HLVG'];
  const losingPosition = heldState.portfolio.positions.find((position) => position.ticker === 'HLVG')!;
  losingPosition.averageEntryPrice = 100000;
  losingPosition.costBasis = 100000;
  engine.importState(heldState);
  const reputationBefore = engine.exportState().career.reputation;

  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'market', quantity: 1 }).success, true);
  let career = engine.exportState().career;
  assert.deepEqual(career.earningsHeldTickers, [], 'a losing close still ends that earnings hold');
  assert.notEqual(career.objectives.find((objective) => objective.id.endsWith('_2'))?.completed, true);
  assert.equal(career.reputation, reputationBefore);

  // Re-entering the same ticker is a new position and must not inherit the hold.
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 1 }).success, true);
  const reentry = engine.exportState();
  const reentryPosition = reentry.portfolio.positions.find((position) => position.ticker === 'HLVG')!;
  reentryPosition.averageEntryPrice = 0.01;
  reentryPosition.costBasis = 0.01;
  engine.importState(reentry);
  assert.equal(engine.placeOrder({ ticker: 'HLVG', side: 'sell', type: 'market', quantity: 1 }).success, true);
  career = engine.exportState().career;
  assert.notEqual(career.objectives.find((objective) => objective.id.endsWith('_2'))?.completed, true);
  assert.equal(career.reputation, reputationBefore);
});

test('carried sector holdings complete the objective after loading or while paused', () => {
  const engine = new MarketSimulationEngine('G4_SECTORS', 140000);
  for (const ticker of ['HLVG', 'BWTR', 'KNRG']) {
    assert.equal(engine.placeOrder({ ticker, side: 'buy', type: 'market', quantity: 1 }).success, true);
  }
  const state = engine.exportState();
  state.simDay = 6;
  state.career.objectiveWeek = 2;
  state.career.reputation = 0;
  state.career.objectives = state.career.objectives.map((objective, index) => ({
    ...objective,
    id: `obj_2_${index + 1}`,
    completed: false,
    progressText: 'pending',
  }));

  const restored = new MarketSimulationEngine('G4_SECTORS', 140000);
  restored.importState(state);
  let career = restored.exportState().career;
  assert.equal(career.objectives.find((objective) => objective.id === 'obj_2_3')?.completed, true);
  assert.equal(career.reputation, 40);

  // A paused engine must not lose or repeat the carried exposure check.
  restored.setSpeed(0);
  restored.tick(0.5);
  career = restored.exportState().career;
  assert.equal(career.objectives.find((objective) => objective.id === 'obj_2_3')?.completed, true);
  assert.equal(career.reputation, 40);
});

test('Margin cushion and forced liquidation trigger on maintenance breach', () => {
  // Margin unlocked: $100,000 capital, 2x leverage enabled
  const portfolio = new PortfolioEngine(100000, true, true);

  // Buy $180,000 worth of shares (borrowing $80,000)
  portfolio.executeFill({
    orderId: 'margin_trade_1',
    ticker: 'VCRX',
    side: 'buy',
    shares: 1500,
    price: 120.0, // $180,000
    commission: 10.0,
    slippageDollars: 0,
    timestamp: 1000,
  });

  // Price drops severely from $120 to $65
  // Market value drops from $180,000 to $97,500
  // Unrealized loss = -$82,500
  // Net Liquidation Value = ~$17,500
  // Maintenance Requirement (25% of $97,500) = $24,375
  // Net Equity ($17,500) < Maintenance ($24,375) -> Margin Breached!
  portfolio.updateMarketPrices(new Map([['VCRX', 65.0]]));

  const risk = portfolio.calculateRiskMetrics(COMPANY_MAP);
  assert.equal(risk.netLiquidationValue, 17490);
  assert.equal(risk.maintenanceMarginRequirement, 24375);
  assert.equal(risk.marginCushionPercent, -28.2);
  assert.equal(risk.buyingPower, 0);
  assert.equal(portfolio.exportState().maxDrawdownPercent, 82.5);
  assert.ok(risk.isMarginBreached, 'Margin must be flagged as breached when equity falls below maintenance requirement');

  // Broker executes forced liquidation of the loser
  const liquidation = portfolio.liquidateLargestLoser(new Map([['VCRX', 65.0]]), 2000);
  assert.ok(liquidation !== null, 'Liquidation must be performed');
  assert.equal(liquidation?.liquidatedTicker, 'VCRX');
  assert.equal(portfolio.getPositions().length, 0, 'Liquidated position must be closed');
});

test('PricingEngine per-symbol Poisson update rates and staggered phase offsets', () => {
  const rng = new SeededRNG('TEST_POISSON_SEED');
  const pricing = new PricingEngine(rng, COMPANIES);

  const states = pricing.getAllStates();
  assert.equal(states.length, 48);

  for (const s of states) {
    // Base rate at 1x must strictly be between 0.4 and 1.5 updates per second
    assert.ok(s.baseLambda >= 0.4, `Symbol ${s.ticker} baseLambda ${s.baseLambda} must be >= 0.4`);
    assert.ok(s.baseLambda <= 1.5, `Symbol ${s.ticker} baseLambda ${s.baseLambda} must be <= 1.5`);
  }

  // Mega-caps must have higher average lambda than small-caps
  const megaLambdas = states.filter(s => {
    const comp = COMPANIES.find(c => c.ticker === s.ticker);
    return comp?.marketCapTier === 'mega';
  }).map(s => s.baseLambda);

  const smallLambdas = states.filter(s => {
    const comp = COMPANIES.find(c => c.ticker === s.ticker);
    return comp?.marketCapTier === 'small';
  }).map(s => s.baseLambda);

  const avgMega = megaLambdas.reduce((a, b) => a + b, 0) / megaLambdas.length;
  const avgSmall = smallLambdas.reduce((a, b) => a + b, 0) / smallLambdas.length;

  assert.ok(avgMega > avgSmall, `Mega-cap avg lambda (${avgMega}) must exceed small-cap avg lambda (${avgSmall})`);

  // Run a single small tick (50ms at 1x)
  const updatedMap = pricing.stepTick(COMPANIES, 0.2, 0.05, 0.05 * 65, new Map(), 1);

  // In a 50ms tick at 1x, NOT all 48 symbols should update simultaneously
  assert.ok(updatedMap.size < 48, `Single tick must update a staggered subset of symbols, got ${updatedMap.size} of 48`);
});

test('Price comparison quantizes to $0.01 tick size without sub-cent flicker', () => {
  // Test quantization logic
  const roundPrice = (p: number) => Math.round(p * 100) / 100;

  const initial = 142.50;
  const subCentMove = 142.502; // +0.002
  assert.equal(roundPrice(subCentMove), initial, 'Sub-cent delta must quantize to identical price');

  const fullCentMove = 142.51;
  assert.equal(roundPrice(fullCentMove), 142.51, 'Full cent move must quantize to next cent');
});

test('Watchlist price cell throttle cooldown scales properly with simulation speed', () => {
  const getCooldown = (speed: number) => (speed >= 20 ? 700 : speed >= 5 ? 1000 : 1500);

  assert.equal(getCooldown(1), 1500, '1x speed cooldown must be 1500ms');
  assert.equal(getCooldown(5), 1000, '5x speed cooldown must be 1000ms');
  assert.equal(getCooldown(20), 700, '20x speed cooldown must be 700ms');
});

test('Simulation output is strictly reproducible for the same seed with the new cadence', () => {
  const engine1 = new MarketSimulationEngine('CADENCE_REPRO_SEED', 100000);
  const engine2 = new MarketSimulationEngine('CADENCE_REPRO_SEED', 100000);

  // Run both engines for 30 ticks across various speeds
  for (let i = 0; i < 15; i++) {
    engine1.tick(100);
    engine2.tick(100);
  }

  engine1.setSpeed(5);
  engine2.setSpeed(5);

  for (let i = 0; i < 15; i++) {
    engine1.tick(100);
    engine2.tick(100);
  }

  const snap1 = engine1.getSnapshot();
  const snap2 = engine2.getSnapshot();

  assert.deepEqual(
    snap1.prices.map((p: any) => ({ ticker: p.ticker, price: p.price, volume: p.volume, dir: p.direction, lastMove: p.lastMoveDirection })),
    snap2.prices.map((p: any) => ({ ticker: p.ticker, price: p.price, volume: p.volume, dir: p.direction, lastMove: p.lastMoveDirection })),
    'Both engines initialized with the same seed must produce identical price and cadence snapshots'
  );
});

test('Engine state survives a JSON round trip and resumes identically', () => {
  const priceRow = (e: MarketSimulationEngine) =>
    e.getSnapshot().prices.map((p: any) => ({ ticker: p.ticker, price: p.price, volume: p.volume }));

  const engine = new MarketSimulationEngine('SAVE_ROUND_TRIP', 100000);
  for (let i = 0; i < 40; i++) engine.tick(100);

  const exported = engine.exportState();
  const wire = JSON.parse(JSON.stringify(exported)) as typeof exported;

  const restored = new MarketSimulationEngine('SAVE_ROUND_TRIP', 100000);
  restored.importState(wire);

  assert.deepEqual(priceRow(restored), priceRow(engine), 'Restored engine must match the source immediately after import');

  for (let i = 0; i < 40; i++) {
    engine.tick(100);
    restored.tick(100);
  }

  assert.deepEqual(priceRow(restored), priceRow(engine), 'Restored engine must keep producing the identical sequence');
  assert.equal(restored.getSnapshot().riskMetrics.netLiquidationValue, engine.getSnapshot().riskMetrics.netLiquidationValue);
});
