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
import { login, registerRealmUsers, setupUserSubscribed } from '../helpers';
import {
  appURL,
  startServer as startRealmServer,
  type IsolatedRealmServer,
} from '../helpers/isolated-realm-server';

test.describe('Realm URLs in Matrix account data', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;
  let user: { accessToken: string };

  test.beforeEach(async () => {
    synapse = await synapseStart({
      template: 'test',
    });
    realmServer = await startRealmServer();
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
      JSON.stringify({ realms: [] }),
    );
    await setupUserSubscribed('@user1:localhost', realmServer);
  });

  test.afterEach(async () => {
    await synapseStop(synapse.synapseId);
    await smtpStop();
    await realmServer.stop();
  });

  test('active realms are determined by account data', async ({ page }) => {
    await login(page, 'user1', 'pass', { url: appURL });

    await page.locator('[data-test-workspace-chooser-toggle]').click();

    await page
      .locator('[data-test-workspace-chooser]')
      .waitFor({ state: 'visible' });

    expect(
      page.locator('[data-test-workspace-list] [data-test-workspace]'),
    ).toHaveCount(0);

    await updateAccountData(
      '@user1:localhost',
      user.accessToken,
      'com.cardstack.boxel.realms',
      JSON.stringify({
        realms: ['http://example.com/'],
      }),
    );

    await page
      .locator('[data-test-workspace-list] [data-test-workspace]')
      .waitFor({ state: 'visible' });
    expect(
      page.locator('[data-test-workspace-list] [data-test-workspace]'),
    ).toHaveCount(1);

    expect(
      page.locator(
        '[data-test-workspace-list] [data-test-workspace="Unknown Workspace"] [data-test-workspace-name]',
      ),
    ).toHaveText('Unknown Workspace');
    expect(
      page.locator(
        '[data-test-workspace-list] [data-test-workspace="Unknown Workspace"] [data-test-workspace-visibility]',
      ),
    ).toHaveText('private');
  });
});
