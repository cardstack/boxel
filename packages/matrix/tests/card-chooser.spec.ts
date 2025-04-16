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
  showAllCards,
  setupUserSubscribed,
  postNewCard,
} from '../helpers';

test.describe('Card Chooser', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;
  const serverIndexUrl = new URL(appURL).origin;
  const realm1Name = 'realm1';
  const realm1URL = new URL(`user1/${realm1Name}/`, serverIndexUrl).href;
  const realm2Name = 'realm2';
  const realm2URL = new URL(`user1/${realm2Name}/`, serverIndexUrl).href;

  let consumingCardURL: string;
  let linkedCardURL: string;

  async function setupRealms(page: Page) {
    await clearLocalStorage(page, serverIndexUrl);
    await setupUserSubscribed('@user1:localhost', realmServer);
    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
      skipOpeningAssistant: true,
    });
    await createRealm(page, realm1Name);
    await createRealm(page, realm2Name);
    await page.goto(realm1URL);
    await showAllCards(page);

    consumingCardURL = await postNewCard(page, realm1URL, {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Friend Consumer',
          description: 'This is a test card instance.',
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/friend',
            name: 'Friend',
          },
        },
      },
    });

    linkedCardURL = await postNewCard(page, realm1URL, {
      data: {
        type: 'card',
        attributes: {
          firstName: 'Friend Link',
          description: 'This is a test card instance.',
        },
        meta: {
          adoptsFrom: {
            module: 'http://localhost:4202/test/friend',
            name: 'Friend',
          },
        },
      },
    });

    await expect(
      page.locator(`[data-test-cards-grid-item="${consumingCardURL}"]`),
    ).toHaveCount(1);
    await page
      .locator(`[data-test-cards-grid-item="${consumingCardURL}"]`)
      .click();
  }

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(120_000);
    synapse = await synapseStart({
      template: 'test',
    });
    await registerRealmUsers(synapse);
    realmServer = await startRealmServer({ includeSeedRealm: true });
    await registerUser(synapse, 'user1', 'pass');
  });

  test.afterEach(async () => {
    await realmServer?.stop();
    await synapseStop(synapse.synapseId);
  });

  test('it can add realm read permissions when linking a new card', async ({
    page,
  }) => {
    await setupRealms(page);

    await page
      .locator(
        `[data-test-stack-card="${consumingCardURL}"] [data-test-edit-button]`,
      )
      .click();
    await page.locator('[data-test-add-new]').click();
    await expect(
      page.locator(`[data-test-card-catalog-create-new-button="${realm2URL}"]`),
    ).toHaveCount(1);
    await page
      .locator(`[data-test-card-catalog-create-new-button="${realm2URL}"]`)
      .click();
    await page.locator(`[data-test-card-catalog-go-button]`).click();

    await expect(page.locator(`[data-test-stack-card-index="2"]`)).toHaveCount(
      1,
      { timeout: 30_000 },
    );
    await page
      .locator(
        '[data-test-stack-card-index="2"] [data-test-field="firstName"] input',
      )
      .fill('Mango');
    await expect(
      page.locator('[data-test-stack-card-index="2"] [data-test-last-saved]'),
    ).toHaveCount(1);

    await page
      .locator('[data-test-stack-card-index="2"] [data-test-close-button]')
      .click();
    await expect(
      page.locator(
        `[data-test-stack-card="${consumingCardURL}"] [data-test-links-to-editor="friend"]`,
      ),
    ).toContainText('Mango');

    // revisit the card again to make sure the linked card value loads from the index
    await page.goto(`${consumingCardURL}`);
    await expect(
      page.locator(`[data-test-stack-card="${consumingCardURL}"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(
        `[data-test-stack-card="${consumingCardURL}"] [data-test-field="friend"]`,
      ),
    ).toContainText('Mango');
  });

  test('it can add realm read permissions when linking an existing card', async ({
    page,
  }) => {
    await setupRealms(page);

    await page
      .locator(
        `[data-test-stack-card="${consumingCardURL}"] [data-test-edit-button]`,
      )
      .click();
    await page.locator('[data-test-add-new]').click();
    await expect(
      page.locator(`[data-test-select="${linkedCardURL}"]`),
    ).toHaveCount(1);
    await page.locator(`[data-test-select="${linkedCardURL}"]`).click();
    await page.locator(`[data-test-card-catalog-go-button]`).click();
    await expect(page.locator('[data-test-card-catalog-modal]')).toHaveCount(0);

    await expect(
      page.locator(
        `[data-test-stack-card="${consumingCardURL}"] [data-test-last-saved]`,
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        `[data-test-stack-card="${consumingCardURL}"] [data-test-links-to-editor="friend"]`,
      ),
    ).toContainText('Friend Link');

    // revisit the card again to make sure the linked card value loads from the index
    await page.goto(`${consumingCardURL}`);
    await expect(
      page.locator(`[data-test-stack-card="${consumingCardURL}"]`),
    ).toHaveCount(1);
    await expect(
      page.locator(
        `[data-test-stack-card="${consumingCardURL}"] [data-test-field="friend"]`,
      ),
    ).toContainText('Friend Link');
  });
});
