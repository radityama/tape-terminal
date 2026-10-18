import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { dismissTutorial, openTitle, skipToNextDay, startCareer, waitForSynced } from './helpers/app';
import { signInViaMagicLink, testEmail } from './helpers/auth';
import { cloudRevision, cloudSlots } from './helpers/db';

function conflictDialog(page: Page, slot: number) {
  return page.getByRole('dialog').filter({ hasText: new RegExp(`Save Conflict in Slot ${slot}`) });
}

interface ConflictSetup {
  email: string;
  slot: number;
  contextA: BrowserContext;
  contextB: BrowserContext;
  pageA: Page;
  pageB: Page;
}

/**
 * Two independent browser profiles signed into one disposable account. Device B loads the
 * cloud copy, diverges with cloud writes failing, then device A pushes newer progress.
 */
async function createDivergedConflict(browser: Browser, label: string): Promise<ConflictSetup> {
  const email = testEmail(label);
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await signInViaMagicLink(pageA, email);
  await startCareer(pageA);
  await waitForSynced(pageA);
  const slot = cloudSlots(email)[0];
  expect(slot).toBeTruthy();

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await signInViaMagicLink(pageB, email);
  await openTitle(pageB);
  const cloudRow = pageB.getByRole('button', { name: new RegExp(`Career ${slot}`) }).first();
  await expect(cloudRow).toContainText('Cloud');
  await cloudRow.click();
  await pageB.waitForURL((url) => url.pathname === '/terminal', { timeout: 30_000 });
  await expect(pageB.getByText('Engine Active')).toBeVisible({ timeout: 20_000 });
  await dismissTutorial(pageB);

  // Writes fail on B while reads still work: B keeps local progress but cannot push.
  await pageB.route('**/rest/v1/saves**', async (route) => {
    if (route.request().method() === 'GET') return route.continue();
    return route.abort('failed');
  });
  await skipToNextDay(pageB);

  // A moves ahead and successfully publishes a newer cloud revision.
  await skipToNextDay(pageA);
  await waitForSynced(pageA);

  // B tries again against the stale base revision, which must surface a conflict.
  await pageB.unroute('**/rest/v1/saves**');
  await skipToNextDay(pageB);
  await expect(conflictDialog(pageB, slot)).toBeVisible({ timeout: 30_000 });

  return { email, slot, contextA, contextB, pageA, pageB };
}

test.describe('local and cloud progress conflicts', () => {
  test('conflicting copies are shown side by side and Keep both preserves both', async ({ browser }) => {
    const setup = await createDivergedConflict(browser, 'conflict-both');
    const { pageB, email, slot } = setup;
    try {
      const dialog = conflictDialog(pageB, slot);
      await expect(dialog.getByText('This device', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Cloud', { exact: true })).toBeVisible();
      await expect(dialog.getByText(/Seq \d+/)).toHaveCount(2);
      await expect(dialog.getByText('Nothing is overwritten until you choose.')).toBeVisible();

      await dialog.getByRole('button', { name: 'Keep both' }).click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });

      await openTitle(pageB);
      await expect(pageB.getByRole('button', { name: /\(this device\)/ }).first()).toBeVisible();
      await expect(pageB.getByRole('button', { name: new RegExp(`Career ${slot}`) }).first()).toBeVisible();
      expect(cloudSlots(email).sort()).toEqual([1, 2]);
    } finally {
      await setup.contextA.close();
      await setup.contextB.close();
    }
  });

  test('Keep this device publishes the local copy over the cloud revision', async ({ browser }) => {
    const setup = await createDivergedConflict(browser, 'conflict-keep');
    const { pageB, email, slot } = setup;
    try {
      const before = cloudRevision(email, slot);
      expect(before).not.toBeNull();

      const dialog = conflictDialog(pageB, slot);
      await dialog.getByRole('button', { name: 'Keep this device' }).click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });
      await waitForSynced(pageB);

      expect(cloudRevision(email, slot)).toBeGreaterThan(before ?? 0);
      expect(cloudSlots(email)).toEqual([slot]);
    } finally {
      await setup.contextA.close();
      await setup.contextB.close();
    }
  });
});
