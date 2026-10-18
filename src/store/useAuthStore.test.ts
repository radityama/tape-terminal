import { beforeEach, expect, test, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  rows: new Set([1, 2]),
  failSlot: 0,
  throwSlot: 0,
  signOutCalls: 0,
}));

vi.mock('../lib/supabase/client', () => ({
  createBrowserSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'owner', email: 'owner@example.com', app_metadata: {} } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { fake.signOutCalls += 1; return { error: null }; },
    },
    from: () => ({
      select: () => {
        let selectedSlot = 0;
        const selection = {
        order: async () => ({ data: [...fake.rows].map((slot) => ({ slot, name: 'Career', seed: 'x', mode: 'career', rank: null, equity: 1, sim_day: 1, updated_at: new Date().toISOString(), revision: 1, device_id: 'x' })), error: null }),
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
            if (fake.throwSlot === slot) throw new Error('network failed');
            if (fake.failSlot !== slot) fake.rows.delete(slot);
            resolve({ data: null, error: fake.failSlot === slot ? { message: 'provider details' } : null });
          },
        };
        return query;
      },
    }),
  }),
}));

import { useAuthStore } from './useAuthStore';

beforeEach(async () => {
  fake.rows = new Set([1, 2]);
  fake.failSlot = 0;
  fake.throwSlot = 0;
  fake.signOutCalls = 0;
  useAuthStore.getState().init();
  await vi.waitFor(() => expect(useAuthStore.getState().ready).toBe(true));
  useAuthStore.setState({ signedIn: true, user: { id: 'owner', email: 'owner@example.com', providers: [] }, error: null });
});

test('successful deletion removes only listed slots', async () => {
  expect(await useAuthStore.getState().deleteCloudSaves()).toEqual({ status: 'success', deletedSlots: [1, 2] });
  expect([...fake.rows]).toEqual([]);
});

test('returned and thrown delete errors produce partial results and safe retry', async () => {
  fake.failSlot = 2;
  expect(await useAuthStore.getState().deleteCloudSaves()).toMatchObject({ status: 'partial', deletedSlots: [1], failedSlots: [2] });
  expect([...fake.rows]).toEqual([2]);
  fake.failSlot = 0;
  fake.throwSlot = 2;
  expect(await useAuthStore.getState().deleteCloudSaves()).toMatchObject({ status: 'failed', failedSlots: [2] });
  fake.throwSlot = 0;
  expect(await useAuthStore.getState().deleteCloudSaves()).toEqual({ status: 'success', deletedSlots: [2] });
});

test('failed sign-out cleanup keeps the user signed in and shows the failure', async () => {
  fake.failSlot = 1;
  await useAuthStore.getState().signOut({ removeCloudSaves: true });
  expect(fake.signOutCalls).toBe(0);
  expect(useAuthStore.getState().signedIn).toBe(true);
  expect(useAuthStore.getState().error).toMatch(/still signed in/);
});
