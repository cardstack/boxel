import { test, expect } from '@playwright/test';
import { appURL } from '../helpers/isolated-realm-server';
import {
  clearLocalStorage,
  createRealm,
  postCardSource,
  postNewCard,
  createSubscribedUserAndLogin,
} from '../helpers';

test.describe('glimmer-scoped-css', () => {
  const serverIndexUrl = new URL(appURL).origin;

  let newCardURL: string;

  test.beforeEach(async () => {
    // synapse defaults to 30s for beforeEach to finish, we need a bit more time
    // to safely start the realm
    test.setTimeout(120_000);
  });

  test(':global is ignored and does not affect styles', async ({ page }) => {
    const realmName = 'realm1';
    await clearLocalStorage(page, serverIndexUrl);
    let { username } = await createSubscribedUserAndLogin(
      page,
      'glimmer-css-user',
      serverIndexUrl,
    );
    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;
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
