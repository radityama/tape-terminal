import { expect, test } from '@playwright/test';
import {
  dismissTutorial,
  localSessionSummary,
  placeMarketBuy,
  readSavedRows,
  simulationDay,
  skipToNextDay,
  startCareer,
  waitForLocalSave,
} from './helpers/app';

test.describe('guest saves', () => {
  test('guest trade and simulation day survive autosave and reload', async ({ page }) => {
    await startCareer(page);
    const day = await skipToNextDay(page);

    await placeMarketBuy(page, 100);
    const rows = await waitForLocalSave(page, (saved) => {
      const row = saved.find((entry) => entry.slot === 1);
      if (!row) return false;
      const payload = JSON.parse(row.payload) as {
        game?: { portfolio?: { positions?: Array<{ ticker: string }> } };
      };
      return Boolean(payload.game?.portfolio?.positions?.some((position) => position.ticker === 'HLVG'));
    });
    const before = await localSessionSummary(page);
    expect(before.positions).toBeGreaterThanOrEqual(1);
    expect(before.simDay).toBeGreaterThanOrEqual(day);
    expect(rows.some((row) => row.slot === 1)).toBe(true);

    // Full reload: the terminal must restore the same career from IndexedDB, not start over.
    await page.reload();
    await expect(page.getByText('Engine Active')).toBeVisible({ timeout: 30_000 });
    await dismissTutorial(page);
    await expect.poll(async () => simulationDay(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(day);

    const after = await localSessionSummary(page);
    expect(after.seq).toBeGreaterThanOrEqual(before.seq);
    expect(after.positions).toBeGreaterThanOrEqual(1);
    expect(after.simDay).toBeGreaterThanOrEqual(day);

    await expect(page.getByRole('button', { name: /Positions \(1\)/ })).toBeVisible();
    await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  });

  test('listing an existing guest save offers resume and does not rewrite it', async ({ page }) => {
    await startCareer(page);
    const day = await skipToNextDay(page);
    // Autosave is debounced; wait for the day to be durable before leaving the terminal.
    const before = await waitForLocalSave(page, (rows) => {
      const row = rows.find((entry) => entry.slot === 1);
      if (!row) return false;
      const payload = JSON.parse(row.payload) as { game?: { simDay?: number } };
      return (payload.game?.simDay ?? 0) >= day;
    });

    await page.goto('/');
    const slotRow = page.getByRole('button', { name: /Career 1/ }).first();
    await expect(slotRow).toBeEnabled();
    await expect(slotRow).toContainText('This device');

    await slotRow.click();
    await page.waitForURL((url) => url.pathname === '/terminal', { timeout: 30_000 });
    await expect(page.getByText('Engine Active')).toBeVisible({ timeout: 20_000 });
    await dismissTutorial(page);
    await expect.poll(async () => simulationDay(page)).toBeGreaterThanOrEqual(day);

    const after = await readSavedRows(page);
    expect(after.find((row) => row.slot === 1)?.revision).toBe(before.find((row) => row.slot === 1)?.revision);
  });
});
