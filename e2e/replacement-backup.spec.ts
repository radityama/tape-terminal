import { expect, test } from '@playwright/test';
import { openTitle, readSavedRows, readStore, startCareer } from './helpers/app';

test.describe('explicit slot replacement', () => {
  test('replacing an occupied slot keeps a recoverable backup and a keyboard-safe dialog', async ({ page }) => {
    // Fill all three slots through the real career flow.
    await startCareer(page);
    await startCareer(page);
    await startCareer(page);
    await openTitle(page);

    const before = await readSavedRows(page);
    const oldSlotTwo = JSON.parse(before.find((row) => row.slot === 2)!.payload) as { name: string; createdAt: number };

    await page.getByRole('button', { name: /Start New Career/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('All save slots are full')).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(3);

    // A destructive dialog opens with the safe action focused and Escape cancels it.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''))
      .toBe('Cancel');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Start New Career/ })).toBeEnabled();

    await page.getByRole('button', { name: /Start New Career/ }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(oldSlotTwo.name, { exact: true })).toBeVisible();
    await dialog.getByRole('radio').nth(1).check();
    await dialog.getByRole('button', { name: new RegExp(`Replace ${oldSlotTwo.name}`) }).click();

    await page.waitForURL((url) => url.pathname === '/terminal', { timeout: 30_000 });
    await expect(page.getByText('Engine Active')).toBeVisible({ timeout: 20_000 });

    const backups = await readStore<{ slot: number; payload: string }>(page, 'backups');
    const backup = backups.filter((row) => row.slot === 2);
    expect(backup.length).toBeGreaterThanOrEqual(1);
    const preserved = JSON.parse(backup[backup.length - 1].payload) as { name: string; createdAt: number };
    expect(preserved.name).toBe(oldSlotTwo.name);
    expect(preserved.createdAt).toBe(oldSlotTwo.createdAt);

    const after = await readSavedRows(page);
    const newSlotTwo = JSON.parse(after.find((row) => row.slot === 2)!.payload) as { createdAt: number; summary: { simDay: number } };
    expect(newSlotTwo.createdAt).not.toBe(oldSlotTwo.createdAt);
    expect(newSlotTwo.summary.simDay).toBe(1);
  });
});
