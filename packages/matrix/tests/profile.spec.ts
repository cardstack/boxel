import { expect } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import { login, test } from '../helpers';

test.describe('Profile', () => {
  test.beforeEach(async ({ synapse }) => {
    await registerUser(synapse, 'user1', 'pass');
  });

  test('it can change display name in settings', async ({ page }) => {
    await login(page, 'user1', 'pass');
    await page.locator('[data-test-profile-icon-button]').click();
    await page.locator('[data-test-settings-button]').click();
    await expect(
      page.locator('[data-test-profile-display-name]'),
    ).toContainText('');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();
    await page.locator('[data-test-display-name-field]').fill('John');
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-profile-settings-save-button]').click();
    await expect(
      page.locator('[data-test-profile-display-name]'),
    ).toContainText('John'); // This is read from the profile in matrix service that gets fetched from the matrix server on save
    await expect(
      page.locator('[data-test-profile-settings-save-button]'),
    ).toBeDisabled();
  });
});
