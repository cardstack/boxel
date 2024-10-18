import { test, expect } from '@playwright/test';
import { writeJSONSync, writeFileSync } from 'fs-extra';
import { join } from 'path';
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
    realmServer = await startRealmServer();
    await registerUser(synapse, 'user1', 'pass');
  });

  test.afterEach(async () => {
    await realmServer?.stop();
    await synapseStop(synapse.synapseId);
  });

  test('it can subscribe to SSE events of a private realm', async ({
    page,
  }) => {
    await clearLocalStorage(page, serverIndexUrl);
    await login(page, 'user1', 'pass', {
      url: serverIndexUrl,
      skipOpeningAssistant: true,
    });
    await createRealm(page, realmName);
    await page.goto(`${realmURL}hello-world`);
    await expect(
      page.locator(`[data-test-card="${realmURL}hello-world"]`),
    ).toContainText('Hello World');

    // assert that instance updates are live bound
    let helloWorldPath = join(
      realmServer.realmPath,
      '..',
      'user1',
      realmName,
      'hello-world.json',
    );
    await expect(
      page.locator('[data-test-realm-indexing-indicator]'),
    ).toHaveCount(0);
    writeJSONSync(helloWorldPath, {
      data: {
        type: 'card',
        attributes: {
          title: 'Hello Mars',
          description: 'This is a test card instance.',
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
      page.locator(`[data-test-card="${realmURL}hello-world"]`),
    ).toContainText('Hello Mars');
    await expect(
      page.locator('[data-test-realm-indexing-indicator]'),
    ).toHaveCount(0);

    // assert that index card is live bound
    await page.goto(realmURL);
    await showAllCards(page);

    let cardDefPath = join(
      realmServer.realmPath,
      '..',
      'user1',
      realmName,
      'sample-card.gts',
    );
    writeFileSync(
      cardDefPath,
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
    let instancePath = join(
      realmServer.realmPath,
      '..',
      'user1',
      realmName,
      'test.json',
    );
    writeJSONSync(instancePath, {
      data: {
        type: 'card',
        attributes: {
          title: 'Mango',
          name: 'Mango',
        },
        meta: {
          adoptsFrom: {
            module: './sample-card',
            name: 'SampleCard',
          },
        },
      },
    });

    await expect(
      page.locator(`[data-test-cards-grid-item="${realmURL}test"]`),
    ).toHaveCount(1);
    await page.locator(`[data-test-cards-grid-item="${realmURL}test"]`).click();
    await expect(
      page.locator(`[data-test-stack-card="${realmURL}test"]`),
    ).toContainText('Hello Mango');

    // assert that instances that consume updated modules are live bound
    writeFileSync(
      cardDefPath,
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
      page.locator(`[data-test-stack-card="${realmURL}test"]`),
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
    await expect(page.locator('[data-test-file="hello.txt"]')).toHaveCount(0);
    let instance2Path = join(
      realmServer.realmPath,
      '..',
      'user1',
      realmName,
      'hello.txt',
    );
    writeFileSync(instance2Path, 'hi');
    await expect(page.locator('[data-test-file="hello.txt"]')).toHaveCount(1);
  });
});
