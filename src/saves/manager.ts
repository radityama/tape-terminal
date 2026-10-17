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

export interface SaveManagerHooks {
  // Read the live game out of the store. Returns null when there is no game to save.
  capture: (slot: number) => CaptureFields | null;
  // Apply a loaded save to the store and engine.
  restore: (save: SaveGame) => void;
  onStatus?: (status: SaveStatus) => void;
}

export type LoadOutcome =
  | { ok: true; save: SaveGame }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'newer'; error: SaveVersionError }
  | { ok: false; reason: 'corrupt'; error: SaveCorruptError };

const DEVICE_KEY = 'tape_device_id';

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
  private hooks: SaveManagerHooks | null = null;
  private deviceId = 'server';
  private activeSlot = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  private saving = false;

  init(hooks: SaveManagerHooks): void {
    this.hooks = hooks;
    this.deviceId = readDeviceId();
  }

  setStore(store: SaveStore): void {
    this.store = store;
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

  async load(slot: number): Promise<LoadOutcome> {
    try {
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
    if (result.ok) this.emitStatus('saved_locally');
    return result;
  }

  async deleteSlot(slot: number): Promise<void> {
    await this.store.delete(slot);
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
