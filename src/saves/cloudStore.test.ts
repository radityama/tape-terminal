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

test('cloud reads filter by owner and metadata errors are not treated as empty', async () => {
  const filters: Array<[string, unknown]> = [];
  let error: { code: string; message: string } | null = null;
  const query = {
    eq(key: string, value: unknown) { filters.push([key, value]); return query; },
    maybeSingle: async () => ({ data: null, error }),
  };
  const client = { from: () => ({ select: () => query }) } as unknown as SupabaseClient;
  const store = new CloudSaveStore(client, 'owner-a');
  expect(await store.get(2)).toBeNull();
  expect(filters).toContainEqual(['user_id', 'owner-a']);
  expect(filters).toContainEqual(['slot', 2]);
  filters.length = 0;
  error = { code: 'PGRST001', message: 'provider detail' };
  await expect(store.getMeta(3)).rejects.toMatchObject({ message: 'Could not inspect the cloud save.', cause: error });
  expect(filters).toContainEqual(['user_id', 'owner-a']);
  expect(filters).toContainEqual(['slot', 3]);
});
