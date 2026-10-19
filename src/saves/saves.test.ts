import { test } from 'vitest';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { MarketSimulationEngine } from '../engine/market.ts';
import { COMPANY_MAP } from '../data/companies.ts';
import { SaveGame, SaveGameSchema, SCHEMA_VERSION, decimalStringFromNumber, summarizeIssues } from './schema.ts';
import { consumeSaveRepairs, migrate, SaveVersionError, rawSchemaVersion } from './migrations.ts';

function makeSave(engine: MarketSimulationEngine, seed: string): SaveGame {
  const snapshot = engine.getSnapshot();
  const now = 1700000000000;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'slot_1',
    slot: 1,
    name: 'Career',
    seed,
    mode: 'career',
    scenarioId: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    seq: 1,
    deviceId: 'test-device',
    summary: {
      rank: (snapshot.career as { rank?: { name?: string } } | undefined)?.rank?.name ?? null,
      equity: snapshot.riskMetrics.netLiquidationValue,
      simDay: snapshot.simDay,
    },
    game: engine.exportState(),
  };
}

type WireSave = Parameters<typeof SaveGameSchema.decode>[0];

function wireOf(save: SaveGame): WireSave {
  return JSON.parse(JSON.stringify(SaveGameSchema.encode(save)));
}

test('save round trips through the codec with money kept as decimal strings', () => {
  const engine = new MarketSimulationEngine('SCHEMA_ROUND_TRIP', 100000);
  for (let i = 0; i < 30; i++) engine.tick(100);
  engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 120 });

  const save = makeSave(engine, 'SCHEMA_ROUND_TRIP');
  const wire = wireOf(save);
  const decoded = SaveGameSchema.decode(wire);

  // Encoding is idempotent, so a second pass must be byte-for-byte stable.
  assert.deepEqual(wireOf(decoded), wire);

  // Money and decimals must never be floats on the wire.
  const w = wire as unknown as { summary: { equity: string }; game: { portfolio: { cash: string }; pricing: { states: Array<{ price: string }> } } };
  assert.equal(typeof w.summary.equity, 'string');
  assert.equal(typeof w.game.portfolio.cash, 'string');
  assert.equal(typeof w.game.pricing.states[0].price, 'string');
});

test('same seed and same actions reproduce identical state after save and load', () => {
  const priceRow = (e: MarketSimulationEngine) =>
    e.getSnapshot().prices.map((p) => ({ ticker: p.ticker, price: p.price, volume: p.volume }));

  const engine = new MarketSimulationEngine('REPRO_SAVE', 100000);
  for (let i = 0; i < 25; i++) engine.tick(100);
  engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 100 });
  engine.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'limit', quantity: 50, limitPrice: 10 });
  for (let i = 0; i < 10; i++) engine.tick(100);

  const loaded = SaveGameSchema.decode(wireOf(makeSave(engine, 'REPRO_SAVE')));
  const restored = new MarketSimulationEngine(loaded.seed, 100000);
  restored.importState(loaded.game);

  assert.deepEqual(priceRow(restored), priceRow(engine), 'restored state must match immediately after load');

  for (let i = 0; i < 30; i++) {
    engine.tick(100);
    restored.tick(100);
  }

  assert.deepEqual(priceRow(restored), priceRow(engine), 'restored engine must keep producing the identical sequence');
  assert.deepEqual(
    restored.getSnapshot().openOrders.map((o) => o.id).sort(),
    engine.getSnapshot().openOrders.map((o) => o.id).sort(),
    'open orders must survive the round trip'
  );
});

test('v1 saves keep historical risk fields and wire values while restored equity uses marked value once', () => {
  const engine = new MarketSimulationEngine('G1_LEGACY_EQUITY', 10000);
  const state = engine.exportState();
  state.portfolio.cash = '9000';
  state.portfolio.positions = [{
    ticker: 'HLVG', shares: 10, averageEntryPrice: 100, currentPrice: 110,
    marketValue: 1100, costBasis: 1000, unrealizedPnl: 100,
    unrealizedPnlPercent: 10, entryTimestamp: 1000, borrowFeeAccumulated: 0,
  }];
  state.portfolio.peakEquity = '10200';
  state.portfolio.maxDrawdownPercent = 5;
  engine.importState(state);
  const save = makeSave(engine, 'G1_LEGACY_EQUITY');
  assert.equal(save.summary.equity, 10100, 'new save summaries use corrected marked equity');
  save.summary.equity = 10200; // Historical summary from the double-counted accounting rule.
  const wire = wireOf(save);
  const decoded = SaveGameSchema.decode(wire);
  assert.deepEqual(wireOf(decoded), wire, 'reading the v1 wire format must not rewrite its original fields');

  const restored = new MarketSimulationEngine(decoded.seed, 10000);
  restored.importState(decoded.game);
  assert.deepEqual(restored.exportState().portfolio, decoded.game.portfolio, 'historical peak and drawdown are preserved, not guessed');
  assert.equal(restored.getSnapshot().riskMetrics.netLiquidationValue, 10100);
  assert.equal(restored.exportState().portfolio.peakEquity, '10200');
});

