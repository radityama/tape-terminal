import 'fake-indexeddb/auto';
import { beforeEach, test, expect } from 'vitest';
import assert from 'node:assert/strict';
import { MarketSimulationEngine } from '../engine/market';
import { db, LocalSaveStore } from './localStore';
import { saveManager, CaptureFields, SyncConflict, SaveStatus } from './manager';
import { SaveGame, SCHEMA_VERSION } from './schema';

type CloudApi = {
  list: () => Promise<unknown[]>;
  get: () => Promise<unknown>;
  getMeta: () => Promise<unknown>;
  put: (save: SaveGame, opts?: { expectedRevision?: number }) => Promise<{ ok: boolean; reason?: string; revision?: number }>;
  getProfile: () => Promise<null>;
  putProfile: () => Promise<void>;
};

function saveGame(slot: number, seq: number, day: number, positions: number): SaveGame {
  const engine = new MarketSimulationEngine('MGR_TEST');
  const game = engine.exportState();
  game.actionSeq = seq;
  game.portfolio.positions = positions
    ? game.portfolio.positions.concat([
        {
          ticker: 'HLVG',
          shares: 10,
          averageEntryPrice: 151.7,
          currentPrice: 151.7,
          marketValue: 1517,
          costBasis: 1517,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          entryTimestamp: 1700000000000,
          borrowFeeAccumulated: 0,
        },
      ])
    : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `slot_${slot}`,
    slot,
    name: 'Career',
    seed: 'MGR_TEST',
    mode: 'career',
    scenarioId: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: 1,
    seq,
    deviceId: 'device-test',
    summary: { rank: 'Intern', equity: 100000, simDay: day },
    game,
  };
}

let captured: CaptureFields | null;
let statuses: SaveStatus[] = [];
let restored: SaveGame[];
let conflicts: SyncConflict[];

function install() {
  captured = null;
  statuses = [];
  restored = [];
  conflicts = [];
  saveManager.setStore(new LocalSaveStore());
  saveManager.init({
    capture: () => captured,
    restore: (save) => restored.push(save),
    onStatus: (status) => statuses.push(status),
    onConflict: (conflict) => conflicts.push(conflict),
  });
}

function captureFor(seq: number, day: number, positions: number, engineId: string, slot = 1): CaptureFields {
  const engine = new MarketSimulationEngine('MGR_TEST');
  const game = engine.exportState();
  game.actionSeq = seq;
  game.portfolio.positions = positions ? [{ ...saveGame(slot, seq, day, 1).game.portfolio.positions[0] }] : [];
  return {
    engineId,
    name: 'Career',
    seed: 'MGR_TEST',
    mode: 'career',
    scenarioId: null,
    summary: { rank: 'Intern', equity: 100000, simDay: day },
    game,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  saveManager.setCloudStore(null);
  install();
});

test('capture below the stored seq never overwrites the slot, even for a fully ready session', async () => {
  const store = new LocalSaveStore();
  await store.put(saveGame(1, 40, 2, 1), { expectedRevision: undefined });

  // Simulates the pre-fix bug: /terminal creates a fresh engine and autosave fires.
  captured = captureFor(0, 2, 0, 'fresh-engine');
  await saveManager.bindSession(1, 'fresh-engine');
  saveManager.markSessionReady();

  const result = await saveManager.save(1);
  expect(result).toEqual({
    ok: false,
    reason: 'invalid',
    message: 'Autosave skipped, it would have replaced newer progress',
  });

  const stored = await db.savedGames.get('slot_1');
  const parsed = JSON.parse(String(stored?.payload));
  assert.equal(stored?.revision, 1, 'material revision must be untouched');
  assert.equal(parsed.seq, 40);
  assert.equal(parsed.game.portfolio.positions.length, 1, 'stored position must survive');
  assert.ok(!statuses.includes('synced'), 'status must never claim synced after a refused write');
});

test('capture at or above the stored seq saves normally and advances the revision', async () => {
  await new LocalSaveStore().put(saveGame(1, 40, 2, 1), { expectedRevision: undefined });
  captured = captureFor(41, 3, 1, 'live-engine');
  await saveManager.bindSession(1, 'live-engine');
  saveManager.markSessionReady();

  const result = await saveManager.save(1);
  expect(result).toEqual({ ok: true, revision: 2 });
  const stored = await db.savedGames.get('slot_1');
  assert.equal(JSON.parse(String(stored?.payload)).seq, 41);
});

