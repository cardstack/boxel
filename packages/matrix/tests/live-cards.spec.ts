import { test, expect } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  clearLocalStorage,
  createRealm,
  login,
  showAllCards,
  setupUserSubscribed,
  patchCardInstance,
  postCardSource,
  postNewCard,
  getMonacoContent,
  waitUntil,
  startUniqueTestEnvironment,
  stopTestEnvironment,
  type TestEnvironment,
} from '../helpers';

test.describe('Live Cards', () => {
  let testEnv: TestEnvironment;
  let serverIndexUrl: string;
  const realmName = 'realm1';
  let realmURL: string;

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(120_000);
    testEnv = await startUniqueTestEnvironment();
    serverIndexUrl = new URL(testEnv.config.testHost).origin;
    realmURL = new URL(`user1/${realmName}/`, serverIndexUrl).href;
    await registerUser(
      testEnv.synapse!,
      'user1',
      'pass',
      false,
      undefined,
      testEnv.config.testHost,
    );
    await setupUserSubscribed('@user1:localhost', testEnv.realmServer!);
  });

  test.afterEach(async () => {
    await stopTestEnvironment(testEnv);
  });

  test('it can subscribe to realm events of a private realm', async ({
    page,
  }) => {
    await clearLocalStorage(page, serverIndexUrl);
    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });
    await createRealm(page, realmName);
    let instanceUrl = await postNewCard(page, realmURL, {
      data: {
        attributes: {
          cardInfo: {
            title: 'test card title',
            description: 'test card description',
          },
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
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
            module: 'https://cardstack.com/base/card-api',
            name: 'CardDef',
          },
        },
      },
    });

    await expect(
      page.locator('[data-test-realm-indexing-indicator]'),
    ).toHaveCount(1);
    await expect(
      page.locator(`[data-test-card="${instanceUrl}"]`),
    ).toContainText('updated card title');
    await expect(
      page.locator('[data-test-realm-indexing-indicator]'),
    ).toHaveCount(0);

    // assert that index card is live bound
    await page.goto(realmURL);
    await showAllCards(page);

    await expect(
      page.locator(`[data-test-boxel-filter-list-button="All Cards"]`),
    ).toHaveCount(1);

    await postCardSource(
      page,
      realmURL,
      'sample-card.gts',
      `
      import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
      import { Component } from 'https://cardstack.com/base/card-api';
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
          import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
          import { Component } from 'https://cardstack.com/base/card-api';
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
    await clearLocalStorage(page, serverIndexUrl);
    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });
    await createRealm(page, realmName);
    let instanceUrl = await postNewCard(page, realmURL, {
      data: {
        attributes: {
          title: 'test card title',
          description: 'test card description',
        },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
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

    await page.locator('[data-test-field="title"] input').fill('Replacement');

    await waitUntil(async () => (await getMonacoContent(page)) !== content);

    await expect(
      await getMonacoContent(page),
      'monaco editor has been updated',
    ).toContain('Replacement');
  });
});
