import { PROFILE_SIZE_LIMIT, Profile, ProfileSchema, SaveGame, SaveGameSchema, SaveMeta, SCHEMA_VERSION, summarizeIssues } from './schema';
import {
  LocalSaveStore,
  PutResult,
  SaveCorruptError,
  SaveStore,
  SaveVersionError,
  SlotHealth,
  readProfile,
  writeProfile,
} from './localStore';
import { consumeSaveRepairs, migrate, rawSchemaVersion, RawSave } from './migrations';

// Plain text shown in the terminal status bar and the Settings save row.
// Guests only ever see 'saved_locally'.
export type SaveStatus = 'saved_locally' | 'syncing' | 'synced' | 'offline' | 'sync_failed';
export type CloudSyncLifecycle = 'active' | 'paused_for_deletion' | 'disabled_after_deletion';

export interface CaptureFields {
  engineId: string | null;
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
  health: SlotHealth;
}

export interface SaveManagerHooks {
  // Read the live game out of the store. Returns null when there is no game to save.
  capture: (slot: number) => CaptureFields | null;
  // Apply a loaded save to the store and engine.
  restore: (save: SaveGame) => void;
  onStatus?: (status: SaveStatus) => void;
  onConflict?: (conflict: SyncConflict) => void;
  // One-line player-facing notice, for example when a loaded save had damaged prices repaired.
  onNotice?: (message: string) => void;
  // Read the profile (settings, tutorial progress, layouts) out of the live store.
  captureProfile?: () => Profile | null;
  // Apply a cloud profile to the live store after it wins the last-write-wins comparison.
  applyProfile?: (profile: Profile) => void;
}

export type LoadOutcome =
  | { ok: true; save: SaveGame }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'conflict' }
  | { ok: false; reason: 'newer'; error: SaveVersionError }
  | { ok: false; reason: 'corrupt'; error: SaveCorruptError };

