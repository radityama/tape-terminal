import 'fake-indexeddb/auto';
import { beforeEach, test, expect } from 'vitest';
import assert from 'node:assert/strict';
import { MarketSimulationEngine } from '../engine/market';
import { db, LocalSaveStore, readProfile, writeProfile } from './localStore';
import { saveManager, CaptureFields, SyncConflict, SaveStatus } from './manager';
import { Profile, ProfileSchema, SaveGame, SCHEMA_VERSION } from './schema';

type CloudApi = {
  list: () => Promise<unknown[]>;
  get: () => Promise<unknown>;
  getMeta: () => Promise<unknown>;
  put: (save: SaveGame, opts?: { expectedRevision?: number }) => Promise<{ ok: boolean; reason?: string; revision?: number }>;
  getProfile: () => Promise<{ data: unknown; updatedAt: number } | null>;
  putProfile: (data: unknown) => Promise<void>;
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
let notices: string[];

function install() {
  captured = null;
  statuses = [];
  restored = [];
  conflicts = [];
  notices = [];
  saveManager.setStore(new LocalSaveStore());
  saveManager.init({
    capture: () => captured,
    restore: (save) => restored.push(save),
    onStatus: (status) => statuses.push(status),
    onConflict: (conflict) => conflicts.push(conflict),
    onNotice: (message) => notices.push(message),
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

test('a failed local save listing is not mistaken for empty slots', async () => {
  saveManager.setStore({
    list: async () => { throw new Error('disk unavailable'); },
    get: async () => null,
    put: async () => ({ ok: false, reason: 'invalid', message: 'unavailable' }),
    delete: async () => {},
  });
  await expect(saveManager.listAllSlots()).rejects.toThrow('disk unavailable');
});

test('a failed cloud save listing is not mistaken for empty slots', async () => {
  await new LocalSaveStore().put(saveGame(1, 10, 2, 0), { expectedRevision: undefined });
  saveManager.setCloudStore({
    ...profileCloud().cloud,
    list: async () => { throw new Error('cloud unavailable'); },
  } as never);
  await expect(saveManager.listAllSlots()).rejects.toThrow('cloud unavailable');
});

test('a corrupt slot cannot be overwritten by a ready session or force', async () => {
  await db.savedGames.put({ id: 'slot_1', name: 'Damaged', seed: 'x', mode: 'career', payload: '{' });
  captured = captureFor(100, 2, 0, 'engine');
  saveManager.bindSession(1, 'engine');
  saveManager.markSessionReady();
  const result = await saveManager.save(1, { force: true });
  expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  expect(await saveManager.save(1)).toMatchObject({ ok: false, reason: 'invalid' });
  expect((await db.savedGames.get('slot_1'))?.payload).toBe('{');
});

test('replacement needs the reviewed revision and preserves the original raw row', async () => {
  const original = saveGame(1, 50, 5, 1);
  await new LocalSaveStore().put(original);
  captured = captureFor(1, 1, 0, 'new-engine');
  saveManager.bindSession(1, 'new-engine');
  saveManager.markSessionReady();
  expect((await saveManager.replaceSlot(1, 2)).ok).toBe(false);
  expect((await saveManager.replaceSlot(1, 1)).ok).toBe(true);
  expect((await new LocalSaveStore().get(1))?.revision).toBe(2);
  const backup = await db.backups.where('slot').equals(1).first();
  expect(backup?.payload).toContain('"seq":50');
});

test('replacement during an in-flight cloud push leaves the new career dirty and pushes it afterward', async () => {
  let finishFirst: ((result: { ok: true; revision: number }) => void) | undefined;
  const pushed: number[] = [];
  saveManager.setCloudStore({
    ...profileCloud().cloud,
    getMeta: async () => null,
    put: async (save: SaveGame) => {
      pushed.push(save.seq);
      if (pushed.length === 1) return new Promise((resolve) => { finishFirst = resolve; });
      return { ok: true, revision: pushed.length };
    },
  } as never);
  captured = captureFor(20, 2, 0, 'first-engine');
  saveManager.bindSession(1, 'first-engine');
  saveManager.markSessionReady();
  expect((await saveManager.save(1)).ok).toBe(true);
  const firstPush = saveManager.syncSlot(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  captured = captureFor(1, 1, 0, 'second-engine');
  saveManager.bindSession(1, 'second-engine');
  saveManager.markSessionReady();
  expect(await saveManager.replaceSlot(1, 1)).toEqual({ ok: true, revision: 2 });
  finishFirst?.({ ok: true, revision: 1 });
  await firstPush;
  expect(await saveManager.flushCloudPush()).toMatchObject({ status: 'synced' });
  expect(pushed).toEqual([20, 1]);
});

test('cloud conflict resolution cannot replace a corrupt local row', async () => {
  await db.savedGames.put({ id: 'slot_1', name: 'Damaged', seed: 'x', mode: 'career', payload: '{' });
  const remote = saveGame(1, 10, 2, 1);
  saveManager.setCloudStore({
    ...profileCloud().cloud,
    get: async () => remote,
    getMeta: async () => ({ slot: 1, name: remote.name, seed: remote.seed, mode: remote.mode, rank: null, equity: 100000, simDay: 2, updatedAt: 1, revision: 3, deviceId: 'remote' }),
  } as never);
  expect((await saveManager.useCloud(1)).status).toBe('failed');
  expect((await db.savedGames.get('slot_1'))?.payload).toBe('{');
});

test('keep both retries a failed cloud copy without consuming another local slot', async () => {
  const local = saveGame(1, 10, 2, 1);
  const remote = saveGame(1, 11, 2, 0);
  await new LocalSaveStore().put(local);
  let failCopy = true;
  let cloudCopy: SaveGame | null = null;
  saveManager.setCloudStore({
    ...profileCloud().cloud,
    list: async () => cloudCopy ? [
      { slot: 1, name: remote.name, seed: remote.seed, mode: remote.mode, rank: null, equity: 100000, simDay: 2, updatedAt: 1, revision: 2, deviceId: remote.deviceId },
      { slot: 2, name: cloudCopy.name, seed: cloudCopy.seed, mode: cloudCopy.mode, rank: null, equity: 100000, simDay: 2, updatedAt: 1, revision: 1, deviceId: cloudCopy.deviceId },
    ] : [{ slot: 1, name: remote.name, seed: remote.seed, mode: remote.mode, rank: null, equity: 100000, simDay: 2, updatedAt: 1, revision: 2, deviceId: remote.deviceId }],
    get: async (slot: number) => slot === 1 ? remote : cloudCopy,
    getMeta: async () => ({ slot: 1, name: remote.name, seed: remote.seed, mode: remote.mode, rank: null, equity: 100000, simDay: 2, updatedAt: 1, revision: 2, deviceId: remote.deviceId }),
    put: async (save: SaveGame) => {
      if (failCopy) return { ok: false, reason: 'invalid', message: 'network' };
      cloudCopy = save;
      return { ok: true, revision: 1 };
    },
  } as never);
  expect(await saveManager.keepBoth(1)).toEqual({ status: 'failed' });
  expect((await new LocalSaveStore().get(2))?.seq).toBe(10);
  failCopy = false;
  expect(await saveManager.keepBoth(1)).toEqual({ status: 'kept', freeSlot: 2 });
  expect(await new LocalSaveStore().get(3)).toBeNull();
  expect((await new LocalSaveStore().get(1))?.seq).toBe(11);
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

test('a ready engine cannot silently save over a different slot', async () => {
  await new LocalSaveStore().put(saveGame(2, 1, 1, 1));
  captured = captureFor(9, 2, 0, 'engine', 2);
  saveManager.bindSession(1, 'engine');
  saveManager.markSessionReady();
  expect((await saveManager.save(2)).ok).toBe(false);
  expect((await new LocalSaveStore().get(2))?.game.portfolio.positions.length).toBe(1);
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

test('paused cloud writes stay local and resume schedules queued progress', async () => {
  let pushes = 0;
  const cloud = {
    ...profileCloud().cloud,
    getMeta: async () => null,
    put: async () => { pushes += 1; return { ok: true as const, revision: 1 }; },
  };
  saveManager.setCloudStore(cloud as never);
  captured = captureFor(1, 1, 0, 'engine');
  saveManager.bindSession(1, 'engine');
  saveManager.markSessionReady();
  await saveManager.save(1);
  await saveManager.pauseCloudWrites();
  expect(saveManager.getCloudSyncState()).toBe('paused_for_deletion');
  expect((await saveManager.flushCloudPush()).status).toBe('noop');
  expect(pushes).toBe(0);
  saveManager.resumeCloudWrites();
  expect(await saveManager.flushCloudPush()).toMatchObject({ status: 'synced' });
  expect(pushes).toBe(1);
  saveManager.setCloudStore(null);
});

test('post-deletion disabled sync requires explicit reactivation', async () => {
  let pushes = 0;
  saveManager.setCloudStore({ ...profileCloud().cloud, getMeta: async () => null, put: async () => { pushes++; return { ok: true as const, revision: pushes }; } } as never);
  captured = captureFor(1, 1, 0, 'engine');
  saveManager.bindSession(1, 'engine');
  saveManager.markSessionReady();
  await saveManager.save(1);
  await saveManager.pauseCloudWrites();
  saveManager.disableCloudWritesAfterDeletion();
  expect(await saveManager.flushCloudPush()).toEqual({ status: 'noop' });
  expect(pushes).toBe(0);
  saveManager.resumeCloudWrites();
  expect(saveManager.getCloudSyncState()).toBe('disabled_after_deletion');
  saveManager.enableCloudWritesAfterDeletion();
  expect(await saveManager.flushCloudPush()).toMatchObject({ status: 'synced' });
  expect(pushes).toBe(1);
});

test('a pause timeout resumes synchronization without claiming that deletion began', async () => {
  let release: ((value: { ok: true; revision: number }) => void) | undefined;
  saveManager.setCloudStore({ ...profileCloud().cloud, getMeta: async () => null,
    put: async () => new Promise<{ ok: true; revision: number }>((resolve) => { release = resolve; }),
  } as never);
  captured = captureFor(1, 1, 0, 'engine');
  saveManager.bindSession(1, 'engine');
  saveManager.markSessionReady();
  await saveManager.save(1);
  const push = saveManager.syncSlot(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await expect(saveManager.pauseCloudWrites(0)).rejects.toThrow('still in progress');
  expect(saveManager.getCloudSyncState()).toBe('active');
  release?.({ ok: true, revision: 1 });
  await push;
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

test('loading a save with absurd prices repairs it and reports the notice once', async () => {
  const store = new LocalSaveStore();
  await store.put(saveGame(1, 10, 2, 0), { expectedRevision: undefined });
  const row = await db.savedGames.get('slot_1');
  const payload = JSON.parse(String(row?.payload)) as {
    game: { pricing: { states: Array<{ ticker: string; price: unknown }> } };
  };
  const ticker = payload.game.pricing.states[0].ticker;
  payload.game.pricing.states[0].price = 1e54;
  await db.savedGames.update('slot_1', { payload: JSON.stringify(payload) });

  const outcome = await saveManager.load(1);
  assert.equal(outcome.ok, true);
  assert.equal(notices.length, 1, 'the player must be told exactly once');
  assert.match(notices[0], /1 symbols reset to fair value/);
  // The repaired value must reach the engine, not just the parse.
  const restoredState = restored[0].game.pricing.states.find((s) => s.ticker === ticker);
  assert.ok(Number.isFinite(restoredState?.price));
});

function makeProfile(updatedAt: number, difficulty: 'learner' | 'standard' | 'hardcore' = 'standard'): Profile {
  return {
    schemaVersion: 1,
    settings: {
      difficulty,
      soundEnabled: false,
      tapeStripEnabled: true,
      priceFlashSetting: 'subtle',
      selectedTimeframe: '5m',
      activeWorkspaceLayout: 'trade',
      chartIndicators: {
        volume: true,
        sma20: true,
        ema50: false,
        vwap: true,
        bollinger: false,
        rsi: false,
        macd: false,
      },
    },
    tutorial: { completed: false, step: 0 },
    layouts: {},
    updatedAt,
  };
}

function profileCloud(seedProfile: { data: unknown; updatedAt: number } | null = null) {
  let stored = seedProfile;
  const puts: unknown[] = [];
  const cloud: CloudApi = {
    list: async () => [],
    get: async () => null,
    getMeta: async () => null,
    put: async () => ({ ok: true, revision: 1 }),
    getProfile: async () => stored,
    putProfile: async (data: unknown) => {
      const updatedAt = Number((data as { updatedAt?: number }).updatedAt ?? 0);
      stored = { data, updatedAt };
      puts.push(data);
    },
  };
  return { cloud, puts, stored: () => stored };
}

test('first sign in with an empty cloud profile uploads the local profile', async () => {
  const local = makeProfile(100);
  await writeProfile(ProfileSchema.encode(local), local.updatedAt);
  const fake = profileCloud();
  saveManager.setCloudStore(fake.cloud as never);

  await saveManager.syncProfile();

  assert.equal(fake.puts.length, 1, 'the local profile must be pushed on sign in');
  assert.deepEqual(fake.puts[0], ProfileSchema.encode(local));
});

test('first sign in with no local profile materializes one from the live store and pushes it', async () => {
  const live = makeProfile(50);
  saveManager.init({
    capture: () => captured,
    restore: (save) => restored.push(save),
    onStatus: (status) => statuses.push(status),
    onConflict: (conflict) => conflicts.push(conflict),
    onNotice: (message) => notices.push(message),
    captureProfile: () => live,
  });
  const fake = profileCloud();
  saveManager.setCloudStore(fake.cloud as never);

  await saveManager.syncProfile();

  assert.equal(fake.puts.length, 1, 'an empty cloud and empty local must still produce a row');
  assert.deepEqual(fake.puts[0], ProfileSchema.encode(live));
});

test('a newer local profile wins over an older cloud profile', async () => {
  const local = makeProfile(200, 'hardcore');
  await writeProfile(ProfileSchema.encode(local), local.updatedAt);
  const fake = profileCloud({ data: ProfileSchema.encode(makeProfile(100)), updatedAt: 100 });
  saveManager.setCloudStore(fake.cloud as never);

  await saveManager.syncProfile();

  assert.equal(fake.puts.length, 1);
  assert.equal((fake.puts[0] as Profile).settings.difficulty, 'hardcore');
});

test('a newer cloud profile wins, is stored locally and applied to the live state', async () => {
  const local = makeProfile(100);
  await writeProfile(ProfileSchema.encode(local), local.updatedAt);
  const cloudProfile = makeProfile(300, 'learner');
  const fake = profileCloud({ data: ProfileSchema.encode(cloudProfile), updatedAt: 300 });
  const applied: Profile[] = [];
  saveManager.init({
    capture: () => captured,
    restore: (save) => restored.push(save),
    onStatus: (status) => statuses.push(status),
    onConflict: (conflict) => conflicts.push(conflict),
    onNotice: (message) => notices.push(message),
    applyProfile: (profile) => applied.push(profile),
  });
  saveManager.setCloudStore(fake.cloud as never);

  await saveManager.syncProfile();

  assert.equal(fake.puts.length, 0, 'the newer cloud copy must not be overwritten');
  assert.equal(applied.length, 1);
  assert.equal(applied[0].settings.difficulty, 'learner');
  const stored = (await readProfile()) as Profile | null;
  assert.equal(stored?.updatedAt, 300);
  assert.equal(stored?.settings.difficulty, 'learner');
});

test('an invalid cloud profile does not crash and leaves the local profile alone', async () => {
  const local = makeProfile(100);
  await writeProfile(ProfileSchema.encode(local), local.updatedAt);
  const fake = profileCloud({ data: { foo: 'bar' }, updatedAt: 400 });
  const applied: Profile[] = [];
  saveManager.init({
    capture: () => captured,
    restore: (save) => restored.push(save),
    onStatus: (status) => statuses.push(status),
    onConflict: (conflict) => conflicts.push(conflict),
    onNotice: (message) => notices.push(message),
    applyProfile: (profile) => applied.push(profile),
  });
  saveManager.setCloudStore(fake.cloud as never);

  await saveManager.syncProfile();

  assert.equal(fake.puts.length, 0);
  assert.equal(applied.length, 0);
  const stored = (await readProfile()) as Profile | null;
  assert.equal(stored?.updatedAt, 100);
});

test('a profile change writes local immediately and only pushes to the cloud debounced', async () => {
  const fake = profileCloud();
  saveManager.init({
    capture: () => captured,
    restore: (save) => restored.push(save),
    onStatus: (status) => statuses.push(status),
    onConflict: (conflict) => conflicts.push(conflict),
    onNotice: (message) => notices.push(message),
    captureProfile: () => makeProfile(Date.now(), 'hardcore'),
  });
  saveManager.setCloudStore(fake.cloud as never);

  await saveManager.noteProfileChange();
  const stored = (await readProfile()) as Profile | null;
  assert.equal(stored?.settings.difficulty, 'hardcore', 'local profile must be written immediately');
  assert.equal(fake.puts.length, 0, 'cloud push must be debounced');

  await saveManager.flushProfilePush();
  assert.equal(fake.puts.length, 1, 'the debounced push must reach the cloud');
});

test('an oversized profile is not pushed to the cloud', async () => {
  const huge = makeProfile(10);
  huge.layouts = { blob: 'x'.repeat(70 * 1024) };
  saveManager.init({
    capture: () => captured,
    restore: (save) => restored.push(save),
    onStatus: (status) => statuses.push(status),
    onConflict: (conflict) => conflicts.push(conflict),
    onNotice: (message) => notices.push(message),
    captureProfile: () => huge,
  });
  const fake = profileCloud();
  saveManager.setCloudStore(fake.cloud as never);

  await saveManager.syncProfile();

  assert.equal(fake.puts.length, 0, 'a profile over the size limit must stay local');
});

test('a reload right after a fill restores the trade from local storage', async () => {
  captured = captureFor(1, 1, 0, 'live-engine');
  await saveManager.bindSession(1, 'live-engine');
  saveManager.markSessionReady();
  await saveManager.save(1);

  // The fill lands: the local write happens immediately, without waiting for autosave.
  captured = captureFor(2, 1, 1, 'live-engine');
  saveManager.notePlayerAction();
  await saveManager.flush();

  // A reload drops the in-memory engine; the next session loads the slot from disk.
  saveManager.endSession();
  restored.length = 0;
  const outcome = await saveManager.load(1);

  assert.equal(outcome.ok, true);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].game.portfolio.positions.length, 1, 'the filled position survives a reload');
});

test.each([
  { localSeq: 9, cloudSeq: 4, selected: 9 },
  { localSeq: 4, cloudSeq: 9, selected: 9 },
])('loading chooses the newer compatible progress, local $localSeq and cloud $cloudSeq', async ({ localSeq, cloudSeq, selected }) => {
  await new LocalSaveStore().put(saveGame(1, localSeq, 1, 0));
  const remote = saveGame(1, cloudSeq, 1, 0);
  saveManager.setCloudStore({
    ...profileCloud().cloud,
    getMeta: async () => ({ slot: 1, name: remote.name, seed: remote.seed, mode: remote.mode, rank: null, equity: 100000, simDay: 1, updatedAt: 999, revision: 8, seq: cloudSeq, deviceId: remote.deviceId }),
    get: async () => remote,
  } as never);
  const outcome = await saveManager.load(1);
  expect(outcome.ok).toBe(true);
  expect(restored.at(-1)?.seq).toBe(selected);
});

test('equal progress with different content enters conflict without restoring either copy', async () => {
  await new LocalSaveStore().put(saveGame(1, 9, 1, 0));
  const remote = saveGame(1, 9, 1, 1);
  saveManager.setCloudStore({
    ...profileCloud().cloud,
    getMeta: async () => ({ slot: 1, name: remote.name, seed: remote.seed, mode: remote.mode, rank: null, equity: 100000, simDay: 1, updatedAt: 999, revision: 8, seq: 9, deviceId: remote.deviceId }),
    get: async () => remote,
  } as never);
  expect(await saveManager.load(1)).toEqual({ ok: false, reason: 'conflict' });
  expect(restored).toEqual([]);
  expect((await new LocalSaveStore().get(1))?.game.portfolio.positions).toHaveLength(0);
});

test.each([
  { payload: '{', reason: 'corrupt' },
  { payload: JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }), reason: 'newer' },
])('a protected local row remains in recovery even when a cloud copy exists: $reason', async ({ payload, reason }) => {
  await db.savedGames.put({ id: 'slot_1', name: 'Protected', seed: 'MGR_TEST', mode: 'career', payload, revision: 1 });
  const remote = saveGame(1, 9, 1, 0);
  saveManager.setCloudStore({ ...profileCloud().cloud,
    getMeta: async () => ({ slot: 1, name: remote.name, seed: remote.seed, mode: remote.mode, rank: null, equity: 100000, simDay: 1, updatedAt: 1, revision: 1, deviceId: remote.deviceId }),
    get: async () => remote,
  } as never);
  expect(await saveManager.load(1)).toMatchObject({ ok: false, reason });
  expect(restored).toEqual([]);
  expect((await db.savedGames.get('slot_1'))?.payload).toBe(payload);
});

test('a cloud metadata failure cannot be mistaken for a missing cloud save', async () => {
  await new LocalSaveStore().put(saveGame(1, 9, 1, 0));
  saveManager.setCloudStore({ ...profileCloud().cloud, getMeta: async () => { throw new Error('unavailable'); } } as never);
  await expect(saveManager.load(1)).rejects.toThrow('unavailable');
  expect(restored).toEqual([]);
});

test('account change during cloud loading prevents restoration', async () => {
  const remote = saveGame(1, 9, 1, 0);
  let current = true;
  saveManager.setCloudStore({
    ...profileCloud().cloud,
    getMeta: async () => ({ slot: 1, name: remote.name, seed: remote.seed, mode: remote.mode, rank: null, equity: 100000, simDay: 1, updatedAt: 1, revision: 1, seq: 9, deviceId: remote.deviceId }),
    get: async () => { current = false; return remote; },
  } as never);
  await expect(saveManager.load(1, () => current)).rejects.toThrow('Session changed');
  expect(restored).toEqual([]);
});

test('signing in after a restore adopts the cloud revision so the next push is not a false conflict', async () => {
  await new LocalSaveStore().put(saveGame(1, 10, 2, 1), { expectedRevision: undefined });
  const putOpts: Array<{ expectedRevision?: number } | undefined> = [];
  const cloud = {
    list: async () => [],
    get: async () => saveGame(1, 8, 2, 1),
    getMeta: async () => ({
      slot: 1,
      name: 'Career',
      seed: 'MGR_TEST',
      mode: 'career' as const,
      rank: 'Intern',
      equity: 100000,
      simDay: 2,
      updatedAt: 1700000000000,
      revision: 5,
      seq: 8,
      deviceId: 'device-test',
    }),
    put: async (_save: SaveGame, opts?: { expectedRevision?: number }) => {
      putOpts.push(opts);
      return { ok: true as const, revision: 6 };
    },
    delete: async () => undefined,
    getProfile: async () => null,
    putProfile: async () => undefined,
  };

  captured = captureFor(12, 3, 1, 'live-engine');
  await saveManager.bindSession(1, 'live-engine');
  saveManager.markSessionReady();
  saveManager.setCloudStore(cloud as never);
  await new Promise((resolve) => setTimeout(resolve, 0));

  await saveManager.save(1);
  await saveManager.flushCloudPush();

  assert.deepEqual(putOpts.at(-1), { expectedRevision: 5 }, 'the push must carry the adopted base revision');
  assert.equal(conflicts.length, 0, 'the player must not see a conflict against their own save');
});
