import { expect, test } from '@playwright/test';

test('deliberately fails for testing', async ({ page }) => {
  let realmUrl = process.env.BOXEL_SOURCE_REALM_URL;
  await page.goto(`${realmUrl}HelloCard/sample`);
  // This assertion is deliberately wrong — it checks for text that doesn't exist.
  await expect(page.locator('[data-test-greeting]')).toContainText(
    'THIS TEXT DOES NOT EXIST',
    { timeout: 5_000 },
  );
});
