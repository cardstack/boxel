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
  showAllCards,
  setupUserSubscribed,
  patchCard,
  postCardSource,
  postNewCard,
} from '../helpers';

test.describe('Live Cards', () => {
  let synapse: SynapseInstance;
  let realmServer: IsolatedRealmServer;
  const serverIndexUrl = new URL(appURL).origin;
  const realmName = 'realm1';
  const realmURL = new URL(`user1/${realmName}/`, serverIndexUrl).href;

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

  test('it can subscribe to realm events of a private realm', async ({
    page,
  }) => {
    await clearLocalStorage(page, serverIndexUrl);
    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
      skipOpeningAssistant: true,
    });
    await createRealm(page, realmName);
    await page.goto(
      `${realmURL}HelloWorld/47c0fc54-5099-4e9c-ad0d-8a58572d05c0`,
    );
    await expect(
      page.locator(
        `[data-test-card="${realmURL}HelloWorld/47c0fc54-5099-4e9c-ad0d-8a58572d05c0"]`,
      ),
    ).toContainText('Some folks say');

    // assert that instance updates are live bound
    await expect(
      page.locator('[data-test-realm-indexing-indicator]'),
    ).toHaveCount(0);

    await patchCard(
      page,
      realmURL,
      `${realmURL}HelloWorld/47c0fc54-5099-4e9c-ad0d-8a58572d05c0`,
      {
        data: {
          type: 'card',
          attributes: {
            fullName: 'Hello Mars',
            heroUrl:
              'https://boxel-images.boxel.ai/app-assets/hello-world/beach-volley-hero.jpg',
            headshotUrl:
              'https://boxel-images.boxel.ai/app-assets/hello-world/luke-vb-headshot.jpg',
            bio: 'Luke Melia is a beach volleyball player living in downtown New York City. He is a left-side defender with a good serve and good court sense. What Luke lacks in height, he makes up in heart and craftiness.\n\nOutside of playing beach volleyball, Luke enjoys watching professional beach volleyball, primarily the AVP (the American domestic pro tour) and the FIVB (the world tour). He also enjoys surfing, skateboarding, parkour, and rock climbing.\n\nWhen Luke is not competing or challenging himself physically, he is usually writing code or creating digital products. His languages of choice are Ruby and Javascript.\n\nLuke lives in New York City with his wife and two daughters.',
            quote:
              "Some folks say I was born on the wrong coast, that I live a West Coast lifestyle in New York City. But I've found a way to integrate beach volleyball into my life as a New Yorker. I've been lucky enough to play plenty outside of New York, too, from Cali to Bali to Thailand and lots of spots in between. I guess you could say I'm poly-coastal!",
            description: null,
            thumbnailURL: null,
          },
          meta: {
            adoptsFrom: {
              module: '../hello-world',
              name: 'HelloWorld',
            },
          },
        },
      },
    );

    await expect(
      page.locator('[data-test-realm-indexing-indicator]'),
    ).toHaveCount(1);
    await expect(
      page.locator(
        `[data-test-card="${realmURL}HelloWorld/47c0fc54-5099-4e9c-ad0d-8a58572d05c0"]`,
      ),
    ).toContainText('Hello Mars');
    await expect(
      page.locator('[data-test-realm-indexing-indicator]'),
    ).toHaveCount(0);

    // assert that index card is live bound
    await page.goto(realmURL);
    await showAllCards(page);

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
      skipOpeningAssistant: true,
    });
    await createRealm(page, realmName);

    await page.goto(
      `${realmURL}?operatorModeState=${encodeURIComponent(
        JSON.stringify({
          stacks: [],
          codePath: `${realmURL}HelloWorld/47c0fc54-5099-4e9c-ad0d-8a58572d05c0`,
          fileView: 'browser',
          submode: 'code',
        }),
      )}`,
    );

    await page.locator('[data-test-format-chooser="edit"]').click();
    await page
      .locator('[data-test-field="fullName"] input')
      .fill('Replacement');

    await page.pause();

    await expect(
      page.locator('[data-test-monaco-container-operator-mode]'),
    ).toContainText('Replacement');
  });
});
