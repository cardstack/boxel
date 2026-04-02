import { test, expect } from './fixtures';
import { appURL } from '../helpers/isolated-realm-server';
import {
  clearLocalStorage,
  createRealm,
  postCardSource,
  postNewCard,
  createSubscribedUserAndLogin,
  login,
  logout,
} from '../helpers';

test.describe('glimmer-scoped-css', () => {
  const serverIndexUrl = new URL(appURL).origin;

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
      import { CardDef, field, contains, StringField } from '@cardstack/base/card-api';
      import { Component } from '@cardstack/base/card-api';
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

    await page.goto(newCardURL);
    await expect(
      page.locator('[data-test-paragraph-with-no-global-style]'),
    ).toHaveCSS('font-style', 'normal');
  });

  test('scoped card styles are restored after logging out and back in', async ({
    page,
  }) => {
    const realmName = 'realm2';
    await clearLocalStorage(page, serverIndexUrl);
    let { username, password } = await createSubscribedUserAndLogin(
      page,
      'glimmer-css-relogin-user',
      serverIndexUrl,
    );
    const realmURL = new URL(`${username}/${realmName}/`, serverIndexUrl).href;
    await createRealm(page, realmName);

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
            <p data-test-scoped-style-restored>Hello <@fields.name /></p>
            <style scoped>
              p {
                background-color: rgb(1, 2, 3);
              }
            </style>
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

    await page.goto(newCardURL);

    await expect(page.locator('[data-test-scoped-style-restored]')).toHaveCSS(
      'background-color',
      'rgb(1, 2, 3)',
    );

    await logout(page);
    await login(page, username, password, { url: newCardURL });

    await expect(page.locator('[data-test-scoped-style-restored]')).toHaveCSS(
      'background-color',
      'rgb(1, 2, 3)',
    );
  });
});
