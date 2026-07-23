import { test, expect } from './fixtures.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  createRealm,
  showAllCards,
  patchCardInstance,
  postCardSource,
  postNewCard,
  getMonacoContent,
  waitUntil,
  createSubscribedUserAndLogin,
} from '../helpers/index.ts';

test.describe('Live Cards', () => {
  const serverIndexUrl = new URL(appURL).origin;
  const realmName = 'realm1';

  test('it can subscribe to realm events of a private realm', async ({
    page,
  }) => {
    let { username } = await createSubscribedUserAndLogin(
      page,
      'subscriber',
      serverIndexUrl,
    );

    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;
    await createRealm(page, realmName);
    let instanceUrl = await postNewCard(page, realmURL, {
      data: {
        attributes: {
          cardInfo: {
            name: 'test card title',
            summary: 'test card description',
          },
        },
        meta: {
          adoptsFrom: {
            module: '@cardstack/base/card-api',
            name: 'CardDef',
          },
        },
      },
    });
    await page.goto(instanceUrl);
    await expect(
      page.locator(`[data-test-card="${instanceUrl}"]`),
    ).toContainText('test card title');

    // assert that instance updates are live bound
    await expect(
      page.locator('[data-test-realm-indexing-indicator]'),
    ).toHaveCount(0);

    await patchCardInstance(page, realmURL, instanceUrl, {
      data: {
        type: 'card',
        attributes: {
          cardInfo: {
            title: 'updated card title',
            description: 'updated card description',
          },
        },
        meta: {
          adoptsFrom: {
            module: '@cardstack/base/card-api',
            name: 'CardDef',
          },
        },
      },
    });

    // assert that index card is live bound
    await page.goto(realmURL);
    await showAllCards(page);

    await expect(page.locator(`[data-test-cards-grid-cards]`)).toBeVisible();

    await postCardSource(
      page,
      realmURL,
      'sample-card.gts',
      `
      import { CardDef, field, contains, StringField } from '@cardstack/base/card-api';
      import { Component } from '@cardstack/base/card-api';
      export class SampleCard extends CardDef {
        @field name = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            Hello <@fields.name />
          </template>
        };
      }`,
    );

    let newCardURL = await postNewCard(page, realmURL, {
      data: {
        type: 'card',
        attributes: {
          title: 'Mango',
          name: 'Mango',
        },
        meta: {
          adoptsFrom: {
            module: '../sample-card',
            name: 'SampleCard',
          },
        },
      },
    });
    await showAllCards(page);
    await expect(
      page.locator(`[data-test-cards-grid-item="${newCardURL}"]`),
    ).toHaveCount(1);
    await page.locator(`[data-test-cards-grid-item="${newCardURL}"]`).click();
    await expect(
      page.locator(`[data-test-stack-card="${newCardURL}"]`),
    ).toContainText('Hello Mango');

    // assert that instances that consume updated modules are live bound
    await postCardSource(
      page,
      realmURL,
      `sample-card.gts`,
      `
          import { CardDef, field, contains, StringField } from '@cardstack/base/card-api';
          import { Component } from '@cardstack/base/card-api';
          export class SampleCard extends CardDef {
            @field name = contains(StringField);
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                Hello <@fields.name /> !!!!
              </template>
            };
          }`,
    );

    await expect(
      page.locator(`[data-test-stack-card="${newCardURL}"]`),
    ).toContainText('Hello Mango !!!!');

    // assert that code mode file tree is live bound
    await page.goto(
      `${realmURL}?operatorModeState=${encodeURIComponent(
        JSON.stringify({
          stacks: [],
          codePath: `${realmURL}index.json`,
          fileView: 'browser',
          submode: 'code',
        }),
      )}`,
    );
    await expect(page.locator('[data-test-file="index.json"]')).toHaveCount(1);
    await expect(page.locator('[data-test-file="hello.gts"]')).toHaveCount(0);

    await postCardSource(page, realmURL, 'hello.gts', '// hi');

    await expect(page.locator('[data-test-file="hello.gts"]')).toHaveCount(1);
  });

  test('updating a card in code mode edit updates its source', async ({
    page,
  }) => {
    let { username } = await createSubscribedUserAndLogin(
      page,
      'subscriber',
      serverIndexUrl,
    );

    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;
    await createRealm(page, realmName);
    let instanceUrl = await postNewCard(page, realmURL, {
      data: {
        attributes: {
          title: 'test card title',
          description: 'test card description',
        },
        meta: {
          adoptsFrom: {
            module: '@cardstack/base/card-api',
            name: 'CardDef',
          },
        },
      },
    });

    await page.goto(
      `${realmURL}?operatorModeState=${encodeURIComponent(
        JSON.stringify({
          stacks: [],
          codePath: instanceUrl,
          fileView: 'browser',
          submode: 'code',
        }),
      )}`,
    );

    await page.locator('[data-test-format-chooser="edit"]').click();

    // give monaco a moment to load
    await new Promise((r) => setTimeout(r, 5000));
    let content = await getMonacoContent(page);

    await page
      .locator('[data-test-field="cardInfo-name"] input')
      .fill('Replacement');

    await waitUntil(async () => (await getMonacoContent(page)) !== content);

    await expect(
      await getMonacoContent(page),
      'monaco editor has been updated',
    ).toContain('Replacement');
  });

  // End-to-end coverage of specifying a card type by URL in the card chooser,
  // against a real realm server (real HTTP + real Matrix login). The host
  // integration version of this flow is skipped; this is its real-server home.
  test('can specify a card by URL in the card chooser', async ({ page }) => {
    let { username } = await createSubscribedUserAndLogin(
      page,
      'chooser',
      serverIndexUrl,
    );

    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;
    await createRealm(page, realmName);

    // Land on the realm's grid so the create-new-card affordance is present.
    await page.goto(realmURL);
    await showAllCards(page);
    await expect(
      page.locator(`[data-test-boxel-filter-list-button="All Cards"]`),
    ).toHaveCount(1);

    await page.locator('[data-test-create-new-card-button]').click();
    await expect(page.locator('[data-test-card-chooser-modal]')).toBeVisible();
    await expect(page.locator('[data-test-item-button]').first()).toBeVisible();

    // Specify a base-realm card type by its URL.
    await page
      .locator('[data-test-search-field]')
      .fill('https://cardstack.com/base/types/card');

    // The result resolves under the "Base Workspace" realm section.
    await expect(
      page.locator(
        '[data-test-realm-url="https://cardstack.com/base/"][data-test-realm="Base Workspace"]',
      ),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(
        '[data-test-realm="Base Workspace"] [data-test-results-count]',
      ),
    ).toContainText('1 result');
    await expect(page.locator('[data-test-item-button]')).toHaveCount(1);

    await page.locator('[data-test-item-button]').click();
    await expect(
      page.locator('[data-test-card-chooser-go-button]'),
    ).toBeEnabled();
    await page.locator('[data-test-card-chooser-go-button]').click();

    // The chosen type produces a new card on the stack.
    await expect(
      page.locator(
        '[data-test-stack-card-index="1"] [data-test-field="cardInfo-name"]',
      ),
    ).toBeVisible();
  });
});
