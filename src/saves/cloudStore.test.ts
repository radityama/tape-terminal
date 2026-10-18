import { test, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MarketSimulationEngine } from '../engine/market';
import { CloudSaveStore } from './cloudStore';
import { SCHEMA_VERSION, type SaveGame } from './schema';

function save(): SaveGame {
  const engine = new MarketSimulationEngine('CLOUD_TEST');
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'slot_1', slot: 1, name: 'Career', seed: engine.seed, mode: 'career', scenarioId: null,
    createdAt: 1700000000000, updatedAt: 1700000000000, revision: 1, seq: 1, deviceId: 'device-a',
    summary: { rank: 'Intern', equity: 100000, simDay: 1 }, game: engine.exportState(),
  };
}

function mockClient(responses: Array<{ data: unknown; error: { code?: string; message: string } | null }>) {
  const filters: Array<[string, unknown]> = [];
  const actions: string[] = [];
  const query = {
    eq(key: string, value: unknown) { filters.push([key, value]); return query; },
    select() { return query; },
    maybeSingle: vi.fn(async () => responses.shift()),
    single: vi.fn(async () => responses.shift()),
  };
  const table = {
    update() { actions.push('update'); return query; },
    insert() { actions.push('insert'); return query; },
    upsert() { actions.push('upsert'); return query; },
    select() { actions.push('select'); return query; },
  };
  return { client: { from: () => table } as unknown as SupabaseClient, actions, filters };
}

test('zero rows updated with a newer cloud revision is a conflict', async () => {
  const { client, actions, filters } = mockClient([
    { data: null, error: null },
    { data: { revision: 5 }, error: null },
  ]);
  const result = await new CloudSaveStore(client, 'user-a').put(save(), { expectedRevision: 4 });
  expect(result).toEqual({ ok: false, reason: 'conflict', remoteRevision: 5 });
  expect(actions).toEqual(['update', 'select']);
  expect(filters).toContainEqual(['revision', 4]);
});

test('a new slot inserts, never upserts an existing cloud slot', async () => {
  const { client, actions } = mockClient([
    { data: null, error: { code: '23505', message: 'duplicate key' } },
    { data: { revision: 3 }, error: null },
  ]);
  const result = await new CloudSaveStore(client, 'user-a').put(save());
  expect(result).toEqual({ ok: false, reason: 'conflict', remoteRevision: 3 });
  expect(actions).toEqual(['insert', 'select']);
});

test('zero rows updated with a missing cloud row does not resurrect a deleted slot', async () => {
  const { client, actions } = mockClient([
    { data: null, error: null },
    { data: null, error: null },
  ]);
  const result = await new CloudSaveStore(client, 'user-a').put(save(), { expectedRevision: 4 });
  expect(result).toEqual({ ok: false, reason: 'conflict', remoteRevision: 0 });
  expect(actions).toEqual(['update', 'select']);
});

test('cloud deletion checks returned errors, verifies absence and restricts ownership', async () => {
  const deleteFilters: Array<[string, unknown]> = [];
  const verifyFilters: Array<[string, unknown]> = [];
  let deletion: { error: { message: string } | null } = { error: null };
  let remaining: unknown = null;
  const deleteQuery = {
    eq(key: string, value: unknown) { deleteFilters.push([key, value]); return deleteQuery; },
    select() { return deleteQuery; },
    then(resolve: (value: typeof deletion) => void) { resolve(deletion); },
  };
  const verifyQuery = {
    eq(key: string, value: unknown) { verifyFilters.push([key, value]); return verifyQuery; },
    maybeSingle: async () => ({ data: remaining, error: null }),
  };
  const client = { from: () => ({ delete: () => deleteQuery, select: () => verifyQuery }) } as unknown as SupabaseClient;
  const store = new CloudSaveStore(client, 'owner-a');
  await store.delete(2);
  expect(deleteFilters).toContainEqual(['user_id', 'owner-a']);
  expect(deleteFilters).toContainEqual(['slot', 2]);
  expect(verifyFilters).toContainEqual(['user_id', 'owner-a']);
  deletion = { error: { message: 'provider details' } };
  await expect(store.delete(2)).rejects.toThrow('Cloud save deletion failed');
  deletion = { error: null };
  remaining = { slot: 2 };
  await expect(store.delete(2)).rejects.toThrow('Cloud save still exists');
});
