import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { db, LocalSaveStore } from '../saves/localStore';
import { saveManager } from '../saves/manager';
import { SCHEMA_VERSION, type SaveGame } from '../saves/schema';
import { useAuthStore } from './useAuthStore';
import { useTerminalStore } from './useTerminalStore';

beforeEach(async () => {
  await db.delete();
  await db.open();
  saveManager.setStore(new LocalSaveStore());
  saveManager.setCloudStore(null);
  saveManager.endSession();
  saveManager.setActiveSlot(1);
  useAuthStore.setState({ ready: true, configured: false, hydrationError: false, signedIn: false, user: null });
  useTerminalStore.setState({ engine: null, engineId: null, snapshot: null, sessionPhase: 'idle', sessionError: null });
});

test('a verified empty guest store starts a ready session once', async () => {
  const inspected = vi.spyOn(saveManager, 'listAllSlots');
  await Promise.all([useTerminalStore.getState().initSession(), useTerminalStore.getState().initSession()]);
  expect(useTerminalStore.getState().sessionPhase).toBe('ready');
  expect(useTerminalStore.getState().engine).not.toBeNull();
  expect(inspected).toHaveBeenCalledTimes(1);
  inspected.mockRestore();
});

test('skipping to the next day persists the new day immediately', async () => {
  await useTerminalStore.getState().initSession();
  expect(useTerminalStore.getState().sessionPhase).toBe('ready');
  expect((await saveManager.save(1)).ok).toBe(true);

  useTerminalStore.getState().skipToNextDay();

  await vi.waitFor(async () => {
    const row = await db.savedGames.get('slot_1');
    expect(row?.payload).toBeTruthy();
    const payload = JSON.parse(row!.payload!) as { game: { simDay: number } };
    expect(payload.game.simDay).toBe(2);
  });
});

test('an account switch during save inspection enters recovery without creating an engine', async () => {
  const inspection = vi.spyOn(saveManager, 'listAllSlots').mockImplementation(async () => {
    useAuthStore.setState({ user: { id: 'different-account', email: null, providers: [] } });
    return [];
  });
  useAuthStore.setState({ user: { id: 'first-account', email: null, providers: [] } });
  await useTerminalStore.getState().initSession();
  expect(useTerminalStore.getState().sessionPhase).toBe('recovery');
  expect(useTerminalStore.getState().engine).toBeNull();
  inspection.mockRestore();
});

test('a failed local inspection enters recovery and retry restores a guest session', async () => {
  saveManager.setStore({
    list: async () => { throw new Error('IndexedDB unavailable'); },
    get: async () => null,
    put: async () => ({ ok: false, reason: 'invalid', message: 'unavailable' }),
    delete: async () => {},
  });
  await useTerminalStore.getState().initSession();
  expect(useTerminalStore.getState().sessionPhase).toBe('recovery');
  expect(useTerminalStore.getState().engine).toBeNull();
  saveManager.setStore(new LocalSaveStore());
  await useTerminalStore.getState().initSession();
  expect(useTerminalStore.getState().sessionPhase).toBe('ready');
});

test('failed account hydration cannot be treated as proof that cloud storage is empty', async () => {
  useAuthStore.setState({ hydrationError: true });
  await useTerminalStore.getState().initSession();
  expect(useTerminalStore.getState().sessionPhase).toBe('recovery');
  expect(useTerminalStore.getState().engine).toBeNull();
  expect(useTerminalStore.getState().sessionError).toContain('cloud saves may still exist');
});

test('a corrupt slot stays in recovery and cannot trigger a first save', async () => {
  await db.savedGames.put({ id: 'slot_1', name: 'Damaged', seed: 'x', mode: 'career', payload: '{' });
  await useTerminalStore.getState().initSession();
  expect(useTerminalStore.getState().sessionPhase).toBe('recovery');
  expect(useTerminalStore.getState().engine).toBeNull();
  expect((await saveManager.save(1)).ok).toBe(false);
  expect((await db.savedGames.get('slot_1'))?.payload).toBe('{');
});

