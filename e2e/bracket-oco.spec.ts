import { expect, test, type Page } from '@playwright/test';
import {
  dismissTutorial,
  parsePayload,
  startCareer,
  waitForLocalSave,
  type SavedRow,
} from './helpers/app';

async function placeBracketBuy(page: Page, takeProfit: string, stopLoss: string): Promise<void> {
  const ticket = page.locator('#tutorial-ticket');
  await expect(ticket).toBeVisible({ timeout: 20_000 });
  const inputs = ticket.locator('input[type="number"]');
  await inputs.first().fill('1');
  await ticket.getByRole('checkbox').check();
  await expect(inputs).toHaveCount(3);
  await inputs.nth(1).fill(takeProfit);
  await inputs.nth(2).fill(stopLoss);
  await ticket.getByRole('button', { name: /Place BUY Order/ }).click();
}

function linkedExits(row: SavedRow | undefined) {
  if (!row) return [];
  const payload = parsePayload<{ game?: { openOrders?: Array<Record<string, unknown>> } }>(row);
  return payload.game?.openOrders ?? [];
}

const dock = (page: Page) => page.locator('#tutorial-positions-risk');

test.describe('bracket orders', () => {
  test('linked exits persist, and manually closing the position cancels both legs', async ({ page }) => {
    await startCareer(page);
    await placeBracketBuy(page, '1000000', '0.01');

    await expect(page.getByText('Engine Active')).toBeVisible();
    const saved = await waitForLocalSave(page, (rows) => linkedExits(rows.find((row) => row.slot === 1)).length === 2);
    const exits = linkedExits(saved.find((row) => row.slot === 1));
    const parentId = exits[0].parentOrderId;
    expect(typeof parentId).toBe('string');
    expect(exits.every((order) => order.isBracketChild === true && order.parentOrderId === parentId)).toBe(true);

    await dock(page).getByRole('button', { name: /^Orders \(/ }).click();
    await expect(dock(page).getByRole('button', { name: /Orders \(2\)/ })).toBeVisible();
    await expect(dock(page).locator('tbody tr')).toHaveCount(2);
    await expect(dock(page).getByText('SELL', { exact: true })).toHaveCount(2);

    // The linkage survives a full reload, so the exits are still one OCO pair.
    await page.reload();
    await expect(page.getByText('Engine Active')).toBeVisible({ timeout: 30_000 });
    await dismissTutorial(page);
    await dock(page).getByRole('button', { name: /^Orders \(/ }).click();
    await expect(dock(page).getByRole('button', { name: /Orders \(2\)/ })).toBeVisible();
    await expect(dock(page).locator('tbody tr')).toHaveCount(2);

    await dock(page).getByRole('button', { name: /^Positions \(/ }).click();
    await expect(dock(page).getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await dock(page).getByRole('button', { name: 'Close', exact: true }).click();

    await expect(dock(page).getByRole('button', { name: /Orders \(0\)/ })).toBeVisible({ timeout: 10_000 });
    await expect(dock(page).getByRole('button', { name: /Positions \(0\)/ })).toBeVisible();
    await dock(page).getByRole('button', { name: /^Orders \(/ }).click();
    await expect(dock(page).getByText('No active pending orders in the matching book.')).toBeVisible();

    // The manual close is the only exit: a cancelled sibling never fills or charges commission.
    await dock(page).getByRole('button', { name: /^Blotter \(/ }).click();
    await expect(dock(page).locator('tbody tr')).toHaveCount(2);
  });

  test('a filled take-profit cancels its stop-loss sibling instead of reversing the position', async ({ page }) => {
    await startCareer(page);
    // Skipping the tutorial leaves the simulation paused; run the clock for the exit to trigger.
    await page.getByRole('button', { name: 'Normal speed' }).click();
    await placeBracketBuy(page, '0.01', '0.01');

    await expect(dock(page).getByRole('button', { name: /Positions \(0\)/ })).toBeVisible({ timeout: 20_000 });
    await expect(dock(page).getByRole('button', { name: /Orders \(0\)/ })).toBeVisible();

    await dock(page).getByRole('button', { name: /^Blotter \(/ }).click();
    await expect(dock(page).locator('tbody tr')).toHaveCount(2);
    await expect(dock(page).getByText('SELL', { exact: true })).toHaveCount(1);

    // Give the engine more ticks: a stale sibling would otherwise open a short or leave an order.
    await page.waitForTimeout(1500);
    await expect(dock(page).getByRole('button', { name: /Positions \(0\)/ })).toBeVisible();
    await expect(dock(page).getByRole('button', { name: /Orders \(0\)/ })).toBeVisible();
    await expect(dock(page).locator('tbody tr')).toHaveCount(2);
  });
});
