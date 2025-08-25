import { test, expect } from '@playwright/test';
import { registerUser } from '../docker/synapse';
import {
  clearLocalStorage,
  createRealm,
  login,
  setupUserSubscribed,
  postCardSource,
  postNewCard,
  startUniqueTestEnvironment,
  stopTestEnvironment,
  type TestEnvironment,
} from '../helpers';

test.describe('glimmer-scoped-css', () => {
  let testEnv: TestEnvironment;
  let serverIndexUrl: string;
  const realmName = 'realm1';
  let realmURL: string;

  let newCardURL: string;

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

  test(':global is ignored and does not affect styles', async ({ page }) => {
    await clearLocalStorage(page, serverIndexUrl);
    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
    });
    await createRealm(page, realmName);

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
            <p data-test-paragraph-with-no-global-style>Hello <@fields.name /></p>
            <style scoped>
              :global(p) {
                font-style: italic;
              }
            </style>
          </template>
        };
      }`,
    );

    newCardURL = await postNewCard(page, realmURL, {
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

    await page.goto(newCardURL);

    await page.pause();

    await expect(
      page.locator('[data-test-paragraph-with-no-global-style]'),
    ).toHaveCSS('font-style', 'normal');
  });
});
