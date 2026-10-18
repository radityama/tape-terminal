import { expect, test, type Page } from '@playwright/test';
import {
  openAccountFromTerminal,
  openAccountFromTitle,
  openTitle,
  skipToNextDay,
  startCareer,
  waitForSynced,
} from './helpers/app';
import { signInViaMagicLink, testEmail } from './helpers/auth';
import { cloudSaveCount, cloudSlots } from './helpers/db';

async function createCareerAndSync(page: Page): Promise<void> {
  await startCareer(page);
  await waitForSynced(page);
}

async function openDeleteConfirmation(page: Page, expectedCount: number): Promise<void> {
  const account = page.getByRole('dialog').filter({ hasText: 'Account' });
  await expect(account.getByRole('button', { name: 'Delete my cloud saves' })).toBeEnabled({ timeout: 20_000 });
  await account.getByRole('button', { name: 'Delete my cloud saves' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('heading', { name: 'Delete cloud saves?' })).toBeVisible();
  await expect(confirm.getByText(`This deletes ${expectedCount} cloud ${expectedCount === 1 ? 'save' : 'saves'} from your account.`)).toBeVisible();
  await confirm.getByRole('button', { name: `Delete ${expectedCount} cloud ${expectedCount === 1 ? 'save' : 'saves'}` }).click();
}

test.describe('cloud deletion lifecycle', () => {
  test('deleting cloud saves keeps local progress, disables sync, and can be re-enabled', async ({ page }) => {
    const email = testEmail('delete-success');
    await signInViaMagicLink(page, email);
    await createCareerAndSync(page);
    await openTitle(page);
    await createCareerAndSync(page);
    await openTitle(page);
    expect(cloudSaveCount(email)).toBe(2);

    await openAccountFromTitle(page, email);
    await openDeleteConfirmation(page, 2);
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
    expect(cloudSaveCount(email)).toBe(0);

    // Local saves stay exactly where they were.
    await expect(page.getByRole('button', { name: /Career 1/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Career 2/ }).first()).toBeVisible();

    // Still the same page load: deletion must keep sync disabled until explicitly re-enabled.
    await openAccountFromTitle(page, email);
    const account = page.getByRole('dialog').filter({ hasText: 'Account' });
    await expect(account.getByText('Cloud sync is disabled after deletion. Local saves remain on this device.')).toBeVisible();
    await account.getByRole('button', { name: 'Enable cloud sync again' }).click();
    const enable = page.getByRole('alertdialog');
    await expect(enable.getByText('Local saves may be uploaded to your account again.')).toBeVisible();
    await enable.getByRole('button', { name: 'Enable cloud sync' }).click();
    await expect(enable).toHaveCount(0);

    // A later local save may be uploaded again after an explicit re-enable.
    await page.goto('/terminal');
    await expect(page.getByText('Engine Active')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Settings & Saves' }).click();
    const settings = page.getByRole('dialog').filter({ hasText: 'Terminal Settings & Save Slots' });
    await settings.getByRole('button', { name: 'Save', exact: true }).first().click();
    await waitForSynced(page);
    expect(cloudSaveCount(email)).toBe(1);
  });

  test('a failed deletion stays paused, keeps local saves, and succeeds on retry', async ({ page }) => {
    const email = testEmail('delete-retry');
    await signInViaMagicLink(page, email);
    await createCareerAndSync(page);
    await openTitle(page);

    let deletes = 0;
    await page.route('**/rest/v1/saves**', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      deletes += 1;
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'simulated deletion failure', code: 'XX000' }),
      });
    });

    await openAccountFromTitle(page, email);
    await openDeleteConfirmation(page, 1);

    const account = page.getByRole('dialog').filter({ hasText: 'Account' });
    await expect(account.getByRole('alert')).toContainText('Could not delete cloud save 1.');
    await expect(account.getByText('Cloud sync is paused while deletion is incomplete. Local saves remain on this device.')).toBeVisible();
    expect(deletes).toBeGreaterThan(0);
    expect(cloudSaveCount(email)).toBe(1);

    await page.unroute('**/rest/v1/saves**');
    await account.getByRole('button', { name: 'Delete my cloud saves' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByRole('heading', { name: 'Delete cloud saves?' })).toBeVisible();
    await expect(confirm.getByText('This deletes 1 cloud save from your account.')).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete 1 cloud save' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 });
    expect(cloudSaveCount(email)).toBe(0);

    // No reload between deletion and reopening Account: the disabled state is session state.
    await expect(page.getByRole('button', { name: /Career 1/ }).first()).toBeVisible();
    await openAccountFromTitle(page, email);
    await expect(page.getByText('Cloud sync is disabled after deletion. Local saves remain on this device.')).toBeVisible();
  });

  test('a preflight abort restores sync and names the real cause without deleting', async ({ page }) => {
    const email = testEmail('delete-preflight');
    await signInViaMagicLink(page, email);
    await createCareerAndSync(page);

    const heldWrite: { release: (() => void) | null } = { release: null };
    let writeStarted = false;
    await page.route('**/rest/v1/saves**', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      writeStarted = true;
      await new Promise<void>((resolve) => { heldWrite.release = resolve; });
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'held' }) });
    });

    // Trigger a local save whose cloud write will be held open past the deletion preflight.
    await skipToNextDay(page);
    await expect.poll(() => writeStarted, { timeout: 20_000 }).toBe(true);

    await openAccountFromTerminal(page);
    await openDeleteConfirmation(page, 1);

    const account = page.getByRole('dialog').filter({ hasText: 'Account' });
    await expect(account.getByRole('alert')).toContainText('A cloud save is still syncing. Retry deletion in a moment.', {
      timeout: 25_000,
    });
    // The failed preflight must release the pause so normal syncing resumes.
    await expect(account.getByText(/Cloud sync is paused/)).toHaveCount(0);
    expect(cloudSaveCount(email)).toBe(1);
    expect(cloudSlots(email)).toEqual([1]);

    heldWrite.release?.();
  });
});
