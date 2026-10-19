import { expect, test } from '@playwright/test';
import { skipToNextDay } from './helpers/app';

test('a delayed save conflict may cover Continue Trading after the click times out', async ({ page }) => {
  await page.setContent(`
    <span id="tutorial-sim-clock">Day 1</span>
    <button id="skip">Skip to next session close</button>
    <button>Continue Trading</button>
    <div id="overlay" style="display:none;position:fixed;inset:0;z-index:10;background:#fff"></div>
    <div id="conflict" role="dialog" style="display:none">Save Conflict</div>
    <script>
      document.querySelector('#skip').onclick = () => {
        document.querySelector('#tutorial-sim-clock').textContent = 'Day 2';
        document.querySelector('#overlay').style.display = 'block';
        setTimeout(() => {
          document.querySelector('#conflict').style.display = 'block';
        }, 3500);
      };
    </script>
  `);

  expect(await skipToNextDay(page)).toBe(2);
  await expect(page.getByRole('dialog').filter({ hasText: /Save Conflict/ })).toBeVisible();
});
