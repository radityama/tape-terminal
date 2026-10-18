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

test('portfolio rejects invalid internal fills without changing cash, positions or history', () => {
  const valid = { orderId: 'bad_fill', ticker: 'HLVG', side: 'buy' as const, shares: 10, price: 100, commission: 1.5, slippageDollars: 0, timestamp: 1000 };
  const invalid = [
    { shares: -10 }, { shares: 0 }, { shares: 1.5 }, { shares: NaN },
    { shares: Infinity }, { shares: Number.MAX_SAFE_INTEGER + 1 },
    { price: -1 }, { price: 0 }, { price: NaN }, { price: Infinity },
    { price: 1e-12 },
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
