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
import { login, registerRealmUsers, testHost } from '../helpers';

const testRealmURL = `${testHost}/`;

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
    expect(page.locator('[data-test-workspace-name]')).toHaveText(
      'Test Workspace A',
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

    expect(page.locator('[data-test-workspace="Test Workspace A"] [data-test-workspace-name]')).toHaveText(
      'Test Workspace A',
    );

    expect(page.locator('[data-test-workspace="Unknown Workspace"] [data-test-workspace-name]')).toHaveText(
      'Unknown Workspace',
    );
  });
});
