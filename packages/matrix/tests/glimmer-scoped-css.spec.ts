import { test, expect } from '@playwright/test';
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
} from '../helpers';

test.describe('glimmer-scoped-css', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;
  const serverIndexUrl = new URL(appURL).origin;
  const realmName = 'realm1';
  const realmURL = new URL(`user1/${realmName}/`, serverIndexUrl).href;

  let newCardURL: string;

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
    await setupUserSubscribed('@user1:localhost', realmServer);
  });

  test.afterEach(async () => {
    await realmServer?.stop();
    await synapseStop(synapse.synapseId);
  });

  test(':global is ignored and does not affect styles', async ({ page }) => {
    await clearLocalStorage(page, serverIndexUrl);
    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
      skipOpeningAssistant: true,
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