// Structural type so tests can mock the cloud; CloudSaveStore satisfies it.
export interface CloudSaveAdapter {
  list(): Promise<SaveMeta[]>;
  get(slot: number): Promise<SaveGame | null>;
  getMeta(slot: number): Promise<SaveMeta | null>;
  put(save: SaveGame, opts?: { expectedRevision?: number; force?: boolean }): Promise<PutResult>;
  delete(slot: number): Promise<void>;
  getProfile(): Promise<{ data: unknown; updatedAt: number } | null>;
  putProfile(data: unknown): Promise<void>;
}

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
  private cloud: CloudSaveAdapter | null = null;
  private hooks: SaveManagerHooks | null = null;
  private deviceId = 'server';
  private activeSlot = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private saving = false;
  private flushPromise: Promise<void> | null = null;
  // Last cloud revision we saw for a slot. Without it we never push, so we can never clobber silently.
  private baseRevision = new Map<number, number>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_BASE_MS;
  private inFlight = new Set<number>();
  private conflictHandler: ((conflict: SyncConflict) => void) | null = null;

  // Hydration gate: captures are allowed only for a ready session bound to a known engine id.
  private session: { phase: 'none' | 'loading' | 'ready'; slot: number; engineId: string | null } = {
    phase: 'none',
    slot: 1,
    engineId: null,
  };

  // Truthful status machine inputs. 'synced' requires a successful push, a non-dirty
  // local snapshot, and no pending retry. Never claimed just because a write succeeded.
  private dirty = false;
  private dirtyWhilePushing = false;
  private lastPushFailed = false;
  private lastPushOk = false;
  private cloudTimer: ReturnType<typeof setTimeout> | null = null;
  private profileTimer: ReturnType<typeof setTimeout> | null = null;
  private warnedSeqRefusal = false;
  private cloudSyncState: CloudSyncLifecycle = 'active';
  private cloudGeneration = 0;

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

  // Session lifecycle. bindSession marks 'loading'; the caller flips to ready once the
  // engine that owns the session exists and has consumed the loaded state.
  bindSession(slot: number, engineId: string | null): void {
    this.session = { phase: 'loading', slot, engineId };
    this.activeSlot = slot;
  }

  markSessionReady(): void {
    if (this.session.phase !== 'none') {
      this.session.phase = 'ready';
      this.updateStatus();
    }
  }

  endSession(): void {
    this.session = { phase: 'none', slot: 1, engineId: null };
    this.updateStatus();
  }

  private sessionReadyForCapture(engineId: string | null, slot = this.activeSlot): boolean {
    return this.session.phase === 'ready' && this.session.slot === slot && this.session.engineId === engineId && engineId !== null;
  }

  setCloudStore(store: CloudSaveAdapter | null): void {
    if (this.cloud === store) return;
    this.cloud = store;
    this.cloudGeneration += 1;
    this.cloudSyncState = 'active';
    this.baseRevision.clear();
    this.retryDelay = RETRY_BASE_MS;
    this.lastPushOk = false;
    this.lastPushFailed = false;
    if (this.cloudTimer) {
      clearTimeout(this.cloudTimer);
      this.cloudTimer = null;
    }
    this.updateStatus();
    // Sign-in can resolve after a local slot was restored. Adopt the cloud revision as the
    // base when the local copy is at least as new, so the next push updates instead of
    // reporting a spurious conflict against the player's own save.
    if (store && this.session.phase === 'ready') void this.adoptCloudBase(this.activeSlot);
  }

  private async adoptCloudBase(slot: number): Promise<void> {
    const cloud = this.cloud;
    const generation = this.cloudGeneration;
    if (!cloud) return;
    try {
      const remote = await cloud.getMeta(slot);
      if (!remote) return;
      const local = await this.baseSave(slot);
      const cloudSave = local ? await cloud.get(slot) : null;
      if (generation !== this.cloudGeneration) return;
      if (local && cloudSave && local.seed === cloudSave.seed && local.createdAt === cloudSave.createdAt
        && local.mode === cloudSave.mode && local.scenarioId === cloudSave.scenarioId
        && local.deviceId === cloudSave.deviceId && local.seq >= cloudSave.seq
        && (local.seq !== cloudSave.seq || JSON.stringify(local.game) === JSON.stringify(cloudSave.game))) {
        this.baseRevision.set(slot, remote.revision);
        this.updateStatus();
      }
    } catch {
      // Best effort: the next push falls back to the conflict path.
    }
  }

  hasCloud(): boolean {
    return this.cloud !== null;
  }

  async pauseCloudWrites(timeoutMs = 10000): Promise<void> {
    this.cloudSyncState = 'paused_for_deletion';
    this.updateStatus();
    if (this.cloudTimer) clearTimeout(this.cloudTimer);
    this.cloudTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const deadline = Date.now() + timeoutMs;
    while (this.inFlight.size > 0) {
      if (Date.now() >= deadline) {
        this.resumeCloudWrites();
        throw new Error('Cloud write is still in progress');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  resumeCloudWrites(): void {
    if (this.cloudSyncState !== 'paused_for_deletion') return;
    this.cloudSyncState = 'active';
    this.updateStatus();
    if (this.dirty && this.cloud) this.scheduleCloudPush(this.activeSlot);
  }

  disableCloudWritesAfterDeletion(): void {
    if (this.cloudSyncState === 'paused_for_deletion') {
      this.cloudSyncState = 'disabled_after_deletion';
      this.baseRevision.clear();
      this.updateStatus();
    }
  }

  enableCloudWritesAfterDeletion(): void {
    if (this.cloudSyncState !== 'disabled_after_deletion') return;
    this.cloudSyncState = 'active';
    this.updateStatus();
    if (this.dirty && this.cloud) this.scheduleCloudPush(this.activeSlot);
  }

  getCloudSyncState(): CloudSyncLifecycle { return this.cloudSyncState; }

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

  // This is an occupancy listing, not a source selection. Device clocks cannot decide
  // which snapshot will be loaded; load() compares the complete saves instead.
  async listAllSlots(): Promise<MergedSlot[]> {
    const local = this.store instanceof LocalSaveStore
      ? await this.store.inspectSlots()
      : (await this.listSlots()).map((meta) => ({ meta, health: 'healthy' as const }));
    const cloud = this.cloud ? await this.cloud.list() : [];
    const merged = new Map<number, MergedSlot>();

    for (const { meta, health } of local) {
      merged.set(meta.slot, { slot: meta.slot, meta, health, origin: 'local', localUpdatedAt: meta.updatedAt });
    }
    for (const meta of cloud) {
      const existing = merged.get(meta.slot);
      if (existing) {
        existing.origin = 'both';
        existing.cloudUpdatedAt = meta.updatedAt;
      } else {
        merged.set(meta.slot, { slot: meta.slot, meta, health: 'healthy', origin: 'cloud', cloudUpdatedAt: meta.updatedAt });
      }
    }
    return [...merged.values()].sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  }

  async load(slot: number, canApply: () => boolean = () => true): Promise<LoadOutcome> {
    try {
      // Drop repairs recorded by unrelated list or scan decodes before this load.
      consumeSaveRepairs();
      const cloud = this.cloud;
      const local = await this.store.get(slot);
      if (!canApply() || cloud !== this.cloud) throw new Error('Session changed while loading');
      const cloudMeta = cloud ? await cloud.getMeta(slot) : null;
      if (!canApply() || cloud !== this.cloud) throw new Error('Session changed while loading');
      const remote = cloudMeta ? await cloud?.get(slot) : null;
      if (!canApply() || cloud !== this.cloud) throw new Error('Session changed while loading');
      if (cloudMeta && !remote) throw new Error('Cloud save changed while loading. Retry before starting a session.');

      let save = local ?? remote;
      if (local && remote) {
        const sameCareer = local.seed === remote.seed && local.createdAt === remote.createdAt
          && local.mode === remote.mode && local.scenarioId === remote.scenarioId;
        if (!sameCareer || local.deviceId !== remote.deviceId) return { ok: false, reason: 'conflict' };
        if (local.seq === remote.seq) {
          if (JSON.stringify(local.game) !== JSON.stringify(remote.game)) return { ok: false, reason: 'conflict' };
          save = local;
        } else {
          save = local.seq > remote.seq ? local : remote;
        }
      }
      if (!save) return { ok: false, reason: 'missing' };
      if (!canApply()) throw new Error('Session changed while loading');
      if (cloudMeta) this.baseRevision.set(slot, cloudMeta.revision);
      this.activeSlot = slot;
      this.hooks?.restore(save);
      this.notifyRepairs();
      return { ok: true, save };
    } catch (err) {
      if (err instanceof SaveVersionError) return { ok: false, reason: 'newer', error: err };
      if (err instanceof SaveCorruptError) return { ok: false, reason: 'corrupt', error: err };
      throw err;
    }
  }

  // Tell the player once that a damaged price was repaired while loading.
  private notifyRepairs(): void {
    const repaired = consumeSaveRepairs();
    if (repaired.length > 0) {
      this.hooks?.onNotice?.(`Repaired damaged prices in this save: ${repaired.length} symbols reset to fair value.`);
    }
  }

  // The caller supplies the revision shown to the player in the replacement dialog.
  async replaceSlot(slot: number, expectedRevision: number): Promise<PutResult> {
    const fields = this.hooks?.capture(slot);
    if (!fields || !this.sessionReadyForCapture(fields.engineId, slot)) {
      return { ok: false, reason: 'invalid', message: 'No ready session to replace the slot' };
    }
    const game = fields.game;
    const now = Date.now();
    const save: Omit<SaveGame, 'game'> = {
      schemaVersion: SCHEMA_VERSION,
      id: `slot_${slot}`,
      slot,
      name: fields.name,
      seed: fields.seed,
      mode: fields.mode,
      scenarioId: fields.scenarioId,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      seq: game.simDay,
      deviceId: this.deviceId,
      summary: fields.summary,
    };
    if (!(this.store instanceof LocalSaveStore)) return { ok: false, reason: 'invalid', message: 'Replacement requires local backup support' };
    const result = await this.store.replace({ ...save, game }, expectedRevision);
    if (result.ok) {
      this.dirty = true;
      if (this.inFlight.has(slot)) this.dirtyWhilePushing = true;
      this.updateStatus();
      this.scheduleCloudPush(slot);
    }
    return result;
  }

  // Previous autosave from the rolling history: decode it, put it back in the slot and restore.
  async restoreHistory(slot: number): Promise<boolean> {
    const local = this.store instanceof LocalSaveStore ? this.store : null;
    if (!local) return false;
    const save = await local.restoreHistory(slot);
    if (!save) return false;
    this.baseRevision.delete(slot);
    this.hooks?.restore(save);
    return true;
  }

  async hasHistory(slot: number): Promise<boolean> {
    const local = this.store instanceof LocalSaveStore ? this.store : null;
    return local ? local.hasHistory(slot) : false;
  }

  // Reads for display may fail, but writes must never infer an empty slot from a failed read.
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
      seq: fields.game.actionSeq,
      deviceId: this.deviceId,
      summary: fields.summary,
      game: fields.game,
    };
  }

  async save(slot: number = this.activeSlot, opts?: { force?: boolean }): Promise<PutResult> {
    if (opts?.force) return { ok: false, reason: 'invalid', message: 'Use confirmed replacement for an occupied slot' };
    let existing: SaveGame | null;
    try {
      existing = await this.store.get(slot);
    } catch {
      return { ok: false, reason: 'invalid', message: 'Existing save could not be checked' };
    }
    const fields = this.hooks?.capture(slot);
    if (!fields) return { ok: false, reason: 'invalid', message: 'there is no active game to save' };

    // Hydration gate: never capture during 'loading' or from an engine that is not the bound one.
    if (!this.sessionReadyForCapture(fields.engineId, slot)) {
      return { ok: false, reason: 'invalid', message: 'no session is ready to capture' };
    }

    const save = this.buildSave(slot, existing);
    if (!save) return { ok: false, reason: 'invalid', message: 'there is no active game to save' };

    // Monotonic seq guard. A stale engine (a fresh title screen engine, an old tab) must
    // never replace newer progress. Explicit player choices use force to bypass this once.
    if (existing && save.seq < existing.seq) {
      if (!this.warnedSeqRefusal) {
        console.warn('Autosave skipped, it would have replaced newer progress');
        this.warnedSeqRefusal = true;
      }
      this.updateStatus();
      return { ok: false, reason: 'invalid', message: 'Autosave skipped, it would have replaced newer progress' };
    }

    const result = await this.store.put(save, { expectedRevision: existing?.revision });
    if (result.ok) {
      this.dirty = true;
      if (this.inFlight.size > 0) this.dirtyWhilePushing = true;
      this.updateStatus();
      this.scheduleCloudPush(slot);
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

  async exportRaw(slot: number): Promise<string | null> {
    return this.store instanceof LocalSaveStore ? this.store.exportRaw(slot) : null;
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
    if (!validated.success) return { ok: false, reason: 'invalid', message: summarizeIssues(validated.error) };

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

  // Fills, order changes and similar player actions write local storage immediately
  // (so a reload can never lose the trade) and only debounce the cloud push.
  notePlayerAction(): void {
    this.pending = true;
    void this.flush();
    this.scheduleCloudPush(this.activeSlot);
  }

  private scheduleFlush(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delayMs);
  }

  private scheduleCloudPush(slot: number, delayMs = 2000): void {
    if (!this.cloud || this.cloudSyncState !== 'active') return;
    if (this.cloudTimer) clearTimeout(this.cloudTimer);
    this.cloudTimer = setTimeout(() => {
      this.cloudTimer = null;
      void this.syncSlot(slot);
    }, delayMs);
  }

  // Test and pagehide hook: flush the local write and the pending cloud push now.
  async flushCloudPush(): Promise<SyncOutcome> {
    if (this.cloudTimer) {
      clearTimeout(this.cloudTimer);
      this.cloudTimer = null;
    }
    return this.syncSlot();
  }

  async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    if (!this.pending || this.saving) return;
    this.pending = false;
    this.saving = true;
    const task = this.save(this.activeSlot).then(() => undefined).finally(() => {
      this.saving = false;
      this.flushPromise = null;
    });
    this.flushPromise = task;
    await task;
  }

  // Push one slot to the cloud. Never pushes a slot whose cloud base revision is unknown:
  // a pre-existing cloud row in that case is reported as a conflict for the player to resolve.
  async syncSlot(slot: number = this.activeSlot): Promise<SyncOutcome> {
    if (!this.cloud || this.cloudSyncState !== 'active') return { status: 'noop' };
    if (this.inFlight.has(slot)) return { status: 'queued' };

    let local: SaveGame | null;
    try {
      local = await this.store.get(slot);
    } catch {
      this.lastPushFailed = true;
      this.updateStatus();
      return { status: 'failed', message: 'Could not read the local save for cloud sync.' };
    }
    if (!local) return { status: 'noop' };
    if (this.cloudSyncState !== 'active' || !this.cloud) return { status: 'noop' };

    const cloud = this.cloud;
    const generation = this.cloudGeneration;

    this.inFlight.add(slot);
    this.updateStatus();
    let pushed = false;
    try {
      // Nothing unpushed: do not fire a pointless write.
      if (!this.dirty) return { status: 'noop' };

      const expected = this.baseRevision.get(slot);

      if (expected === undefined) {
        const remote = await cloud.getMeta(slot);
        if (this.cloudSyncState !== 'active' || generation !== this.cloudGeneration) return { status: 'noop' };
        if (remote) {
          this.lastPushFailed = false;
          const conflict: SyncConflict = { slot, remoteRevision: remote.revision, remote };
          this.conflictHandler?.(conflict);
          return { status: 'conflict', conflict };
        }
      }

      const result = await cloud.put(local, expected !== undefined ? { expectedRevision: expected } : undefined);
      if (generation !== this.cloudGeneration) return { status: 'noop' };

      if (result.ok) {
        pushed = true;
        this.baseRevision.set(slot, result.revision);
        this.retryDelay = RETRY_BASE_MS;
        this.lastPushOk = true;
        this.lastPushFailed = false;
        this.dirty = this.dirtyWhilePushing;
        this.dirtyWhilePushing = false;
        this.updateStatus();
        return { status: 'synced' };
      }

      if (result.reason === 'conflict') {
        this.lastPushFailed = false;
        const remote = await cloud.getMeta(slot).catch(() => null);
        const conflict: SyncConflict = { slot, remoteRevision: result.remoteRevision, remote };
        this.conflictHandler?.(conflict);
        return { status: 'conflict', conflict };
      }

      this.lastPushFailed = true;
      this.scheduleRetry(slot);
      return { status: 'failed', message: result.reason === 'invalid' ? result.message : result.reason };
    } catch (err) {
      if (generation !== this.cloudGeneration) return { status: 'noop' };
      this.lastPushFailed = true;
      this.scheduleRetry(slot);
      return { status: 'failed', message: err instanceof Error ? err.message : 'sync failed' };
    } finally {
      this.inFlight.delete(slot);
      if (pushed && this.dirty && this.cloudSyncState === 'active') this.scheduleCloudPush(slot);
      this.updateStatus();
    }
  }

  private scheduleRetry(slot: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      void this.syncSlot(slot);
    }, delay);
  }

  // Conflict resolution: keep the local device's copy, overwriting the cloud at the given revision.
  async keepLocal(slot: number, remoteRevision: number): Promise<SyncOutcome> {
    const cloud = this.cloud;
    const generation = this.cloudGeneration;
    if (!cloud) return { status: 'noop' };
    let local: SaveGame | null;
    try {
      local = await this.store.get(slot);
    } catch {
      return { status: 'failed', message: 'Could not read the local save. The cloud copy was not changed.' };
    }
    if (generation !== this.cloudGeneration) return { status: 'failed', message: 'Account changed. Retry after checking your saves.' };
    if (!local) return { status: 'noop' };
    const result = await cloud.put(local, { expectedRevision: remoteRevision });
    if (generation !== this.cloudGeneration) return { status: 'failed', message: 'Account changed. Retry after checking your saves.' };
    if (result.ok) {
      this.baseRevision.set(slot, result.revision);
      this.lastPushOk = true;
      this.dirty = false;
      this.lastPushFailed = false;
      this.updateStatus();
      return { status: 'synced' };
    }
    if (result.reason === 'conflict') {
      const remote = await cloud.getMeta(slot).catch(() => null);
      return { status: 'conflict', conflict: { slot, remoteRevision: result.remoteRevision, remote } };
    }
    this.lastPushFailed = true;
    this.updateStatus();
    return { status: 'failed', message: result.reason === 'invalid' ? result.message : result.reason };
  }

  // Conflict resolution: take the cloud copy and load it into this device.
  async useCloud(slot: number): Promise<SyncOutcome> {
    const cloud = this.cloud;
    const generation = this.cloudGeneration;
    if (!cloud) return { status: 'noop' };
    try {
      const meta = await cloud.getMeta(slot);
      const remote = await cloud.get(slot);
      if (generation !== this.cloudGeneration) return { status: 'failed', message: 'Account changed. Retry after checking your saves.' };
      if (!remote) return { status: 'noop' };
      const local = await this.store.get(slot);
      if (generation !== this.cloudGeneration) return { status: 'failed', message: 'Account changed. Retry after checking your saves.' };
      const result = local && this.store instanceof LocalSaveStore
        ? await this.store.replace(remote, local.revision)
        : await this.store.put(remote);
      if (!result.ok) return { status: 'failed', message: 'Could not safely preserve the local copy.' };
      if (meta) this.baseRevision.set(slot, meta.revision);
      this.hooks?.restore(remote);
      this.lastPushOk = true;
      this.dirty = false;
      this.lastPushFailed = false;
      this.updateStatus();
      return { status: 'synced' };
    } catch (err) {
      this.lastPushFailed = true;
      this.updateStatus();
      return { status: 'failed', message: err instanceof Error ? err.message : 'sync failed' };
    }
  }

  // Conflict resolution: keep both by copying this device's copy into a free slot.
  async keepBoth(slot: number): Promise<{ status: 'kept'; freeSlot: number } | { status: 'full' | 'failed' }> {
    const cloud = this.cloud;
    const generation = this.cloudGeneration;
    const used = new Set<number>();
    for (const meta of await this.listSlots()) used.add(meta.slot);
    if (cloud) {
      for (const meta of await cloud.list()) used.add(meta.slot);
    }
    if (generation !== this.cloudGeneration) return { status: 'failed' };
    const freeSlot = [1, 2, 3].find((s) => !used.has(s));
    if (freeSlot === undefined) return { status: 'full' };

    const local = await this.store.get(slot);
    if (generation !== this.cloudGeneration) return { status: 'failed' };
    if (local) {
      const copy = { ...local, slot: freeSlot, id: `slot_${freeSlot}`, name: `${local.name} (this device)`.slice(0, 40) };
      const localResult = await this.store.put(copy);
      if (!localResult.ok) return { status: 'failed' };
      if (cloud) {
        const cloudResult = await cloud.put(copy, { expectedRevision: undefined });
        if (!cloudResult.ok) return { status: 'failed' };
      }
    }
    if (generation !== this.cloudGeneration) return { status: 'failed' };
    const loaded = await this.useCloud(slot);
    if (loaded.status !== 'synced') return { status: 'failed' };
    return { status: 'kept', freeSlot };
  }

  // Explicit upload used by the claim flow. Overwrites the cloud slot by design.
  async uploadSlot(slot: number): Promise<PutResult> {
    const cloud = this.cloud;
    const generation = this.cloudGeneration;
    const local = await this.store.get(slot);
    if (!local) return { ok: false, reason: 'invalid', message: 'slot is empty' };
    if (!cloud || generation !== this.cloudGeneration) return { ok: false, reason: 'invalid', message: 'account changed or not signed in' };
    // Never push a snapshot whose progress is behind the cloud copy.
    const remote = await cloud.getMeta(slot);
    if (generation !== this.cloudGeneration) return { ok: false, reason: 'invalid', message: 'account changed' };
    if (remote?.seq != null && local.seq < remote.seq) {
      return { ok: false, reason: 'invalid', message: 'The cloud copy has newer progress than this device.' };
    }
    const result = await cloud.put(local, { expectedRevision: undefined });
    if (generation !== this.cloudGeneration) return { ok: false, reason: 'invalid', message: 'account changed' };
    if (result.ok) {
      this.baseRevision.set(slot, result.revision);
      this.lastPushOk = true;
      this.updateStatus();
    }
    return result;
  }

  // Profile blob: last write wins by updatedAt. Runs on sign in and after local changes.
  async syncProfile(): Promise<void> {
    if (!this.cloud) return;
    try {
      const local = await this.loadProfile();
      const remote = await this.cloud.getProfile();
      const localUpdated = local?.updatedAt ?? 0;
      const remoteUpdated = remote?.updatedAt ?? 0;

      if (remote && remoteUpdated > localUpdated) {
        const parsed = ProfileSchema.safeParse(remote.data);
        // A malformed cloud profile must never crash or overwrite the device copy.
        if (!parsed.success) return;
        await this.saveProfile(parsed.data);
        this.hooks?.applyProfile?.(parsed.data);
        return;
      }

      // Equal or older cloud copy: nothing to pull. No local copy: materialize the live
      // state so a first sign in still creates the cloud row.
      if (local && remoteUpdated >= localUpdated) return;
      const winner = local ?? this.captureProfile();
      if (!winner) return;
      if (!local) await this.saveProfile(winner);
      await this.pushProfile(winner);
    } catch {
      // Profile sync is best effort; it must never block gameplay.
    }
  }

  // A setting that lives in the profile changed: write local at once, debounce the cloud push.
  async noteProfileChange(): Promise<void> {
    const profile = this.captureProfile();
    if (!profile) return;
    const previous = await this.loadProfile();
    // Keep updatedAt strictly monotonic so two devices cannot tie.
    const normalized: Profile = { ...profile, updatedAt: Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1) };
    const parsed = ProfileSchema.safeParse(normalized);
    if (!parsed.success) return;
    await this.saveProfile(parsed.data);
    if (!this.cloud) return;
    if (this.profileTimer) clearTimeout(this.profileTimer);
    this.profileTimer = setTimeout(() => {
      this.profileTimer = null;
      void this.pushProfile(parsed.data);
    }, 1500);
  }

  // Flush the debounced profile push now (pagehide and tests).
  async flushProfilePush(): Promise<void> {
    if (this.profileTimer) {
      clearTimeout(this.profileTimer);
      this.profileTimer = null;
    }
    await this.syncProfile();
  }

  private captureProfile(): Profile | null {
    const profile = this.hooks?.captureProfile?.() ?? null;
    if (!profile) return null;
    const parsed = ProfileSchema.safeParse(profile);
    return parsed.success ? parsed.data : null;
  }

  private async pushProfile(profile: Profile): Promise<void> {
    if (!this.cloud) return;
    const encoded = ProfileSchema.encode(profile);
    if (JSON.stringify(encoded).length > PROFILE_SIZE_LIMIT) return;
    try {
      await this.cloud.putProfile(encoded);
    } catch {
      // Best effort: a failed profile push must not affect saving the game.
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

  // Single source of truth for the footer status. Derived from state, never from the last event.
  private computeStatus(): SaveStatus {
    if (!this.cloud) return 'saved_locally';
    if (this.cloudSyncState !== 'active') return 'saved_locally';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    if (this.cloudTimer !== null || this.inFlight.size > 0) return 'syncing';
    if (this.lastPushFailed) return 'sync_failed';
    if (!this.lastPushOk || this.dirty) return 'saved_locally';
    return 'synced';
  }

  private updateStatus(): void {
    this.emitStatus(this.computeStatus());
  }
}

export const saveManager = new SaveManagerImpl();
