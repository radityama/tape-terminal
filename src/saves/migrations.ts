import { MarketSimulationEngine } from '../engine/market';
import { COMPANY_MAP } from '../data/companies';
import { MAX_PRICE_FACTOR, MIN_PRICE_FACTOR, VOL_CEIL_MULT, VOL_FLOOR_MULT } from '../engine/pricing';
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

// Saves from before the price bounds fix can hold absurd or non-finite prices. Repairing them
// on load beats refusing the whole save; the player is told once through consumeSaveRepairs().
let pendingRepairs: string[] = [];

export function consumeSaveRepairs(): string[] {
  const repairs = pendingRepairs;
  pendingRepairs = [];
  return repairs;
}

function isSanePrice(value: unknown, floor: number, ceiling: number): boolean {
  // Wire saves carry decimal strings; legacy saves may carry numbers. Both are sane when in range.
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(numeric) && numeric >= floor && numeric <= ceiling;
}

export function repairPricingStates(raw: RawSave): RawSave {
  const game = raw.game as { pricing?: { states?: unknown } } | undefined;
  const states = game?.pricing?.states;
  if (!Array.isArray(states)) return raw;

  const repaired = new Set<string>();
  for (const entry of states as Array<Record<string, unknown>>) {
    if (!entry || typeof entry !== 'object') continue;
    const ticker = typeof entry.ticker === 'string' ? entry.ticker : null;
    const company = ticker ? COMPANY_MAP.get(ticker) : undefined;
    if (!company) continue;

    const fairValue = company.fundamentals.fairValue;
    const floor = fairValue * MIN_PRICE_FACTOR;
    const ceiling = fairValue * MAX_PRICE_FACTOR;
    let dirty = false;

    for (const field of ['price', 'openPrice', 'highPrice', 'lowPrice', 'previousClose', 'vwap']) {
      if (!isSanePrice(entry[field], floor, ceiling)) {
        entry[field] = fairValue;
        dirty = true;
      }
    }

    for (const field of ['change', 'changePercent']) {
      if (!isSanePrice(entry[field], Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)) {
        entry[field] = 0;
        dirty = true;
      }
    }

    const minVol = company.baseVol * VOL_FLOOR_MULT;
    const maxVol = company.baseVol * VOL_CEIL_MULT;
    if (!isSanePrice(entry.currentVol, minVol, maxVol)) {
      entry.currentVol = company.baseVol;
      dirty = true;
    }

    // Charts are display only: drop any series that contains a damaged candle.
    for (const field of ['candles1m', 'candles5m', 'candles15m', 'candles1h', 'candles1D']) {
      const candles = entry[field];
      if (!Array.isArray(candles)) continue;
      const broken = candles.some((candle) => {
        if (!candle || typeof candle !== 'object') return true;
        const c = candle as Record<string, unknown>;
        return !isSanePrice(c.open, floor, ceiling)
          || !isSanePrice(c.high, floor, ceiling)
          || !isSanePrice(c.low, floor, ceiling)
          || !isSanePrice(c.close, floor, ceiling);
      });
      if (broken) {
        entry[field] = [];
        dirty = true;
      }
    }

    if (dirty && ticker) repaired.add(ticker);
  }

  if (repaired.size > 0) pendingRepairs.push(...repaired);
  return raw;
}

// Runs the ordered migrations from the stored version up to the current one.
export function migrate(raw: RawSave): RawSave {
  const from = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (from > SCHEMA_VERSION) throw new SaveVersionError(from, SCHEMA_VERSION);

  let current = raw;
  for (const migration of migrations) {
    if (migration.to > from) current = migration.migrate(current);
  }
  current.schemaVersion = SCHEMA_VERSION;
  return repairPricingStates(current);
}

export function rawSchemaVersion(raw: RawSave): number {
  return typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
}