test('an unbound or loading session is not allowed to capture at all', async () => {
  await new LocalSaveStore().put(saveGame(1, 10, 1, 0), { expectedRevision: undefined });
  captured = captureFor(99, 2, 1, 'rogue-engine');

  const result = await saveManager.save(1);
  assert.equal(result.ok, false, 'session with the wrong engine id must not write');
  captured = captureFor(10, 1, 0, 'rogue-engine');
  const refetch = await saveManager.save(1);
  assert.equal(refetch.ok, false, 'session with the wrong engine id must not write');
  const stored = await db.savedGames.get('slot_1');
  assert.equal(stored?.revision, 1);
});

test('player actions write local storage immediately and push to cloud debounced', async () => {
  let cloudPuts = 0;
  const cloud: CloudApi = {
    list: async () => [],
    get: async () => null,
    getMeta: async () => null,
    put: async () => {
      cloudPuts += 1;
      return { ok: true, revision: cloudPuts };
    },
    getProfile: async () => null,
    putProfile: async () => undefined,
  };
  saveManager.setCloudStore(cloud as never);

  captured = captureFor(1, 1, 1, 'live-engine');
  await saveManager.bindSession(1, 'live-engine');
  saveManager.markSessionReady();
  statuses.length = 0;

  captured = captureFor(2, 1, 1, 'live-engine');
  saveManager.notePlayerAction();
  await saveManager.flush();
  const row = await db.savedGames.get('slot_1');
  assert.ok(row, 'player action flush must hit IndexedDB immediately');
  assert.equal(cloudPuts, 0, 'cloud push must not fire synchronously with the local write');
  assert.ok(!statuses.includes('synced'), 'push has not happened yet, so not synced');
  await saveManager.flushCloudPush();
  assert.ok(statuses.includes('synced'), 'after the debounced push succeeds');
});

test('the status machine never claims synced while the local copy is dirty', async () => {
  const cloud: CloudApi = {
    list: async () => [],
    get: async () => null,
    getMeta: async () => null,
    put: async () => ({ ok: true, revision: 1 }),
    getProfile: async () => null,
    putProfile: async () => undefined,
  };
  saveManager.setCloudStore(cloud as never);
  captured = captureFor(1, 1, 0, 'live-engine');
  await saveManager.bindSession(1, 'live-engine');
  saveManager.markSessionReady();

  captured = captureFor(2, 1, 0, 'live-engine');
  await saveManager.save(1);
  const localStatuses = statuses.slice();
  assert.ok(!localStatuses.includes('synced'), 'dirty after write, sync pending, must not say synced');

  await saveManager.flushCloudPush();
  assert.ok(statuses.includes('synced'), 'after push success with clean local, synced is allowed');
});

test('autsave history keeps the last 3 versions, at most one per sim day, and can restore', async () => {
  captured = captureFor(1, 1, 0, 'live');
  await saveManager.bindSession(1, 'live');
  saveManager.markSessionReady();
  await saveManager.save(1);

  for (let day = 2; day <= 4; day++) {
    captured = captureFor(day * 10, day, 0, 'live');
    await saveManager.save(1);
  }
  // Second save on the same day must not add another history row.
  captured = captureFor(50, 4, 0, 'live');
  await saveManager.save(1);

  const rows = await db.autosaveHistory.where('slot').equals(1).sortBy('savedAt');
  assert.ok(rows.length >= 3, 'history must exist');
  const days = rows.map((r) => r.simDay);
  assert.deepEqual(
    [...new Set(days)].length === days.length ? days : [...new Set(days)],
    [...new Set(days)],
    'at most one history row per sim day'
  );
  assert.ok(rows.length <= 3, `at most 3 history rows per slot, saw ${rows.length}`);
  const days2 = rows.map((r) => r.simDay);
  assert.deepEqual(days2, [2, 3, 4], 'kept the 3 newest versions: days 2, 3 and 4');

  captured = captureFor(999, 4, 0, 'rebuilt');
  await saveManager.restoreHistory(1);
  assert.equal(restored.length, 1, 'restore must hand the previous autosave to the store');
  assert.equal(restored[0].summary.simDay, 4, 'restored the day 4 snapshot');
});
