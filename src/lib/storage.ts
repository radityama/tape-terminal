import Dexie, { Table } from 'dexie';

export interface SavedGameState {
  id: string; // e.g. "autosave", "slot_1", "slot_2", "slot_3"
  name: string;
  seed: string;
  simDay: number;
  mode: 'career' | 'sandbox';
  equity: number;
  cash: number;
  savedAt: number;
  positionsJson: string;
  tradesJson: string;
  careerJson: string;
}

export interface StoredTickRecord {
  id?: number;
  ticker: string;
  time: number;
  price: number;
  volume: number;
}

export class TapeDatabase extends Dexie {
  savedGames!: Table<SavedGameState, string>;
  tickHistory!: Table<StoredTickRecord, number>;

  constructor() {
    super('TapeTradingGameDB');
    this.version(1).stores({
      savedGames: 'id, name, simDay, savedAt',
      tickHistory: '++id, ticker, time',
    });
  }
}

export const db = new TapeDatabase();

export async function saveGameSlot(
  slotId: string,
  name: string,
  data: {
    seed: string;
    simDay: number;
    mode: 'career' | 'sandbox';
    equity: number;
    cash: number;
    positions: any[];
    trades: any[];
    career: any;
  }
) {
  try {
    await db.savedGames.put({
      id: slotId,
      name,
      seed: data.seed,
      simDay: data.simDay,
      mode: data.mode,
      equity: data.equity,
      cash: data.cash,
      savedAt: Date.now(),
      positionsJson: JSON.stringify(data.positions),
      tradesJson: JSON.stringify(data.trades),
      careerJson: JSON.stringify(data.career),
    });
    return true;
  } catch (err) {
    console.error('Failed to save game state to IndexedDB', err);
    return false;
  }
}

export async function loadGameSlot(slotId: string): Promise<SavedGameState | undefined> {
  try {
    return await db.savedGames.get(slotId);
  } catch (err) {
    console.error('Failed to load game slot from IndexedDB', err);
    return undefined;
  }
}

export async function listAllSaves(): Promise<SavedGameState[]> {
  try {
    return await db.savedGames.toArray();
  } catch (err) {
    console.error('Failed to list saves from IndexedDB', err);
    return [];
  }
}

export async function exportSaveJson(slotId: string): Promise<string | null> {
  const save = await loadGameSlot(slotId);
  if (!save) return null;
  return JSON.stringify(save, null, 2);
}

export async function importSaveJson(jsonStr: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(jsonStr) as SavedGameState;
    if (!parsed.id || !parsed.seed) return false;
    await db.savedGames.put(parsed);
    return true;
  } catch (err) {
    console.error('Invalid save game JSON format', err);
    return false;
  }
}
