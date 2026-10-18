import { create } from 'zustand';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createBrowserSupabase } from '../lib/supabase/client';
import { CloudSaveStore } from '../saves/cloudStore';
import { saveManager, SyncConflict } from '../saves/manager';

export type AuthDialog = 'none' | 'signin' | 'account' | 'claim' | 'conflict';

export interface AuthUser {
  id: string;
  email: string | null;
  providers: string[];
}

interface AuthState {
  configured: boolean;
  ready: boolean;
  hydrationError: boolean;
  signedIn: boolean;
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  emailSentTo: string | null;
  resendAvailableAt: number;
  dialog: AuthDialog;
  conflict: SyncConflict | null;

  init: () => void;
  retryHydration: () => Promise<void>;
  openDialog: (dialog: AuthDialog) => void;
  closeDialog: () => void;
  clearError: () => void;
  reportAuthError: (message: string) => void;
  signInWithMagicLink: (email: string) => Promise<void>;
  resendMagicLink: () => Promise<void>;
  signInWithOAuth: (provider: 'github' | 'google') => Promise<void>;
  signOut: (opts?: { removeCloudSaves?: boolean }) => Promise<void>;
  deleteCloudSaves: () => Promise<void>;
}

const MAGIC_LINK_COOLDOWN_MS = 30000;

let client: SupabaseClient | null = null;
let initStarted = false;
// Supabase emits INITIAL_SESSION right after getSession, so this guards against wiring twice
// and throwing away the sync state (base revisions, status) of the first wire-up.
let cloudUserId: string | null = null;
let authEventId = 0;

function toUser(user: User): AuthUser {
  const providers = Array.isArray(user.app_metadata?.providers)
    ? (user.app_metadata.providers as string[])
    : [];
  return { id: user.id, email: user.email ?? null, providers };
}

function wireCloud(user: User | null): void {
  if (user) {
    if (cloudUserId === user.id) return;
    cloudUserId = user.id;
    if (client) saveManager.setCloudStore(new CloudSaveStore(client, user.id));
    void saveManager.syncProfile();
  } else {
    if (cloudUserId === null && !saveManager.hasCloud()) return;
    cloudUserId = null;
    saveManager.setCloudStore(null);
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  configured: false,
  ready: false,
  hydrationError: false,
  signedIn: false,
  user: null,
  loading: false,
  error: null,
  emailSentTo: null,
  resendAvailableAt: 0,
  dialog: 'none',
  conflict: null,

  init: () => {
    if (initStarted) return;
    initStarted = true;

    client = createBrowserSupabase();
    if (!client) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Supabase auth is not configured; running as a guest.');
      }
      set({ configured: false, ready: true });
      return;
    }

    set({ configured: true });

    const initialEventId = authEventId;
    void client.auth.getSession().then(({ data, error }) => {
      if (authEventId !== initialEventId) return;
      if (error) {
        set({ ready: true, hydrationError: true });
        return;
      }
      const user = data.session?.user ?? null;
      wireCloud(user);
      set({ ready: true, hydrationError: false, signedIn: !!user, user: user ? toUser(user) : null });
    }).catch(() => {
      if (authEventId === initialEventId) set({ ready: true, hydrationError: true });
    });

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return;
      authEventId += 1;
      const user = session?.user ?? null;
      wireCloud(user);
      set({ ready: true, hydrationError: false, signedIn: !!user, user: user ? toUser(user) : null, error: null, emailSentTo: user ? null : get().emailSentTo });
    });
  },

  retryHydration: async () => {
    if (!client) return;
    set({ ready: false, hydrationError: false });
    const eventId = authEventId;
    try {
      const { data, error } = await client.auth.getSession();
      if (authEventId !== eventId) return;
      if (error) throw error;
      const user = data.session?.user ?? null;
      wireCloud(user);
      set({ ready: true, signedIn: !!user, user: user ? toUser(user) : null });
    } catch {
      if (authEventId === eventId) set({ ready: true, hydrationError: true });
    }
  },

  openDialog: (dialog) => set({ dialog, error: null }),
  closeDialog: () => set({ dialog: 'none', conflict: null }),
  clearError: () => set({ error: null }),
  reportAuthError: (message) => set({ dialog: 'signin', error: message, loading: false }),

  signInWithMagicLink: async (email) => {
    const trimmed = email.trim();
    if (!client) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      set({ error: 'Enter a valid email address.' });
      return;
    }
    set({ loading: true, error: null });
    const { error } = await client.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/terminal` },
    });
    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({ loading: false, emailSentTo: trimmed, resendAvailableAt: Date.now() + MAGIC_LINK_COOLDOWN_MS });
  },

  resendMagicLink: async () => {
    const email = get().emailSentTo;
    if (!email) return;
    if (Date.now() < get().resendAvailableAt) return;
    await get().signInWithMagicLink(email);
  },

  signInWithOAuth: async (provider) => {
    if (!client) return;
    set({ loading: true, error: null });
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/terminal` },
    });
    if (error) set({ loading: false, error: error.message });
  },

  signOut: async (opts) => {
    if (!client) return;
    set({ loading: true });
    if (opts?.removeCloudSaves && get().user) {
      await get().deleteCloudSaves();
    }
    await client.auth.signOut();
    set({ loading: false, signedIn: false, user: null, emailSentTo: null });
  },

  deleteCloudSaves: async () => {
    const user = get().user;
    if (!client || !user) return;
    const store = new CloudSaveStore(client, user.id);
    for (const slot of [1, 2, 3]) {
      await store.delete(slot).catch(() => undefined);
    }
  },
}));

// Conflict reporting reaches the dialog through the auth store, without touching the store hooks.
saveManager.setConflictHandler((conflict) => {
  useAuthStore.setState({ conflict, dialog: 'conflict' });
});
