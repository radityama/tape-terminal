import { expect, test } from '@playwright/test';
import { openTitle, readSavedRows, seedRawSlot, startCareer } from './helpers/app';

const CORRUPT_PAYLOAD = '{not valid json';
const NEWER_PAYLOAD = JSON.stringify({
  schemaVersion: 2,
  id: 'slot_2',
  slot: 2,
  name: 'Future Career',
  seed: 'FUTURE',
  mode: 'career',
  scenarioId: null,
  createdAt: 1,
  updatedAt: 1,
  revision: 4,
  seq: 99,
  deviceId: 'future-device',
  summary: { rank: null, equity: 100000, simDay: 9 },
  game: {},
});

test.describe('slot health', () => {
  test('corrupted and newer saves are labelled, preserved, and never silently replaced', async ({ page }) => {
    await openTitle(page);
    await seedRawSlot(page, {
      id: 'slot_1',
      slot: 1,
      name: 'Broken Career',
      simDay: 4,
      revision: 2,
      payload: CORRUPT_PAYLOAD,
    });
    await seedRawSlot(page, {
      id: 'slot_2',
      slot: 2,
      name: 'Future Career',
      simDay: 9,
      revision: 4,
      schemaVersion: 2,
      payload: NEWER_PAYLOAD,
    });
    await page.reload();

    const brokenRow = page.getByRole('button', { name: /Broken Career/ }).first();
    const futureRow = page.getByRole('button', { name: /Future Career/ }).first();
    await expect(brokenRow).toBeDisabled();
    await expect(futureRow).toBeDisabled();
    await expect(page.getByText('Unreadable save', { exact: true })).toBeVisible();
    await expect(page.getByText('Newer save version', { exact: true })).toBeVisible();

    // The raw bytes stay available for recovery, scoped to the damaged row.
    const downloadPromise = page.waitForEvent('download');
    await brokenRow.locator('..').getByRole('button', { name: 'Export original save' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('tape-slot-1-raw.json');
    const stream = await download.createReadStream();
    let exported = '';
    for await (const chunk of stream) exported += String(chunk);
    expect(exported).toBe(CORRUPT_PAYLOAD);

    // Slot 3 is empty, so a new career lands there without touching the damaged rows.
    await startCareer(page);
    await page.goto('/');
    const rows = await readSavedRows(page);
    expect(rows.find((row) => row.slot === 1)?.payload).toBe(CORRUPT_PAYLOAD);
    expect(rows.find((row) => row.slot === 2)?.payload).toBe(NEWER_PAYLOAD);

    // All slots occupied: only the healthy local slot may be offered for replacement.
    await page.getByRole('button', { name: /Start New Career/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('All save slots are full')).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(1);
    await expect(dialog.getByText('Broken Career')).toHaveCount(0);
    await expect(dialog.getByText('Future Career')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('all-unhealthy slots offer no unsafe replacement', async ({ page }) => {
    await openTitle(page);
    await seedRawSlot(page, { id: 'slot_1', slot: 1, name: 'Broken One', payload: CORRUPT_PAYLOAD, revision: 2 });
    await seedRawSlot(page, {
      id: 'slot_2',
      slot: 2,
      name: 'Future Two',
      revision: 3,
      schemaVersion: 2,
      payload: NEWER_PAYLOAD,
    });
    await seedRawSlot(page, { id: 'slot_3', slot: 3, name: 'Broken Three', payload: 'null', revision: 1 });
    await page.reload();

    await page.getByRole('button', { name: /Start New Career/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('No slot can be safely replaced here. Export or recover the occupied saves first.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Choose a slot to replace' })).toBeDisabled();
    await expect(dialog.getByRole('radio')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const rows = await readSavedRows(page);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.slot === 3)?.payload).toBe('null');
  });
});
