import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import ListingUpdateSpecsCommand from '@cardstack/host/commands/listing-update-specs';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmURL,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let Listing: typeof import('@cardstack/catalog/catalog-app/listing/listing').Listing;

module('Integration | commands | listing-update-specs', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  const modulePath = `${testRealmURL}listing-example.gts`;
  let loader: Loader;
  let testRealm: { write: (path: string, content: string) => Promise<void> };

  setupRealmServerEndpoints(hooks, [
    {
      route: '_dependencies',
      getResponse: async function () {
        return new Response(JSON.stringify([modulePath]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    {
      route: '_request-forward',
      getResponse: async function (req: Request) {
        const body = await req.json();
        if (body.url === 'https://openrouter.ai/api/v1/chat/completions') {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: 'stubbed readme',
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ error: 'Unknown endpoint' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  ]);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  hooks.beforeEach(async function () {
    let result = await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'listing-example.gts': `
          import { CardDef } from 'https://cardstack.com/base/card-api';

          export class ExampleCard extends CardDef {
            static displayName = 'Example Card';
          }
        `,
        'Example/1.json': {
          data: {
            id: `${testRealmURL}Example/1`,
            type: 'card',
            meta: {
              adoptsFrom: {
                module: '../listing-example',
                name: 'ExampleCard',
              },
            },
          },
        },
      },
    });
    let cardApi = await loader.import(`${baseRealm.url}card-api`);
    Listing = (
      await loader.import('@cardstack/catalog/catalog-app/listing/listing')
    ).Listing;
    testRealm = result.realm;
    await getService('realm').login(testRealmURL);
  });

  test('updates specs when a module adds a new export', async function (assert) {
    let commandService = getService('command-service');
    let listingUpdateSpecsCommand = new ListingUpdateSpecsCommand(
      commandService.commandContext,
    );

    let store = getService('store');
    let listing = (await store.add(new Listing(), {
      realm: testRealmURL,
    })) as InstanceType<typeof Listing>;
    let exampleCard = (await store.get(`${testRealmURL}Example/1`)) as CardDef;
    (listing as any).examples = [exampleCard];

    let result = await listingUpdateSpecsCommand.execute({ listing });
    let specNames = result.specs.map((spec) => spec.ref?.name).filter(Boolean);
    assert.deepEqual(specNames, ['ExampleCard'], 'initial spec is created');

    await testRealm.write(
      'listing-example.gts',
      `
        import { CardDef } from 'https://cardstack.com/base/card-api';

        export class ExampleCard extends CardDef {
          static displayName = 'Example Card';
        }

        export class AnotherCard extends CardDef {
          static displayName = 'Another Card';
        }
      `,
    );
    getService('loader-service').resetLoader({
      reason: 'refresh module exports',
    });

    result = await listingUpdateSpecsCommand.execute({ listing });
    specNames = result.specs
      .map((spec) => spec.ref?.name)
      .filter(Boolean)
      .sort();
    assert.deepEqual(
      specNames,
      ['AnotherCard', 'ExampleCard'],
      'new export is reflected in specs',
    );
  });
});