test('legacy invalid pending orders remain recoverable but cannot fill after import', () => {
  const engine = new MarketSimulationEngine('G0_LEGACY_ORDER', 100000);
  const placed = engine.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'limit', quantity: 2, limitPrice: 100000 });
  assert.equal(placed.success, true);
  const second = engine.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'stop_limit', quantity: 2, stopPrice: 1, limitPrice: 100000 });
  assert.equal(second.success, true);
  const wire = wireOf(makeSave(engine, 'G0_LEGACY_ORDER'));
  const orders = (wire as unknown as { game: { openOrders: Array<{ quantity: number; limitPrice?: string; status: string; filledQuantity: number }> } }).game.openOrders;
  orders[0].quantity = -10;
  delete orders[1].limitPrice;
  orders[1].status = 'partially_filled';
  orders[1].filledQuantity = 1;

  const loaded = SaveGameSchema.decode(wire);
  assert.deepEqual(wireOf(loaded), wire, 'old save fields must round-trip without normalizing the invalid order');

  const restored = new MarketSimulationEngine(loaded.seed, 100000);
  restored.importState(loaded.game);
  const before = restored.exportState();
  restored.tick(0.05);

  assert.deepEqual(restored.exportState().openOrders, before.openOrders, 'invalid pending order is kept, not executed or rewritten');
  assert.deepEqual(restored.exportState().portfolio, before.portfolio, 'invalid pending order cannot debit cash or create a trade');
  restored.skipToNextDay();
  assert.deepEqual(restored.exportState().openOrders, before.openOrders, 'invalid DAY orders remain recoverable after the trading day');
  assert.equal(restored.cancelOrder(placed.orderId!), true, 'player can dismiss the bad order');
  assert.equal(restored.cancelOrder(second.orderId!), true);
  assert.equal(restored.placeOrder({ ticker: 'HLVG', side: 'buy', type: 'market', quantity: 2 }).success, true);
});

test('a saved partial order retains its progress and only fills its residual quantity', () => {
  const engine = new MarketSimulationEngine('G0_SAVED_PARTIAL', 1000000);
  assert.equal(engine.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'market', quantity: 997 }).success, true);
  assert.equal(engine.placeOrder({ ticker: 'VCRX', side: 'buy', type: 'limit', quantity: 1000, limitPrice: 1000 }).success, true);
  const wire = wireOf(makeSave(engine, 'G0_SAVED_PARTIAL'));
  const pending = (wire as unknown as { game: { openOrders: Array<{ status: string; filledQuantity: number; commissionPaid: string }> } }).game.openOrders[0];
  pending.status = 'partially_filled';
  pending.filledQuantity = 997;
  pending.commissionPaid = '1.5';
  const loaded = SaveGameSchema.decode(wire);
  assert.deepEqual(wireOf(loaded), wire);

  const restored = new MarketSimulationEngine(loaded.seed, 1000000);
  restored.importState(loaded.game);
  restored.tick(0.05);
  assert.equal(restored.getSnapshot().recentTrades[0].shares, 3);
  assert.equal(restored.getSnapshot().positions.find((position) => position.ticker === 'VCRX')?.shares, 1000);
});

test('corrupted or tampered payloads are rejected without crashing', () => {
  const engine = new MarketSimulationEngine('CORRUPT', 100000);
  for (let i = 0; i < 5; i++) engine.tick(100);
  const wire = wireOf(makeSave(engine, 'CORRUPT')) as Record<string, unknown>;
  const badMoney = structuredClone(wire);
  (badMoney.game as { portfolio: { cash: unknown } }).portfolio.cash = 'not-a-number';
  assert.equal(SaveGameSchema.safeParse(badMoney).success, false, 'non-numeric money must be rejected');

  const missing = structuredClone(wire);
  delete (missing.game as { pricing?: unknown }).pricing;
  assert.equal(SaveGameSchema.safeParse(missing).success, false, 'missing required blocks must be rejected');

  const wrongSlot = structuredClone(wire);
  (wrongSlot as { slot: number }).slot = 9;
  assert.equal(SaveGameSchema.safeParse(wrongSlot).success, false, 'slot must stay within 1..3');

  assert.equal(SaveGameSchema.safeParse({}).success, false, 'an empty object must be rejected');
  assert.equal(SaveGameSchema.safeParse(null).success, false, 'null must be rejected');
});

