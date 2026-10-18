import { expect, test } from '@playwright/test';
import {
  dismissTutorial,
  openTitle,
  seedRawSlot,
  simulationDay,
  skipToNextDay,
  startCareer,
  waitForLocalSave,
} from './helpers/app';

test.describe('direct terminal navigation', () => {
  test('an empty browser starts a fresh session on /terminal without a redirect', async ({ page }) => {
    await page.goto('/terminal');
    await expect(page).toHaveURL(/\/terminal$/);
    await expect(page.getByText('Engine Active')).toBeVisible({ timeout: 30_000 });
    await dismissTutorial(page);
    await expect.poll(async () => simulationDay(page)).toBe(1);
  });

  test('an existing guest save is restored on direct navigation', async ({ page }) => {
    await startCareer(page);
    const day = await skipToNextDay(page);
    await waitForLocalSave(page, (rows) => {
      const row = rows.find((entry) => entry.slot === 1);
      if (!row) return false;
      return ((JSON.parse(row.payload) as { game?: { simDay?: number } }).game?.simDay ?? 0) >= day;
    });

    await page.goto('/terminal');
    await expect(page.getByText('Engine Active')).toBeVisible({ timeout: 30_000 });
    await dismissTutorial(page);
    await expect.poll(async () => simulationDay(page)).toBeGreaterThanOrEqual(day);
  });

  test('a corrupted save blocks session start and points back to the slots', async ({ page }) => {
    await openTitle(page);
    await seedRawSlot(page, { id: 'slot_1', slot: 1, name: 'Broken Career', payload: '{broken', revision: 2 });
    await page.goto('/terminal');

    await expect(page.getByRole('heading', { name: 'Save recovery needed' })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('p[role="alert"]')).toContainText('This local save could not be read. Its original data is still stored.');
    await page.getByRole('link', { name: 'Inspect saves' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Unreadable save', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Broken Career/ }).first()).toBeDisabled();
  });

  test('a save from a newer build is reported as unsupported and preserved', async ({ page }) => {
    await openTitle(page);
    await seedRawSlot(page, {
      id: 'slot_1',
      slot: 1,
      name: 'Future Career',
      schemaVersion: 2,
      revision: 4,
      payload: JSON.stringify({ schemaVersion: 2, id: 'slot_1', slot: 1 }),
    });
    await page.goto('/terminal');

    await expect(page.getByRole('heading', { name: 'Save recovery needed' })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('p[role="alert"]')).toContainText('This local save was made by a newer version of TAPE. Its original data is still stored.');
    await page.getByRole('link', { name: 'Inspect saves' }).click();
    await expect(page.getByText('Newer save version', { exact: true })).toBeVisible();
  });
});
