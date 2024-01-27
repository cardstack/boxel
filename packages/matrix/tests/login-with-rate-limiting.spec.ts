import { expect, test } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import {
  clearLocalStorage,
  assertLoggedIn,
  assertLoggedOut,
  login,
  logout,
  openRoot,
  toggleOperatorMode,
  registerRealmUsers,
  testHost,
} from '../helpers';
import jwt from 'jsonwebtoken';

const REALM_SECRET_SEED = "shhh! it's a secret";

test.describe('Login', () => {
  let synapse: SynapseInstance;
  test.beforeEach(async ({ page }) => {
    synapse = await synapseStart({
      template: 'test-with-rate-limiting',
    });
    await registerRealmUsers(synapse);
    await registerUser(synapse, 'user1', 'pass');
    await clearLocalStorage(page);
  });
  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
  });

  test('it shows an error when there are too many requests', async ({
    page,
  }) => {
    await openRoot(page);
    await toggleOperatorMode(page);

    page.on('console', (msg) => console.log(msg.text()));

    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('bad pass');
    await expect(
      page.locator('[data-test-login-error]'),
      'login error message is not displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-login-btn]').click();

    for (let i = 0; i < 5; i++) {
      console.log('attempt', i);
      await page.locator('[data-test-username-field]').fill(`user${i}`);
      await page.locator('[data-test-password-field]').fill(`bad pass ${i}`);
      await page.screenshot({ path: `login-${i}.png` });
      await page.locator('[data-test-login-btn]').click();
    }

    await expect(page.locator('[data-test-login-error]')).toContainText(
      'Sign in failed. Too many failed attempts, try again later',
    );
  });
});
