import { expect, test } from '@playwright/test';
import { updateAccountData } from '../docker/synapse';
import { createSubscribedUser, login, updateSynapseUser } from '../helpers';

import { appURL } from '../helpers/isolated-realm-server';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '../helpers/matrix-constants';

test.describe('Realm URLs in Matrix account data', () => {
  let user: {
    username: string;
    password: string;
    credentials: any;
  };
  let userEmail: string;

  test.beforeEach(async () => {
    user = await createSubscribedUser('realm-urls');
    userEmail = `${user.username}@localhost`;
    await updateSynapseUser(user.credentials.userId, {
      emailAddresses: [userEmail],
    });

    await updateAccountData(
      user.credentials.userId,
      user.credentials.accessToken,
      APP_BOXEL_REALMS_EVENT_TYPE,
      JSON.stringify({ realms: [] }),
    );
  });

  test('active realms are determined by account data', async ({ page }) => {
    await login(page, user.username, user.password, { url: appURL });

    await page.locator('[data-test-workspace-chooser-toggle]').click();

    await page
      .locator('[data-test-workspace-chooser]')
      .waitFor({ state: 'visible' });

    await expect(
      page.locator('[data-test-workspace-list] [data-test-workspace]'),
    ).toHaveCount(0);

    await updateAccountData(
      user.credentials.userId,
      user.credentials.accessToken,
      APP_BOXEL_REALMS_EVENT_TYPE,
      JSON.stringify({
        realms: ['http://example.com/'],
      }),
    );

    await page
      .locator('[data-test-workspace-list] [data-test-workspace]')
      .waitFor({ state: 'visible' });
    await expect(
      page.locator('[data-test-workspace-list] [data-test-workspace]'),
    ).toHaveCount(1);

    await expect(
      page.locator(
        '[data-test-workspace-list] [data-test-workspace="Unknown Workspace"] [data-test-workspace-name]',
      ),
    ).toHaveText('Unknown Workspace');
    await expect(
      page.locator(
        '[data-test-workspace-list] [data-test-workspace="Unknown Workspace"] [data-test-workspace-visibility]',
      ),
    ).toHaveText('private');
  });
});
