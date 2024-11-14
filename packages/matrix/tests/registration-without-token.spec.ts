import { test, expect } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
} from '../docker/synapse';
import { smtpStart, smtpStop } from '../docker/smtp4dev';
import {
  appURL,
  startServer as startRealmServer,
  type IsolatedRealmServer,
} from '../helpers/isolated-realm-server';
import {
  clearLocalStorage,
  validateEmail,
  gotoRegistration,
  assertLoggedIn,
  assertPaymentSetup,
  registerRealmUsers,
} from '../helpers';

import { PgAdapter } from '@cardstack/postgres';

test.describe('User Registration w/o Token', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;
  let dbAdapter: PgAdapter;

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(60_000);
    synapse = await synapseStart({
      template: 'test-without-registration-token',
    });
    await smtpStart();
    await registerRealmUsers(synapse);
    realmServer = await startRealmServer();
    dbAdapter = new PgAdapter({ autoMigrate: true });
  });

  test.afterEach(async () => {
    await realmServer.stop();
    await synapseStop(synapse.synapseId);
    await smtpStop();
  });

  test('it can register a user without a registration token', async ({
    page,
  }) => {
    await clearLocalStorage(page, appURL);
    await gotoRegistration(page, appURL);

    await expect(
      page.locator('[data-test-token-field]'),
      'token field is not displayed',
    ).toHaveCount(0);
    await page.locator('[data-test-name-field]').fill('user1');
    await page.locator('[data-test-email-field]').fill('user1@example.com');
    await page.locator('[data-test-username-field]').fill('user1');
    await page.locator('[data-test-password-field]').fill('mypassword1!');
    await page
      .locator('[data-test-confirm-password-field]')
      .fill('mypassword1!');
    await page.locator('[data-test-register-btn]').click();
    await validateEmail(page, 'user1@example.com');

    await page.bringToFront();

    let users = await dbAdapter.execute('SELECT * FROM users');
    console.log(users);

    await expect(page.locator('[data-test-email-validated]')).toContainText(
      'Success! Your email has been validated',
    );

    await assertPaymentSetup(page, 'user1');
    await assertLoggedIn(page);
  });
});
