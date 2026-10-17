import { Profile, ProfileSchema, SaveGame, SaveGameSchema, SaveMeta, SCHEMA_VERSION } from './schema';
import {
  LocalSaveStore,
  PutResult,
  readProfile,
  SaveCorruptError,
  SaveStore,
  SaveVersionError,
  writeProfile,
} from './localStore';
import { migrate, rawSchemaVersion, RawSave } from './migrations';
import { CloudSaveStore } from './cloudStore';

// Plain text shown in the top bar. Guests only ever see 'saved_locally'.
export type SaveStatus = 'saved_locally' | 'syncing' | 'synced' | 'offline' | 'sync_failed';

export interface CaptureFields {
  name: string;
  seed: string;
  mode: 'career' | 'sandbox';
  scenarioId: string | null;
  summary: { rank: string | null; equity: number; simDay: number };
  game: SaveGame['game'];
}

export interface SyncConflict {
  slot: number;
  remoteRevision: number;
  remote: SaveMeta | null;
}

export type SyncOutcome =
  | { status: 'noop' | 'queued' | 'synced' }
  | { status: 'conflict'; conflict: SyncConflict }
  | { status: 'failed'; message: string };

export interface MergedSlot {
  slot: number;
  meta: SaveMeta;
  origin: 'local' | 'cloud' | 'both';
  localUpdatedAt?: number;
  cloudUpdatedAt?: number;
}

export interface SaveManagerHooks {
  // Read the live game out of the store. Returns null when there is no game to save.
  capture: (slot: number) => CaptureFields | null;
  // Apply a loaded save to the store and engine.
  restore: (save: SaveGame) => void;
  onStatus?: (status: SaveStatus) => void;
  onConflict?: (conflict: SyncConflict) => void;
}

export type LoadOutcome =
  | { ok: true; save: SaveGame }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'newer'; error: SaveVersionError }
  | { ok: false; reason: 'corrupt'; error: SaveCorruptError };

const DEVICE_KEY = 'tape_device_id';
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;

function readDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `dev_${Date.now().toString(36)}`;
    window.localStorage.setItem(DEVICE_KEY, generated);
    return generated;
  } catch {
    return 'unknown';
  }
}

class SaveManagerImpl {
  private store: SaveStore = new LocalSaveStore();
  private cloud: CloudSaveStore | null = null;
  private hooks: SaveManagerHooks | null = null;
  private deviceId = 'server';
  private activeSlot = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private saving = false;
  // Last cloud revision we saw for a slot. Without it we never push, so we can never clobber silently.
  private baseRevision = new Map<number, number>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_BASE_MS;
  private inFlight = new Set<number>();
  private conflictHandler: ((conflict: SyncConflict) => void) | null = null;

  init(hooks: SaveManagerHooks): void {
    this.hooks = hooks;
    this.deviceId = readDeviceId();
  }

  // Registered separately from init() so the auth layer can listen without clobbering the store hooks.
  setConflictHandler(handler: ((conflict: SyncConflict) => void) | null): void {
    this.conflictHandler = handler;
  }

  setStore(store: SaveStore): void {
    this.store = store;
  }

  setCloudStore(store: CloudSaveStore | null): void {
    this.cloud = store;
    this.baseRevision.clear();
    this.retryDelay = RETRY_BASE_MS;
    this.emitStatus(store ? 'synced' : 'saved_locally');
  }

  hasCloud(): boolean {
    return this.cloud !== null;
  }

  setActiveSlot(slot: number): void {
    this.activeSlot = slot;
  }

