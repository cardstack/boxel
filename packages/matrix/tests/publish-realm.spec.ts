import { test, expect, type Page } from '@playwright/test';
import {
  synapseStart,
  synapseStop,
  type SynapseInstance,
  registerUser,
} from '../docker/synapse';
import {
  startServer as startRealmServer,
  type IsolatedRealmServer,
  appURL,
} from '../helpers/isolated-realm-server';
import {
  clearLocalStorage,
  createRealm,
  login,
  registerRealmUsers,
  setupUserSubscribed,
  postCardSource,
  postNewCard,
  setRealmPermissions,
  waitUntil,
  getRealmPublishability,
} from '../helpers';

const serverIndexUrl = new URL(appURL).origin;

test.describe('Publish realm', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;

  async function openPublishRealmModal(page: Page) {
    await clearLocalStorage(page, serverIndexUrl);

    await setupUserSubscribed('@user1:localhost', realmServer);

    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });

    await createRealm(page, 'new-workspace', '1New Workspace');
    await page.locator('[data-test-workspace="1New Workspace"]').click();

    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Host"]').click();

    await page.locator('[data-test-publish-realm-button]').click();
  }

  async function publishDefaultRealm(page: Page) {
    await openPublishRealmModal(page);
    await page.locator('[data-test-default-domain-checkbox]').click();
    await page.locator('[data-test-publish-button]').click();

    await page.waitForSelector('[data-test-unpublish-button]');
    await expect(
      page.locator(
        '[data-test-publish-realm-modal] [data-test-open-boxel-space-button]',
      ),
    ).toBeVisible();
  }

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(120_000);
    synapse = await synapseStart({
      template: 'test',
    });
    await registerRealmUsers(synapse);
    realmServer = await startRealmServer();
    await registerUser(synapse, 'user1', 'pass');
  });

  test.afterEach(async () => {
    await realmServer?.stop();
    await synapseStop(synapse.synapseId);
  });

  test('it can publish a realm to a subdirectory', async ({ page }) => {
    await publishDefaultRealm(page);

    let newTabPromise = page.waitForEvent('popup');

    await page
      .locator(
        '[data-test-publish-realm-modal] [data-test-open-boxel-space-button]',
      )
      .click();

    let newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      'http://user1.localhost:4205/new-workspace/',
    );
    await expect(
      newTab.locator(
        '[data-test-card="http://user1.localhost:4205/new-workspace/index"]',
      ),
    ).toBeVisible();
    await newTab.close();
    await page.bringToFront();
  });

  test('it validates, claims, and publishes to a custom subdomain', async ({
    page,
  }) => {
    await openPublishRealmModal(page);

    await page.locator('[data-test-custom-subdomain-setup-button]').click();

    let customSubdomainInput = page.locator(
      '[data-test-custom-subdomain-input]',
    );
    let claimButton = page.locator('[data-test-claim-custom-subdomain-button]');
    let customSubdomainField = customSubdomainInput.locator('input');

    await customSubdomainField.fill('xn--punycodetest');
    await claimButton.click();

    await expect(
      page.locator('[data-test-boxel-input-group-error-message]'),
    ).toHaveText('Punycode domains are not allowed for security reasons');

    await customSubdomainField.fill('acceptable-subdomain');
    await claimButton.click();

    await expect(
      page.locator('[data-test-boxel-input-group-error-message]'),
    ).toHaveCount(0);

    await expect(
      page.locator('[data-test-custom-subdomain-input]'),
    ).toHaveCount(0);

    await page.locator('[data-test-custom-subdomain-checkbox]').click();
    await page.locator('[data-test-publish-button]').click();

    let newTabPromise = page.waitForEvent('popup');

    await page
      .locator(
        '[data-test-publish-realm-modal] [data-test-open-custom-subdomain-button]',
      )
      .click();

    let newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      'http://acceptable-subdomain.localhost:4205/',
    );
    await expect(
      newTab.locator(
        '[data-test-card="http://acceptable-subdomain.localhost:4205/index"]',
      ),
    ).toBeVisible();
    await newTab.close();
    await page.bringToFront();
  });

  test('it warns when private dependencies would break publishing', async ({
    page,
  }) => {
    await clearLocalStorage(page, serverIndexUrl);
    await setupUserSubscribed('@user1:localhost', realmServer);
    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });

    let defaultRealmURL = new URL('user1/new-workspace/', serverIndexUrl).href;
    let privateRealmURL = new URL('user1/secret-realm/', serverIndexUrl).href;

    await createRealm(page, 'new-workspace', '1New Workspace');
    await createRealm(page, 'secret-realm', 'Secret Realm');

    await postCardSource(
      page,
      privateRealmURL,
      'secret-card.gts',
      `
        import { CardDef, field, contains } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class SecretCard extends CardDef {
          @field name = contains(StringField);
        }
      `,
    );

    await postNewCard(page, privateRealmURL, {
      data: {
        attributes: {
          name: 'Private Info',
        },
        meta: {
          adoptsFrom: {
            module: './secret-card',
            name: 'SecretCard',
          },
        },
      },
    });

    await postCardSource(
      page,
      defaultRealmURL,
      'dependent-card.gts',
      `
        import { CardDef, field, contains, linksTo } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        import { SecretCard } from "${privateRealmURL}secret-card";

        export class DependentCard extends CardDef {
          @field label = contains(StringField);
          @field secret = linksTo(() => SecretCard);
        }
      `,
    );

    await postCardSource(
      page,
      defaultRealmURL,
      'index.json',
      JSON.stringify(
        {
          data: {
            type: 'card',
            attributes: {
              label: 'Leaky Card',
            },
            meta: {
              adoptsFrom: {
                module: './dependent-card',
                name: 'DependentCard',
              },
            },
          },
        },
        null,
        2,
      ),
    );
    let dependentCardURL = `${defaultRealmURL}index`;

    await waitUntil(async () => {
      let publishability = await getRealmPublishability(page, defaultRealmURL);
      return publishability.publishable === false;
    }, 20000);

    await page.locator('[data-test-workspace="1New Workspace"]').click();
    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Host"]').click();
    await page.locator('[data-test-publish-realm-button]').click();

    await expect(
      page.locator('[data-test-private-dependency-warning]'),
    ).toBeVisible();

    await expect(
      page.locator(
        `[data-test-private-dependency-resource="${dependentCardURL}"]`,
      ),
    ).toBeVisible();

    await expect(
      page.locator(`[data-test-private-dependency-realm="${privateRealmURL}"]`),
    ).toBeVisible();
  });

  test('open site popover opens with shift-click', async ({ page }) => {
    await publishDefaultRealm(page);

    let newTabPromise = page.waitForEvent('popup');

    await page.locator('[data-test-close-modal]').click();
    await page.locator('[data-test-open-site-button]').click();

    let newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      'http://user1.localhost:4205/new-workspace/',
    );
    await newTab.close();
    await page.bringToFront();

    await expect(page.locator('[data-test-open-site-popover]')).toHaveCount(0);

    let popupPromise = page
      .waitForEvent('popup', { timeout: 1_000 })
      .catch(() => null);

    await page.locator('[data-test-open-site-button]').click({
      modifiers: ['Shift'],
    });

    let popup = await popupPromise;
    expect(popup).toBeNull();

    await expect(page.locator('[data-test-open-site-popover]')).toBeVisible();

    newTabPromise = page.waitForEvent('popup');

    await page
      .locator('[data-test-open-site-popover] [data-test-open-site-button]')
      .click();

    newTab = await newTabPromise;
    await newTab.waitForLoadState();

    await expect(newTab).toHaveURL(
      'http://user1.localhost:4205/new-workspace/',
    );
    await newTab.close();
    await page.bringToFront();
  });
});
