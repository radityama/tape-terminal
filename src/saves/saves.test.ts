import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MarketSimulationEngine } from '../engine/market.ts';
import { SaveGame, SaveGameSchema, SCHEMA_VERSION } from './schema.ts';
import { migrate, SaveVersionError, rawSchemaVersion } from './migrations.ts';

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