  getActiveSlot(): number {
    return this.activeSlot;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  listSlots(): Promise<SaveMeta[]> {
    return this.store.list();
  }

  // Merge local and cloud slot lists, newest wins, and label where each came from.
  async listAllSlots(): Promise<MergedSlot[]> {
    const local = await this.listSlots().catch(() => [] as SaveMeta[]);
    const cloud = this.cloud ? await this.cloud.list().catch(() => [] as SaveMeta[]) : [];
    const merged = new Map<number, MergedSlot>();

    for (const meta of local) {
      merged.set(meta.slot, { slot: meta.slot, meta, origin: 'local', localUpdatedAt: meta.updatedAt });
    }
    for (const meta of cloud) {
      const existing = merged.get(meta.slot);
      if (existing) {
        existing.origin = 'both';
        existing.cloudUpdatedAt = meta.updatedAt;
        if (meta.updatedAt > (existing.localUpdatedAt ?? 0)) existing.meta = meta;
      } else {
        merged.set(meta.slot, { slot: meta.slot, meta, origin: 'cloud', cloudUpdatedAt: meta.updatedAt });
      }
    }
    return [...merged.values()].sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  }

  async load(slot: number): Promise<LoadOutcome> {
    try {
      if (this.cloud && this.baseRevision.get(slot) === undefined) {
        // Prefer the cloud copy when the player has an account and picks a slot.
        const cloudMeta = await this.cloud.getMeta(slot);
        if (cloudMeta) {
          const cloudSave = await this.cloud.get(slot);
          if (cloudSave) {
            this.baseRevision.set(slot, cloudMeta.revision);
            this.activeSlot = slot;
            this.hooks?.restore(cloudSave);
            return { ok: true, save: cloudSave };
          }
        }
      }

      const save = await this.store.get(slot);
      if (!save) return { ok: false, reason: 'missing' };
      this.activeSlot = slot;
      this.hooks?.restore(save);
      return { ok: true, save };
    } catch (err) {
      if (err instanceof SaveVersionError) return { ok: false, reason: 'newer', error: err };
      if (err instanceof SaveCorruptError) return { ok: false, reason: 'corrupt', error: err };
      throw err;
    }
  }

  // Best-effort read used as the base for the next write. A damaged save must not block saving a new one.
  private async baseSave(slot: number): Promise<SaveGame | null> {
    try {
      return await this.store.get(slot);
    } catch {
      return null;
    }
  }

  private buildSave(slot: number, existing: SaveGame | null): SaveGame | null {
    const fields = this.hooks?.capture(slot);
    if (!fields) return null;
    const now = Date.now();
    return {
      schemaVersion: SCHEMA_VERSION,
      id: `slot_${slot}`,
      slot,
      name: fields.name,
      seed: fields.seed,
      mode: fields.mode,
      scenarioId: fields.scenarioId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      revision: existing?.revision ?? 1,
      deviceId: this.deviceId,
      summary: fields.summary,
      game: fields.game,
    };
  }

  async save(slot: number = this.activeSlot): Promise<PutResult> {
    const existing = await this.baseSave(slot);
    const save = this.buildSave(slot, existing);
    if (!save) return { ok: false, reason: 'invalid', message: 'there is no active game to save' };
    const result = await this.store.put(save, { expectedRevision: existing?.revision });
    if (result.ok) {
      this.emitStatus(this.cloud ? 'synced' : 'saved_locally');
      if (this.cloud) void this.syncSlot(slot);
    }
    return result;
  }

  async deleteSlot(slot: number): Promise<void> {
    await this.store.delete(slot);
    this.baseRevision.delete(slot);
  }

  async exportJson(slot: number = this.activeSlot): Promise<string | null> {
    const save = await this.baseSave(slot);
    if (!save) return null;
    return JSON.stringify(SaveGameSchema.encode(save), null, 2);
  }

  async importJson(json: string): Promise<PutResult> {
    let parsed: RawSave;
    try {
      parsed = JSON.parse(json) as RawSave;
    } catch {
      return { ok: false, reason: 'invalid', message: 'Not valid JSON.' };
    }
    const version = rawSchemaVersion(parsed);
    if (version > SCHEMA_VERSION) {
      return { ok: false, reason: 'invalid', message: new SaveVersionError(version, SCHEMA_VERSION).message };
    }
    let migrated: RawSave;
    try {
      migrated = migrate(parsed);
    } catch (err) {
      return { ok: false, reason: 'invalid', message: err instanceof Error ? err.message : 'Migration failed.' };
    }
    const validated = SaveGameSchema.safeParse(migrated);
    if (!validated.success) return { ok: false, reason: 'invalid', message: validated.error.message };

    const save = { ...validated.data, deviceId: this.deviceId };
    return this.store.put(save, { expectedRevision: undefined });
  }

  // Autosave is debounced so a burst of triggers (a whole sim day of ticks) writes once.
  noteDirty(delayMs = 1500): void {
    this.pending = true;
    this.scheduleFlush(delayMs);
  }

  noteSimDay(): void {
    this.noteDirty(400);
  }

  notePause(): void {
    this.noteDirty(300);
  }

  private scheduleFlush(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delayMs);
  }

  async flush(): Promise<void> {
    if (!this.pending || this.saving) return;
    this.pending = false;
    this.saving = true;
    try {
      await this.save(this.activeSlot);
    } finally {
      this.saving = false;
    }
  }

  // Push one slot to the cloud. Never pushes a slot whose cloud base revision is unknown:
  // a pre-existing cloud row in that case is reported as a conflict for the player to resolve.
  async syncSlot(slot: number = this.activeSlot): Promise<SyncOutcome> {
    if (!this.cloud) return { status: 'noop' };
    if (this.inFlight.has(slot)) return { status: 'queued' };

    const local = await this.baseSave(slot);
    if (!local) return { status: 'noop' };

    this.inFlight.add(slot);
    this.emitStatus('syncing');
    try {
      const expected = this.baseRevision.get(slot);

      if (expected === undefined) {
        const remote = await this.cloud.getMeta(slot);
        if (remote) {
          this.emitStatus('sync_failed');
          const conflict: SyncConflict = { slot, remoteRevision: remote.revision, remote };
          this.conflictHandler?.(conflict);
          return { status: 'conflict', conflict };
        }
      }

      const result = await this.cloud.put(local, expected !== undefined ? { expectedRevision: expected } : undefined);

      if (result.ok) {
        this.baseRevision.set(slot, result.revision);
        this.retryDelay = RETRY_BASE_MS;
        this.emitStatus('synced');
        return { status: 'synced' };
      }

      if (result.reason === 'conflict') {
        const remote = await this.cloud.getMeta(slot).catch(() => null);
        const conflict: SyncConflict = { slot, remoteRevision: result.remoteRevision, remote };
        this.conflictHandler?.(conflict);
        return { status: 'conflict', conflict };
      }

      this.scheduleRetry(slot);
      return { status: 'failed', message: result.reason === 'invalid' ? result.message : result.reason };
    } catch (err) {
      this.scheduleRetry(slot);
      return { status: 'failed', message: err instanceof Error ? err.message : 'sync failed' };
    } finally {
      this.inFlight.delete(slot);
    }
  }

