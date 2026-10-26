import { test, expect } from './fixtures.ts';
import { appURL } from '../support/isolated-realm-server.ts';
import {
  createRealm,
  showAllCards,
  patchCardInstance,
  postCardSource,
  postNewCard,
  getMonacoContent,
  describeMonacoModels,
  createSubscribedUserAndLogin,
} from '../helpers/index.ts';

test.describe('Live Cards', () => {
  // EXPERIMENT (do not merge): no retries, and the private-realm test 12 times.
  test.describe.configure({ retries: 0 });
  const serverIndexUrl = new URL(appURL).origin;
  const realmName = 'realm1';

  for (let i = 1; i <= 12; i++)
  test(`it can subscribe to realm events of a private realm #${i}`, async ({
    page,
  }) => {
    console.log(`[budget] private-realm attempt timeout=${test.info().timeout}`);
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

    // assert that code mode file tree is live bound. Switch submodes in the
    // app rather than with a page.goto: a reload boots the app again and costs
    // several seconds of a test that is already long.
    await page.locator('[data-test-submode-switcher] button').click();
    await page.locator('[data-test-boxel-menu-item-text="Code"]').click();
    await page.locator('[data-test-file-browser-toggle]').click();
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

    await expect
      .poll(() => getMonacoContent(page), {
        message: 'monaco editor has loaded the card source',
      })
      .toContain('"adoptsFrom"');

    // The realm answers the save only once the instance is re-indexed, and
    // monaco can only show the new source after that. Under a busy prerenderer
    // that wait has taken over 10 seconds, so wait for the save itself rather
    // than giving the whole round trip a fixed window.
    let saveStartedAt = Date.now();
    let save = page
      .waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().startsWith(instanceUrl) &&
          (response.request().postData() ?? '').includes('Replacement'),
        { timeout: 60_000 },
      )
      .catch((e) => {
        throw new Error(
          `no PATCH to ${instanceUrl} with 'Replacement' in its body: ${e.message}`,
        );
      });

    await page
      .locator('[data-test-field="cardInfo-name"] input')
      .fill('Replacement');

    let saveResponse = await save;
    console.log(
      `card save: status=${saveResponse.status()} after ${
        Date.now() - saveStartedAt
      }ms`,
    );
    expect(saveResponse.ok(), 'card save succeeded').toBe(true);

    try {
      await expect
        .poll(() => getMonacoContent(page), {
          message: 'monaco editor has been updated',
        })
        .toContain('Replacement');
    } catch (e) {
      // The page may be gone (at the test timeout, say); the original
      // failure is the one to report.
      let models = await describeMonacoModels(page).catch(
        (err) => `unavailable: ${err.message}`,
      );
      console.log(
        `monaco models when the update was missing: ${JSON.stringify(models)}`,
      );
      throw e;
    }
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

    // Open the card chooser via the operator-mode "New" button — an
    // index-agnostic affordance, so this doesn't depend on whether the realm
    // index is a CardsGrid or a Workspace. Its "Choose a card type..." item
    // opens the same chooser CardsGrid's create button did.
    await page.goto(realmURL);
    await page.locator('[data-test-new-file-button]').click();
    await page
      .locator('[data-test-boxel-menu-item-text="Choose a card type..."]')
      .click();
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
