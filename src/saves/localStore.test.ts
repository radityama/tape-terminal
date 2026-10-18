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

test('ordinary writes cannot replace unreadable or future saves, even with a matching revision', async () => {
  for (const [payload, revision] of [['{', 0], [JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }), 5]] as const) {
    await db.savedGames.put({ id: 'slot_1', name: 'Protected', seed: 'x', mode: 'career', payload, revision });
    for (const options of [{ expectedRevision: revision }, { expectedRevision: revision, force: true }]) {
      const result = await store.put(save(1), options);
      assert.equal(result.ok, false);
      assert.equal((await db.savedGames.get('slot_1'))?.payload, payload);
    }
  }
});

test('a missing row rejects a stale nonzero expected revision', async () => {
  assert.deepEqual(await store.put(save(1), { expectedRevision: 5 }), { ok: false, reason: 'conflict', remoteRevision: 0 });
  assert.deepEqual(await store.inspectSlot(1), { status: 'empty' });
  assert.deepEqual(await store.put(save(1), { expectedRevision: 0 }), { ok: true, revision: 1 });
});

test.each([1, 5, 101])('confirmed replacement advances revision %i and backs up the exact original payload', async (revision) => {
  const original = save(1);
  await db.savedGames.put({
    id: 'slot_1', slot: 1, name: original.name, seed: original.seed, mode: original.mode,
    revision, payload: JSON.stringify({ ...original, revision }),
  });
  const raw = (await db.savedGames.get('slot_1'))?.payload;
  assert.deepEqual(await store.replace({ ...original, name: 'New career' }, revision), { ok: true, revision: revision + 1 });
  assert.equal((await store.get(1))?.revision, revision + 1);
  assert.equal((await db.backups.where('slot').equals(1).first())?.payload, raw);
  assert.deepEqual(await store.replace(original, revision), { ok: false, reason: 'conflict', remoteRevision: revision + 1 });
  assert.equal((await store.get(1))?.name, 'New career');
});

test('a failed replacement transaction leaves the original row and backups unchanged', async () => {
  await store.put(save(1));
  const original = await db.savedGames.get('slot_1');
  const failedPut = vi.spyOn(db.savedGames, 'put').mockRejectedValueOnce(new Error('write failed'));
  await assert.rejects(store.replace({ ...save(1), name: 'New career' }, 1), /write failed/);
  failedPut.mockRestore();
  assert.deepEqual(await db.savedGames.get('slot_1'), original);
  assert.equal(await db.backups.where('slot').equals(1).count(), 0);
});
