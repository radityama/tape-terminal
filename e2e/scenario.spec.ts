import { expect, test } from '@playwright/test';
import { dismissTutorial, skipToNextDay } from './helpers/app';

test('scenario applies its rules, completes once and restores the result', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Historical Scenarios/ }).click();
  await page.getByRole('button', { name: /Rate Shock Autumn/ }).click();

  await expect(page).toHaveURL(/\/terminal/);
  await expect(page.getByText('Engine Active')).toBeVisible({ timeout: 30_000 });
  await dismissTutorial(page);

  await expect(page.getByText('Rate Shock Autumn')).toBeVisible();
  await expect(page.getByText('Day 1/10')).toBeVisible();

  for (let day = 0; day < 10; day++) await skipToNextDay(page);

  const result = page.getByRole('dialog', { name: 'Scenario result' });
  await expect(result).toBeVisible();
  await expect(result.getByText('Target missed')).toBeVisible();
  await expect(result.getByText('Score 0 / 10,000')).toBeVisible();
  await expect(result.getByText('$100,000.00')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Engine Active')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('dialog', { name: 'Scenario result' })).toBeVisible();
  await page.getByRole('button', { name: 'Return to terminal' }).click();

  await expect(page.getByText('Grade D')).toBeVisible();
  await page.getByRole('button', { name: 'View result' }).click();
  await expect(page.getByRole('dialog', { name: 'Scenario result' })).toBeVisible();
});
