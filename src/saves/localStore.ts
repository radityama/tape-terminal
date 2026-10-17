import Dexie, { Table } from 'dexie';
import { SaveMeta, SaveGame, SaveGameSchema, saveToMeta, SCHEMA_VERSION, SAVE_SIZE_HARD_LIMIT } from './schema';
import { migrate, RawSave, rawSchemaVersion, SaveVersionError } from './migrations';

export { SaveVersionError } from './migrations';

export type PutResult =
  | { ok: true; revision: number }
  | { ok: false; reason: 'conflict'; remoteRevision: number }
  | { ok: false; reason: 'too_large' }
  | { ok: false; reason: 'invalid'; message: string };

export interface SaveStore {
  list(): Promise<SaveMeta[]>;
  get(slot: number): Promise<SaveGame | null>;
  put(save: SaveGame, opts?: { expectedRevision?: number }): Promise<PutResult>;
  delete(slot: number): Promise<void>;
}

// A save that is damaged or unreadable. The caller must never delete it; it must offer a recovery path.
export class SaveCorruptError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super('This save is damaged and could not be read.');
    this.name = 'SaveCorruptError';
    this.detail = detail;
  }
}

export interface StoredTickRecord {
  id?: number;
  ticker: string;
  time: number;
  price: number;
  volume: number;
}

// Row shape for v2+. Legacy rows from v1 have none of these except id/name/seed/mode/equity/savedAt.
interface SaveRow {
  id: string;
  slot?: number;
  name: string;
  seed: string;
  mode: 'career' | 'sandbox';
  equity?: number;
  simDay?: number;
  savedAt?: number;
  updatedAt?: number;
  revision?: number;
  deviceId?: string;
  schemaVersion?: number;
  payload?: string;
}

interface BackupRow {
  id?: number;
  slot: number;
  savedAt: number;
  payload: string;
}

export interface ProfileRow {
  key: string;
  value: string;
  updatedAt: number;
}

export class TapeDatabase extends Dexie {
  savedGames!: Table<SaveRow, string>;
  tickHistory!: Table<StoredTickRecord, number>;
  backups!: Table<BackupRow, number>;
  profiles!: Table<ProfileRow, string>;

  constructor() {
    super('TapeTradingGameDB');
    this.version(1).stores({
      savedGames: 'id, name, simDay, savedAt',
      tickHistory: '++id, ticker, time',
    });
    this.version(2).stores({
      savedGames: 'id, slot, name, updatedAt',
      tickHistory: '++id, ticker, time',
      backups: '++id, slot, savedAt',
      profiles: 'key',
    });
  }
}

export const db = new TapeDatabase();

const slotId = (slot: number) => `slot_${slot}`;

function rowToSave(row: SaveRow): SaveGame {
  const raw: RawSave =
    typeof row.payload === 'string' ? (JSON.parse(row.payload) as RawSave) : (row as unknown as RawSave);

  const version = rawSchemaVersion(raw);
  if (version > SCHEMA_VERSION) throw new SaveVersionError(version, SCHEMA_VERSION);

  const migrated = migrate(raw);
  const parsed = SaveGameSchema.safeParse(migrated);
  if (!parsed.success) throw new SaveCorruptError(parsed.error.message);
  return parsed.data;
}

function saveToRow(save: SaveGame, revision: number): SaveRow {
  return {
    id: slotId(save.slot),
    slot: save.slot,
    name: save.name,
    seed: save.seed,
    mode: save.mode,
    equity: save.summary.equity,
    simDay: save.summary.simDay,
    updatedAt: save.updatedAt,
    revision,
    deviceId: save.deviceId,
    schemaVersion: SCHEMA_VERSION,
    payload: JSON.stringify(SaveGameSchema.encode({ ...save, revision })),
  };
}

export class LocalSaveStore implements SaveStore {
  async list(): Promise<SaveMeta[]> {
    const rows = await db.savedGames.toArray();
    const metas: SaveMeta[] = [];
    for (const row of rows) {
      const slot = row.slot ?? legacySlot(row.id);
      if (typeof row.payload === 'string') {
        try {
          metas.push(saveToMeta(rowToSave(row)));
        } catch {
          // Unreadable rows are skipped here so one damaged save cannot break the list. get() surfaces the error.
        }
      } else {
        metas.push({
          slot,
          name: row.name ?? 'Career',
          seed: row.seed,
          mode: row.mode,
          rank: null,
          equity: row.equity ?? 100000,
          simDay: row.simDay ?? 1,
          updatedAt: row.savedAt ?? 0,
          revision: 0,
          deviceId: 'legacy',
        });
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(slot: number): Promise<SaveGame | null> {
    const row = await db.savedGames.get(slotId(slot));
    if (!row) return null;

    const raw: RawSave =
      typeof row.payload === 'string' ? (JSON.parse(row.payload) as RawSave) : (row as unknown as RawSave);
    const version = rawSchemaVersion(raw);
    if (version > SCHEMA_VERSION) throw new SaveVersionError(version, SCHEMA_VERSION);

    // Copy the raw record before migrating so a bad migration can never lose the original.
    if (version < SCHEMA_VERSION) await this.backup(slot, raw);

    const save = rowToSave(row);
    if (version < SCHEMA_VERSION) await db.savedGames.put(saveToRow(save, save.revision));
    return save;
  }

  async put(save: SaveGame, opts?: { expectedRevision?: number }): Promise<PutResult> {
    let encoded: unknown;
    try {
      encoded = SaveGameSchema.encode(save);
    } catch (err) {
      return { ok: false, reason: 'invalid', message: err instanceof Error ? err.message : 'invalid save' };
    }

    const json = JSON.stringify(encoded);
    if (json.length > SAVE_SIZE_HARD_LIMIT) return { ok: false, reason: 'too_large' };

    const existing = await db.savedGames.get(slotId(save.slot));
    const existingRevision = typeof existing?.revision === 'number' ? existing.revision : undefined;

    if (opts?.expectedRevision !== undefined && existingRevision !== undefined && existingRevision !== opts.expectedRevision) {
      return { ok: false, reason: 'conflict', remoteRevision: existingRevision };
    }

    const revision = existingRevision !== undefined ? existingRevision + 1 : 1;
    await db.savedGames.put({ ...saveToRow(save, revision), payload: json });
    return { ok: true, revision };
  }

  async delete(slot: number): Promise<void> {
    await db.savedGames.delete(slotId(slot));
  }

  private async backup(slot: number, raw: RawSave): Promise<void> {
    await db.backups.add({ slot, savedAt: Date.now(), payload: JSON.stringify(raw) });
    const rows = await db.backups.where('slot').equals(slot).sortBy('savedAt');
    while (rows.length > 3) {
      const oldest = rows.shift();
      if (oldest?.id != null) await db.backups.delete(oldest.id);
    }
  }
}

function legacySlot(id: string): number {
  const match = /^slot_(\d+)$/.exec(id);
  const n = match ? Number(match[1]) : 1;
  return n >= 1 && n <= 3 ? n : 1;
}

export async function readProfile(): Promise<unknown | null> {
  const row = await db.profiles.get('profile');
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export async function writeProfile(value: unknown, updatedAt: number): Promise<void> {
  await db.profiles.put({ key: 'profile', value: JSON.stringify(value), updatedAt });
}
