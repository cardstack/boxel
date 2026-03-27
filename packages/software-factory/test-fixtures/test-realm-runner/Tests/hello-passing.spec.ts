import { expect, test } from '@playwright/test';

test('hello card renders greeting', async ({ page }) => {
  let realmUrl = process.env.BOXEL_SOURCE_REALM_URL;
  await page.goto(`${realmUrl}HelloCard/sample`);
  await expect(page.locator('[data-test-greeting]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('[data-test-greeting]')).toContainText('Hello');
});
