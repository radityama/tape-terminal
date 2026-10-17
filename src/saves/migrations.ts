import { MarketSimulationEngine } from '../engine/market';
import { SCHEMA_VERSION } from './schema';

export type RawSave = Record<string, unknown>;

// Thrown when a save was written by a newer build than this one. Never delete data on this error.
export class SaveVersionError extends Error {
  readonly found: number;
  readonly current: number;

  constructor(found: number, current: number) {
    super(`This save was made by a newer version of TAPE (save v${found}, this build reads up to v${current}).`);
    this.name = 'SaveVersionError';
    this.found = found;
    this.current = current;
  }
}

interface Migration {
  to: number;
  migrate: (raw: RawSave) => RawSave;
}

// Saves written before schemaVersion existed hold only summary fields and JSON strings,
// never a full engine state. There is no way to replay to the exact moment, so v1 rebuilds a
// deterministic engine at the saved seed and starting balance, matching the old loader exactly.
function legacyToV1(raw: RawSave): RawSave {
  const id = typeof raw.id === 'string' ? raw.id : 'slot_1';
  const slotMatch = /^slot_(\d+)$/.exec(id);
  const slot = slotMatch ? Number(slotMatch[1]) : 1;
  const seed = typeof raw.seed === 'string' ? raw.seed : 'TAPE_1337';
  const mode = raw.mode === 'sandbox' ? 'sandbox' : 'career';
  const equity = typeof raw.equity === 'number' ? raw.equity : 100000;
  const savedAt = typeof raw.savedAt === 'number' ? raw.savedAt : Date.now();
  const simDay = typeof raw.simDay === 'number' ? raw.simDay : 1;
  const name = (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Career').slice(0, 40);

  const game = new MarketSimulationEngine(seed, equity).exportState();
  game.actionSeq = simDay;

  return {
    schemaVersion: 1,
    id,
    slot: slot >= 1 && slot <= 3 ? slot : 1,
    name,
    seed,
    mode,
    scenarioId: null,
    createdAt: savedAt,
    updatedAt: savedAt,
    revision: 1,
    seq: typeof raw.seq === 'number' ? raw.seq : simDay,
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : 'legacy',
    summary: { rank: null, equity, simDay },
    game,
  };
}

const migrations: Migration[] = [{ to: 1, migrate: legacyToV1 }];

// Runs the ordered migrations from the stored version up to the current one.
export function migrate(raw: RawSave): RawSave {
  const from = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (from > SCHEMA_VERSION) throw new SaveVersionError(from, SCHEMA_VERSION);

  let current = raw;
  for (const migration of migrations) {
    if (migration.to > from) current = migration.migrate(current);
  }
  current.schemaVersion = SCHEMA_VERSION;
  return current;
}

export function rawSchemaVersion(raw: RawSave): number {
  return typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
}