test('a valid local save is restored on direct terminal initialization', async () => {
  const engine = useTerminalStore.getState();
  engine.initEngine('RESTORE');
  const game = useTerminalStore.getState().engine!.exportState();
  const save: SaveGame = {
    schemaVersion: SCHEMA_VERSION, id: 'slot_1', slot: 1, name: 'Career', seed: 'RESTORE', mode: 'career',
    scenarioId: null, createdAt: 1, updatedAt: 1, revision: 1, seq: game.actionSeq,
    deviceId: 'test', summary: { rank: null, equity: 100000, simDay: 1 }, game,
  };
  await new LocalSaveStore().put(save);
  useTerminalStore.setState({ engine: null, engineId: null, snapshot: null, sessionPhase: 'idle' });
  await useTerminalStore.getState().initSession();
  expect(useTerminalStore.getState().sessionPhase).toBe('ready');
  expect(useTerminalStore.getState().seed).toBe('RESTORE');
});

test('an unsupported version and a rejected load both stay out of ready', async () => {
  await db.savedGames.put({ id: 'slot_1', name: 'Future', seed: 'x', mode: 'career', payload: JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1 }) });
  await useTerminalStore.getState().initSession();
  expect(useTerminalStore.getState().sessionPhase).toBe('recovery');
  await db.savedGames.delete('slot_1');
  saveManager.setStore({
    list: async () => [{ slot: 1, name: 'Unavailable', seed: 'x', mode: 'career', rank: null, equity: 0, simDay: 1, updatedAt: 1, revision: 1, deviceId: 'x' }],
    get: async () => { throw new Error('read rejected'); },
    put: async () => ({ ok: false, reason: 'invalid', message: 'unavailable' }),
    delete: async () => {},
  });
  await useTerminalStore.getState().initSession();
  expect(useTerminalStore.getState().sessionPhase).toBe('recovery');
  expect(useTerminalStore.getState().engine).toBeNull();
});

test('a cloud-only save waits for delayed auth hydration before loading', async () => {
  useTerminalStore.getState().initEngine('CLOUD');
  const game = useTerminalStore.getState().engine!.exportState();
  const save: SaveGame = {
    schemaVersion: SCHEMA_VERSION, id: 'slot_2', slot: 2, name: 'Cloud career', seed: 'CLOUD', mode: 'career',
    scenarioId: null, createdAt: 1, updatedAt: 1, revision: 4, seq: game.actionSeq,
    deviceId: 'cloud', summary: { rank: null, equity: 100000, simDay: 1 }, game,
  };
  useTerminalStore.setState({ engine: null, engineId: null, snapshot: null, sessionPhase: 'idle' });
  useAuthStore.setState({ ready: false });
  const pending = useTerminalStore.getState().initSession();
  await Promise.resolve();
  expect(useTerminalStore.getState().sessionPhase).toBe('loading');
  saveManager.setCloudStore({
    list: async () => [{ slot: 2, name: save.name, seed: save.seed, mode: save.mode, rank: null, equity: 100000, simDay: 1, updatedAt: 1, revision: 4, deviceId: 'cloud' }],
    get: async () => save,
    getMeta: async () => ({ slot: 2, name: save.name, seed: save.seed, mode: save.mode, rank: null, equity: 100000, simDay: 1, updatedAt: 1, revision: 4, deviceId: 'cloud' }),
    put: async () => ({ ok: true, revision: 5 }), delete: async () => {},
    getProfile: async () => null, putProfile: async () => {},
  });
  useAuthStore.setState({ ready: true, signedIn: true, user: { id: 'test', email: null, providers: [] } });
  await pending;
  expect(useTerminalStore.getState().sessionPhase).toBe('ready');
  expect(useTerminalStore.getState().seed).toBe('CLOUD');
  expect(await new LocalSaveStore().get(2)).toBeNull();
});
