import { expect, type Page } from '@playwright/test';

export const DB_NAME = 'TapeTradingGameDB';

export interface SavedRow {
  id: string;
  slot: number;
  name: string;
  seed: string;
  mode: 'career' | 'sandbox';
  equity: number;
  simDay: number;
  updatedAt: number;
  revision: number;
  deviceId: string;
  schemaVersion: number;
  payload: string;
}

export async function dismissTutorial(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: /Skip tutorial/i });
  if (await skip.count()) {
    if (await skip.first().isVisible()) {
      await skip.first().click();
    }
  }
  await expect(skip).toHaveCount(0, { timeout: 10_000 });
}

/** Start a career from the title screen, where the first empty slot is chosen automatically. */
export async function startCareer(page: Page): Promise<void> {
  await page.goto('/');
  const start = page.getByRole('button', { name: /Start New Career/ });
  await expect(start).toBeEnabled({ timeout: 20_000 });
  await start.click();
  await page.waitForURL((url) => url.pathname === '/terminal', { timeout: 30_000 });
  await expect(page.getByText('Engine Active')).toBeVisible({ timeout: 20_000 });
  await dismissTutorial(page);
}

export async function openTitle(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Start New Career/ })).toBeEnabled({ timeout: 20_000 });
}

export async function skipToNextDay(page: Page): Promise<number> {
  const clock = page.locator('#tutorial-sim-clock');
  const before = await clock.innerText();
  await page.getByRole('button', { name: 'Skip to next session close' }).click();
  await expect
    .poll(async () => clock.innerText(), { timeout: 20_000 })
    .not.toBe(before);
  // Skipping the day opens the end-of-day settlement report.
  const continueTrading = page.getByRole('button', { name: /Continue Trading/ });
  if (await continueTrading.count()) {
    try {
      await continueTrading.first().click({ timeout: 3000 });
    } catch (error) {
      // A sync conflict can arrive first and cover the settlement report.
      try {
        await expect(page.getByRole('dialog').filter({ hasText: /Save Conflict/ })).toBeVisible({ timeout: 10_000 });
      } catch {
        throw error;
      }
    }
  }
  const text = await clock.innerText();
  const match = text.match(/Day\s+(\d+)/);
  if (!match) throw new Error(`Could not read the simulation day from "${text}"`);
  return Number(match[1]);
}

export async function simulationDay(page: Page): Promise<number> {
  const text = await page.locator('#tutorial-sim-clock').innerText();
  const match = text.match(/Day\s+(\d+)/);
  if (!match) throw new Error(`Could not read the simulation day from "${text}"`);
  return Number(match[1]);
}

export async function waitForSynced(page: Page, timeout = 30_000): Promise<void> {
  // Scope to the status bar: an open Settings dialog also renders a sync status row.
  await expect(page.locator('footer').getByText('Synced', { exact: true })).toBeVisible({ timeout });
}

/** Write a raw row into IndexedDB so damaged/unsupported saves can be exercised exactly. */
export async function seedRawSlot(page: Page, row: Partial<SavedRow> & Pick<SavedRow, 'id'>): Promise<void> {
  await page.evaluate(
    async ({ dbName, row }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('savedGames')) {
            db.close();
            reject(new Error('savedGames store is missing; let the title screen finish loading first'));
            return;
          }
          const tx = db.transaction('savedGames', 'readwrite');
          tx.objectStore('savedGames').put({
            name: 'Career 1',
            seed: 'E2E_SEED',
            mode: 'career',
            equity: 100000,
            simDay: 1,
            updatedAt: Date.now(),
            revision: 1,
            deviceId: 'e2e-device',
            schemaVersion: 1,
            ...row,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
        };
      });
    },
    { dbName: DB_NAME, row },
  );
}

export async function readStore<T = Record<string, unknown>>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    async ({ dbName, store }) => {
      return new Promise<T[]>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(store)) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction(store, 'readonly');
          const all = tx.objectStore(store).getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result as T[]);
          };
          all.onerror = () => reject(all.error ?? new Error(`Could not read ${store}`));
        };
      });
    },
    { dbName: DB_NAME, store },
  ) as Promise<T[]>;
}

export async function readSavedRows(page: Page): Promise<SavedRow[]> {
  return readStore<SavedRow>(page, 'savedGames');
}

export function parsePayload<T = Record<string, unknown>>(row: SavedRow): T {
  return JSON.parse(row.payload) as T;
}

export async function waitForLocalSave(page: Page, predicate: (rows: SavedRow[]) => boolean, timeout = 20_000): Promise<SavedRow[]> {
  let latest: SavedRow[] = [];
  await expect
    .poll(async () => {
      latest = await readSavedRows(page);
      return predicate(latest);
    }, { timeout })
    .toBe(true);
  return latest;
}

export interface PositionLike {
  ticker: string;
  shares: number;
}

export async function placeMarketBuy(page: Page, quantity = 100): Promise<void> {
  const ticket = page.locator('#tutorial-ticket');
  await expect(ticket).toBeVisible({ timeout: 20_000 });
  const input = ticket.locator('input[type="number"]').first();
  await input.fill(String(quantity));
  await ticket.getByRole('button', { name: /Place BUY Order/ }).click();
}

export async function localSessionSummary(page: Page): Promise<{ seq: number; positions: number; simDay: number; name: string }> {
  const rows = await readSavedRows(page);
  const row = rows[0];
  if (!row) throw new Error('No local save row found');
  const payload = parsePayload<{ seq?: number; game?: { simDay?: number; portfolio?: { positions?: unknown[] } } }>(row);
  return {
    seq: payload.seq ?? 0,
    positions: payload.game?.portfolio?.positions?.length ?? 0,
    simDay: payload.game?.simDay ?? row.simDay,
    name: row.name,
  };
}

export async function openAccountFromTitle(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: email, exact: true }).click();
  await expect(page.getByRole('dialog').filter({ hasText: 'Account' })).toBeVisible();
}

export async function openAccountFromTerminal(page: Page): Promise<void> {
  await page.locator('button[title="Account"]').click();
  await expect(page.getByRole('dialog').filter({ hasText: 'Account' })).toBeVisible();
}
