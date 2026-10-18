import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  rows: new Set([1, 2]),
  failSlot: 0,
  throwSlot: 0,
  signOutCalls: 0,
  failSignOut: false,
  failList: false,
  deleteCalls: 0,
  deferredDelete: null as null | Promise<void>,
}));

vi.mock('../lib/supabase/client', () => ({
  createBrowserSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'owner', email: 'owner@example.com', app_metadata: {} } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { fake.signOutCalls += 1; return { error: fake.failSignOut ? { message: 'sign-out failed' } : null }; },
    },
    from: () => ({
      select: () => {
        let selectedSlot = 0;
        const selection = {
        order: async () => ({ data: [...fake.rows].map((slot) => ({ slot, name: 'Career', seed: 'x', mode: 'career', rank: null, equity: 1, sim_day: 1, updated_at: new Date().toISOString(), revision: 1, device_id: 'x' })), error: fake.failList ? { message: 'list failed' } : null }),
        eq(key: string, value: number) { if (key === 'slot') selectedSlot = value; return selection; },
        maybeSingle: async () => ({ data: fake.rows.has(selectedSlot) ? { slot: selectedSlot, name: 'Career', seed: 'x', mode: 'career', rank: null, equity: 1, sim_day: 1, updated_at: new Date().toISOString(), revision: 1, device_id: 'x' } : null, error: null }),
        };
        return selection;
      },
      delete: () => {
        let slot = 0;
        const query = {
          eq(key: string, value: number) { if (key === 'slot') slot = value; return query; },
          select() { return query; },
          then(resolve: (result: { data: null; error: { message: string } | null }) => void) {
            fake.deleteCalls += 1;
            const complete = () => {
              if (fake.throwSlot === slot) throw new Error('network failed');
              if (fake.failSlot !== slot) fake.rows.delete(slot);
              resolve({ data: null, error: fake.failSlot === slot ? { message: 'provider details' } : null });
            };
            if (fake.deferredDelete) return fake.deferredDelete.then(complete);
            complete();
          },
        };
        return query;
      },
    }),
  }),
}));

import { useAuthStore } from './useAuthStore';
import { saveManager } from '../saves/manager';
import { db } from '../saves/localStore';

beforeEach(async () => {
  fake.rows = new Set([1, 2]);
  fake.failSlot = 0;
  fake.throwSlot = 0;
  fake.signOutCalls = 0;
  fake.failSignOut = false;
  fake.failList = false;
  fake.deleteCalls = 0;
  fake.deferredDelete = null;
  useAuthStore.getState().init();
  await vi.waitFor(() => expect(useAuthStore.getState().ready).toBe(true));
  useAuthStore.setState({ signedIn: true, user: { id: 'owner', email: 'owner@example.com', providers: [] }, error: null });
});

test('successful deletion removes only listed slots', async () => {
  expect(await useAuthStore.getState().deleteCloudSaves()).toEqual({ status: 'success', deletedSlots: [1, 2] });
  expect([...fake.rows]).toEqual([]);
  expect(saveManager.getCloudSyncState()).toBe('disabled_after_deletion');
  expect(await saveManager.syncSlot()).toEqual({ status: 'noop' });
  useAuthStore.getState().enableCloudSync();
  expect(saveManager.getCloudSyncState()).toBe('active');
});

test('returned and thrown delete errors produce partial results and safe retry', async () => {
  fake.failSlot = 2;
  expect(await useAuthStore.getState().deleteCloudSaves()).toMatchObject({ status: 'partial', deletedSlots: [1], failedSlots: [2] });
  expect([...fake.rows]).toEqual([2]);
  expect(saveManager.getCloudSyncState()).toBe('paused_for_deletion');
  fake.failSlot = 0;
  fake.throwSlot = 2;
  expect(await useAuthStore.getState().deleteCloudSaves()).toMatchObject({ status: 'failed', failedSlots: [2] });
  fake.throwSlot = 0;
  expect(await useAuthStore.getState().deleteCloudSaves()).toEqual({ status: 'success', deletedSlots: [2] });
  expect(saveManager.getCloudSyncState()).toBe('disabled_after_deletion');
});

test('failed listing resumes cloud sync without deleting or losing queued local progress', async () => {
  fake.failList = true;
  expect(await useAuthStore.getState().deleteCloudSaves()).toMatchObject({ status: 'failed', deletedSlots: [] });
  expect(saveManager.getCloudSyncState()).toBe('active');
  expect(fake.deleteCalls).toBe(0);
});

test('successful deletion followed by failed sign-out leaves the account signed in with sync disabled', async () => {
  fake.failSignOut = true;
  await useAuthStore.getState().signOut({ removeCloudSaves: true });
  expect(fake.signOutCalls).toBe(1);
  expect([...fake.rows]).toEqual([]);
  expect(useAuthStore.getState().signedIn).toBe(true);
  expect(saveManager.getCloudSyncState()).toBe('disabled_after_deletion');
  expect(useAuthStore.getState().error).toMatch(/Could not sign out/);
});

test('duplicate deletion submissions share one operation and leave local rows untouched', async () => {
  let release: (() => void) | undefined;
  fake.deferredDelete = new Promise<void>((resolve) => { release = resolve; });
  await db.open();
  await db.savedGames.put({ id: 'slot_1', name: 'Local', seed: 'local', mode: 'career', payload: '{', revision: 4 });
  const first = useAuthStore.getState().deleteCloudSaves();
  const second = useAuthStore.getState().deleteCloudSaves();
  await vi.waitFor(() => expect(fake.deleteCalls).toBe(1));
  release?.();
  expect(await first).toEqual(await second);
  expect(fake.deleteCalls).toBe(2);
  expect((await db.savedGames.get('slot_1'))?.payload).toBe('{');
});

test('failed sign-out cleanup keeps the user signed in and shows the failure', async () => {
  fake.failSlot = 1;
  useAuthStore.setState({ dialog: 'account' });
  await useAuthStore.getState().signOut({ removeCloudSaves: true });
  expect(fake.signOutCalls).toBe(0);
  expect(useAuthStore.getState().signedIn).toBe(true);
  expect(useAuthStore.getState().dialog).toBe('account');
  expect(useAuthStore.getState().error).toMatch(/Could not delete cloud save 1.*still signed in/);
});
