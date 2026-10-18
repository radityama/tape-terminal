import { expect, test } from '@playwright/test';
import { dismissTutorial, openTitle, simulationDay, skipToNextDay, startCareer, waitForLocalSave } from './helpers/app';
import { delayAuthRefresh, signInViaMagicLink, testEmail } from './helpers/auth';

/**
 * The Next proxy refreshes the session cookie server-side on every document request, so
 * editing the browser cookie cannot force a client refresh. Shifting the browser clock past
 * the freshly refreshed token's expiry does: the client must call the token endpoint, which
 * the suite holds open. This exercises the real "auth still resolving" window.
 */
async function expireClientViewOfSession(page: import('@playwright/test').Page): Promise<void> {
  await page.clock.setFixedTime(Date.now() + 3_700_000);
}

test.describe('delayed auth hydration', () => {
  test('the title screen blocks career start until a delayed session refresh resolves', async ({ page }) => {
    const email = testEmail('hydration-title');
    await signInViaMagicLink(page, email);
    await openTitle(page);
    await expireClientViewOfSession(page);

    const refresh = await delayAuthRefresh(page, 2500);
    await page.reload();

    // Nothing may look ready while auth is still resolving.
    await expect(page.getByText('Checking account...', { exact: true }).first()).toBeVisible({ timeout: 3000 });
    const start = page.getByRole('button', { name: /Start New Career/ });
    await expect(start).toBeDisabled();

    await expect(page.getByRole('button', { name: email, exact: true })).toBeVisible({ timeout: 40_000 });
    await expect(start).toBeEnabled({ timeout: 40_000 });
    await expect.poll(() => refresh.count()).toBeGreaterThan(0);
  });

  test('direct terminal navigation waits for delayed auth before loading the save', async ({ page }) => {
    const email = testEmail('hydration-terminal');
    await signInViaMagicLink(page, email);
    await startCareer(page);
    const day = await skipToNextDay(page);
    await waitForLocalSave(page, (rows) => {
      const row = rows.find((entry) => entry.slot === 1);
      if (!row) return false;
      return ((JSON.parse(row.payload) as { game?: { simDay?: number } }).game?.simDay ?? 0) >= day;
    });

    await openTitle(page);
    await expireClientViewOfSession(page);
    const refresh = await delayAuthRefresh(page, 2500);

    await page.goto('/terminal');
    await expect(page.getByRole('heading', { name: 'Checking saved game' })).toBeVisible({ timeout: 3000 });
    // Prove the screen is actually held open by auth rather than resolving instantly.
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: 'Checking saved game' })).toBeVisible();

    await expect(page.getByText('Engine Active')).toBeVisible({ timeout: 45_000 });
    await dismissTutorial(page);
    await expect.poll(async () => simulationDay(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(day);
    await expect.poll(() => refresh.count()).toBeGreaterThan(0);
  });
});