  private scheduleRetry(slot: number): void {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    this.emitStatus(offline ? 'offline' : 'sync_failed');
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => void this.syncSlot(slot), delay);
  }

  // Conflict resolution: keep the local device's copy, overwriting the cloud at the given revision.
  async keepLocal(slot: number, remoteRevision: number): Promise<SyncOutcome> {
    if (!this.cloud) return { status: 'noop' };
    const local = await this.baseSave(slot);
    if (!local) return { status: 'noop' };
    const result = await this.cloud.put(local, { expectedRevision: remoteRevision });
    if (result.ok) {
      this.baseRevision.set(slot, result.revision);
      this.emitStatus('synced');
      return { status: 'synced' };
    }
    if (result.reason === 'conflict') {
      const remote = await this.cloud.getMeta(slot).catch(() => null);
      return { status: 'conflict', conflict: { slot, remoteRevision: result.remoteRevision, remote } };
    }
    return { status: 'failed', message: result.reason === 'invalid' ? result.message : result.reason };
  }

  // Conflict resolution: take the cloud copy and load it into this device.
  async useCloud(slot: number): Promise<SyncOutcome> {
    if (!this.cloud) return { status: 'noop' };
    try {
      const meta = await this.cloud.getMeta(slot);
      const remote = await this.cloud.get(slot);
      if (!remote) return { status: 'noop' };
      await this.store.put(remote, { expectedRevision: undefined });
      if (meta) this.baseRevision.set(slot, meta.revision);
      this.hooks?.restore(remote);
      this.emitStatus('synced');
      return { status: 'synced' };
    } catch (err) {
      return { status: 'failed', message: err instanceof Error ? err.message : 'sync failed' };
    }
  }

  // Conflict resolution: keep both by copying this device's copy into a free slot.
  async keepBoth(slot: number): Promise<{ status: 'kept'; freeSlot: number } | { status: 'full' }> {
    const used = new Set<number>();
    for (const meta of await this.listSlots().catch(() => [] as SaveMeta[])) used.add(meta.slot);
    if (this.cloud) {
      for (const meta of await this.cloud.list().catch(() => [] as SaveMeta[])) used.add(meta.slot);
    }
    const freeSlot = [1, 2, 3].find((s) => !used.has(s));
    if (freeSlot === undefined) return { status: 'full' };

    const local = await this.baseSave(slot);
    if (local) {
      const copy = { ...local, slot: freeSlot, id: `slot_${freeSlot}`, name: `${local.name} (this device)`.slice(0, 40) };
      await this.store.put(copy, { expectedRevision: undefined });
      if (this.cloud) await this.cloud.put(copy, { expectedRevision: undefined });
    }
    await this.useCloud(slot);
    return { status: 'kept', freeSlot };
  }

  // Explicit upload used by the claim flow. Overwrites the cloud slot by design.
  async uploadSlot(slot: number): Promise<PutResult> {
    const local = await this.baseSave(slot);
    if (!local) return { ok: false, reason: 'invalid', message: 'slot is empty' };
    if (!this.cloud) return { ok: false, reason: 'invalid', message: 'not signed in' };
    const result = await this.cloud.put(local, { expectedRevision: undefined });
    if (result.ok) this.baseRevision.set(slot, result.revision);
    return result;
  }

  // Profile blob: last write wins by updatedAt.
  async syncProfile(): Promise<void> {
    if (!this.cloud) return;
    try {
      const local = await this.loadProfile();
      const remote = await this.cloud.getProfile();
      const localUpdated = local?.updatedAt ?? 0;
      const remoteUpdated = remote?.updatedAt ?? 0;

      if (remote && remoteUpdated > localUpdated) {
        const parsed = ProfileSchema.safeParse(remote.data);
        if (parsed.success) await this.saveProfile(parsed.data);
      } else if (local && localUpdated > remoteUpdated) {
        await this.cloud.putProfile(ProfileSchema.encode(local));
      }
    } catch {
      // Profile sync is best effort; it must never block gameplay.
    }
  }

  async loadProfile(): Promise<Profile | null> {
    const raw = await readProfile();
    if (!raw) return null;
    const parsed = ProfileSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async saveProfile(profile: Profile): Promise<void> {
    await writeProfile(ProfileSchema.encode(profile), profile.updatedAt);
  }

  private emitStatus(status: SaveStatus): void {
    this.hooks?.onStatus?.(status);
  }
}

export const saveManager = new SaveManagerImpl();
