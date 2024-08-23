import { expect, test } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
  registerUser,
  updateAccountData,
  updateUser,
} from '../docker/synapse';
import { smtpStart, smtpStop } from '../docker/smtp4dev';
import { login, registerRealmUsers } from '../helpers';

// FIXME how to import? but it should be localhost:4202 anyway, not test-realm
// import { testRealmURL } from '@cardstack/runtime-common/helpers/const';
const testRealmURL = `http://localhost:4202/test/`;

test.describe('Realm URLs in Matrix account data', () => {
  let synapse: SynapseInstance;
  let user: { accessToken: string };

  test.beforeEach(async () => {
    synapse = await synapseStart({
      template: 'test',
    });
    await smtpStart();

    let admin = await registerUser(synapse, 'admin', 'adminpass', true);
    await registerRealmUsers(synapse);
    user = await registerUser(synapse, 'user1', 'pass');
    await updateUser(admin.accessToken, '@user1:localhost', {
      emailAddresses: ['user1@localhost'],
    });

    await updateAccountData(
      '@user1:localhost',
      user.accessToken,
      'com.cardstack.boxel.realms',
      JSON.stringify({ realms: [testRealmURL] }),
    );
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await smtpStop();
  });

  test('active realms are determined by account data', async ({ page }) => {
    await login(page, 'user1', 'pass');

    await page.locator('[data-test-submode-layout-boxel-icon-button]').click();

    await page
      .locator('[data-test-workspace-chooser]')
      .waitFor({ state: 'visible' });

    expect(await page.locator('[data-test-workspace]').count()).toBe(1);
    expect(page.locator('[data-test-workspace]')).toHaveText(
      'http://localhost:4202/test/',
    );

    await updateAccountData(
      '@user1:localhost',
      user.accessToken,
      'com.cardstack.boxel.realms',
      JSON.stringify({
        realms: ['http://localhost:4202/test/', 'http://example.com/'],
      }),
    );

    await page
      .locator('[data-test-workspace]:nth-child(2)')
      .waitFor({ state: 'visible' });
    expect(await page.locator('[data-test-workspace]').count()).toBe(2);

    expect(page.locator('[data-test-workspace]:first-child')).toHaveText(
      'http://localhost:4202/test/',
    );

    expect(page.locator('[data-test-workspace]:last-child')).toHaveText(
      'http://example.com/',
    );
  });
});