test('a save written by a newer version is refused, not guessed at', () => {
  assert.throws(() => migrate({ schemaVersion: SCHEMA_VERSION + 1 }), SaveVersionError);
  try {
    migrate({ schemaVersion: SCHEMA_VERSION + 3 });
    assert.fail('expected SaveVersionError');
  } catch (err) {
    assert.ok(err instanceof SaveVersionError);
    assert.equal(err.found, SCHEMA_VERSION + 3);
  }
});

test('a legacy save with no schemaVersion migrates up to the current version', () => {
  const legacy = {
    id: 'slot_2',
    name: 'Old Run',
    seed: 'LEGACY_SEED',
    simDay: 7,
    mode: 'career',
    equity: 120000,
    cash: 40000,
    savedAt: 1700000000000,
    positionsJson: '[]',
    tradesJson: '[]',
    careerJson: '{}',
  };

  assert.equal(rawSchemaVersion(legacy), 0);

  const parsed = SaveGameSchema.safeParse(migrate(legacy));
  assert.equal(parsed.success, true);

  if (parsed.success) {
    assert.equal(parsed.data.schemaVersion, SCHEMA_VERSION);
    assert.equal(parsed.data.slot, 2);
    assert.equal(parsed.data.name, 'Old Run');
    assert.equal(parsed.data.seed, 'LEGACY_SEED');
    assert.equal(parsed.data.mode, 'career');
    assert.equal(parsed.data.summary.equity, 120000);
    assert.equal(parsed.data.game.pricing.states.length, 48);
  }
});

test('migrate is a no-op for a save already at the current version', () => {
  const engine = new MarketSimulationEngine('NOOP', 100000);
  const wire = wireOf(makeSave(engine, 'NOOP')) as Record<string, unknown>;
  const once = migrate(wire);
  const twice = migrate(once);
  assert.deepEqual(twice, once);
  assert.equal(rawSchemaVersion(twice), SCHEMA_VERSION);
});

test('decimals are fixed point and never scientific notation', () => {
  assert.equal(decimalStringFromNumber(0.1 + 0.2), '0.3');
  assert.equal(decimalStringFromNumber(151.7), '151.7');
  assert.equal(decimalStringFromNumber(-0), '0');
  assert.throws(() => decimalStringFromNumber(1e54), /out-of-range/);
  assert.throws(() => decimalStringFromNumber(Infinity), /non-finite/);

  const engine = new MarketSimulationEngine('FIXED_POINT', 100000);
  for (let i = 0; i < 10; i++) engine.tick(100);
  const wire = wireOf(makeSave(engine, 'FIXED_POINT'));
  const serialized = JSON.stringify(wire);
  const decimalFields = serialized.match(/-?\d+(\.\d+)?[eE][+-]?\d+/g);
  assert.equal(decimalFields, null, `money must never be written with an exponent: ${decimalFields?.[0]}`);

  const bad = structuredClone(wire) as Record<string, unknown>;
  (bad.game as { pricing: { states: Array<{ price: unknown }> } }).pricing.states[0].price = '1e54';
  assert.equal(SaveGameSchema.safeParse(bad).success, false, 'an exponent decimal must be rejected');
});

test('validation errors report at most five issues plus a count', () => {
  const error = new z.ZodError(
    Array.from({ length: 7 }, (_, i) => ({ code: 'custom' as const, message: `issue ${i}`, path: [`field_${i}`] }))
  );
  const summary = summarizeIssues(error);
  assert.equal(summary.match(/issue \d/g)?.length, 5);
  assert.ok(summary.endsWith('(+2 more issues)'));
});

test('old saves with absurd prices are repaired on load and reported once', () => {
  consumeSaveRepairs();
  const engine = new MarketSimulationEngine('OVERFLOW_REPAIR', 100000);
  const wire = wireOf(makeSave(engine, 'OVERFLOW_REPAIR')) as Record<string, unknown>;
  const states = (wire.game as { pricing: { states: Array<Record<string, unknown>> } }).pricing.states;
  const firstTicker = String(states[0].ticker);
  const secondTicker = String(states[1].ticker);
  states[0].price = 1e54;
  states[1].price = '1.4e54';
  states[2].price = Number.POSITIVE_INFINITY;

  const parsed = SaveGameSchema.safeParse(migrate(wire));
  assert.equal(parsed.success, true, 'a save from the bug era must still load');
  const repaired = consumeSaveRepairs();
  assert.deepEqual([...repaired].sort(), [firstTicker, secondTicker, String(states[2].ticker)].sort());
  assert.deepEqual(consumeSaveRepairs(), [], 'repairs are reported once');

  if (parsed.success) {
    const pricing = parsed.data.game.pricing.states;
    for (const ticker of repaired) {
      const state = pricing.find((s) => s.ticker === ticker);
      const fairValue = COMPANY_MAP.get(ticker)?.fundamentals.fairValue;
      assert.equal(state?.price, fairValue, `${ticker} must reset to fair value`);
    }
  }
});
