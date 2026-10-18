import 'fake-indexeddb/auto';
import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { MarketSimulationEngine } from '../engine/market';
import { SaveGame, SCHEMA_VERSION } from './schema';
import { db, LocalSaveStore, SaveCorruptError, SaveVersionError } from './localStore';

const store = new LocalSaveStore();

function save(slot: number): SaveGame {
  const engine = new MarketSimulationEngine('LOCAL_TEST');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `slot_${slot}`,
    slot,
    name: 'Career',
    seed: engine.seed,
    mode: 'career',
    scenarioId: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: 1,
    seq: 1,
    deviceId: 'test-device',
    summary: { rank: 'Intern', equity: 100000, simDay: 1 },
    game: engine.exportState(),
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

test('put, get, list, revision, conflict and delete', async () => {
  const first = save(1);
  assert.deepEqual(await store.put(first), { ok: true, revision: 1 });
  assert.equal((await store.get(1))?.game.seed, 'LOCAL_TEST');
  assert.equal((await store.list())[0].slot, 1);

  assert.deepEqual(await store.put({ ...first, name: 'Updated' }, { expectedRevision: 1 }), { ok: true, revision: 2 });
  assert.equal((await store.get(1))?.revision, 2);
  assert.deepEqual(await store.put(first, { expectedRevision: 1 }), { ok: false, reason: 'conflict', remoteRevision: 2 });

  await store.delete(1);
  assert.equal(await store.get(1), null);
  assert.deepEqual(await store.list(), []);
});

test('legacy migration preserves raw backups, capped at three per slot', async () => {
  for (let i = 1; i <= 4; i++) {
    await db.savedGames.put({
      id: 'slot_2', name: `Old ${i}`, seed: 'LEGACY', mode: 'career',
      equity: 100000 + i, simDay: i, savedAt: 1700000000000 + i,
    });
    assert.equal((await store.get(2))?.name, `Old ${i}`);
  }

  const backups = await db.backups.where('slot').equals(2).sortBy('savedAt');
  assert.equal(backups.length, 3);
  assert.deepEqual(backups.map((row) => JSON.parse(row.payload).name).sort(), ['Old 2', 'Old 3', 'Old 4']);
});

test('corrupted and newer saves stay in IndexedDB after a failed load', async () => {
  await db.savedGames.put({ id: 'slot_1', name: 'Damaged', seed: 'x', mode: 'career', payload: '{' });
  await assert.rejects(store.get(1), SaveCorruptError);
  assert.equal((await db.savedGames.get('slot_1'))?.payload, '{');

  const newer = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 });
  await db.savedGames.put({ id: 'slot_1', name: 'Future', seed: 'x', mode: 'career', payload: newer });
  await assert.rejects(store.get(1), SaveVersionError);
  assert.equal((await db.savedGames.get('slot_1'))?.payload, newer);
});

test('unreadable and future records remain occupied and raw exportable', async () => {
  await db.savedGames.put({ id: 'slot_1', name: 'Damaged', seed: 'x', mode: 'career', payload: '{' });
  await db.savedGames.put({ id: 'slot_2', name: 'Future', seed: 'x', mode: 'career', payload: JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }) });
  const slots = await store.inspectSlots();
  assert.deepEqual(slots.map(({ meta, health }) => [meta.slot, health]), [[1, 'corrupt'], [2, 'unsupported_version']]);
  assert.equal((await store.list()).length, 2);
  assert.equal(await store.exportRaw(1), '{');
  assert.equal((await store.put(save(1), { force: true })).ok, false);
  assert.equal((await db.savedGames.get('slot_1'))?.payload, '{');
});

test('inspection distinguishes verified emptiness from a storage read error', async () => {
  assert.deepEqual(await store.inspectSlot(3), { status: 'empty' });
  const failure = vi.spyOn(db.savedGames, 'get').mockRejectedValueOnce(new Error('IndexedDB unavailable'));
  assert.deepEqual(await store.inspectSlot(3), { status: 'read_error' });
  failure.mockRestore();
});
