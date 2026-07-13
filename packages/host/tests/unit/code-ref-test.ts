import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader, LooseCardResource } from '@cardstack/runtime-common';
import { loadCardDef, rri, visitModuleDeps } from '@cardstack/runtime-common';
import * as CodeRefSerializer from '@cardstack/runtime-common/serializers/code-ref';

import {
  testRealmURL,
  testRRI,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type * as CardAPI from '@cardstack/base/card-api';

module('code-ref', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  let loader: Loader;

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': `
          import { contains, field, CardDef } from '@cardstack/base/card-api';
          import StringField from '@cardstack/base/string';
          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringField);
          }
        `,
          'code-ref-test.ts': `
          import { contains, field, Component, CardDef } from '@cardstack/base/card-api';
          import CodeRefField from '@cardstack/base/code-ref';

          export class TestCard extends CardDef {
            @field ref = contains(CodeRefField);
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                <@fields.ref />
              </template>
            };
          }
        `,
        },
      }),
    );
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  test('can dynamically load a card definition', async function (assert) {
    let ref = {
      module: testRRI('person'),
      name: 'Person',
    };
    await loadCardDef(ref, { loader });
    let doc = {
      data: {
        attributes: { firstName: 'Mango' },
        meta: { adoptsFrom: ref },
      },
    };
    let api = await loader.import<typeof CardAPI>(
      'https://cardstack.com/base/card-api',
    );
    let person = await api.createFromSerialized<any>(doc.data, doc, undefined);
    assert.strictEqual(person.firstName, 'Mango', 'card data is correct');
  });

  test('can instantiate a card that uses a code-ref field', async function (assert) {
    let adoptsFrom = {
      module: testRRI('code-ref-test'),
      name: 'TestCard',
    };
    await loadCardDef(adoptsFrom, { loader });
    let ref = {
      module: testRRI('person'),
      name: 'Person',
    };
    let doc = {
      data: {
        attributes: { ref },
        meta: { adoptsFrom },
      },
    };
    let api = await loader.import<typeof CardAPI>(
      'https://cardstack.com/base/card-api',
    );
    let testCard = await api.createFromSerialized<any>(
      doc.data,
      doc,
      undefined,
    );
    assert.deepEqual(testCard.ref, ref, 'card data is correct');
  });

  test('can visit module URLs of different types of modules', async function (assert) {
    let json: LooseCardResource = {
      meta: {
        adoptsFrom: {
          module: testRRI('code-ref-test'),
          name: 'TestCard',
        },
        fields: {
          field1: {
            adoptsFrom: {
              type: 'ancestorOf',
              card: {
                module: testRRI('code-ref-test-1'),
                name: 'TestCard1',
              },
            },
          },
          field2: [
            {
              adoptsFrom: {
                type: 'fieldOf',
                card: {
                  module: testRRI('code-ref-test-3'),
                  name: 'TestCard3',
                },
                field: 'someField',
              },
            },
          ],
        },
      },
    };
    visitModuleDeps(json, (moduleURL, setModuleURL) => {
      setModuleURL(rri(moduleURL.replace('code-ref-test', 'foo-bar')));
    });
    assert.deepEqual(json, {
      meta: {
        adoptsFrom: {
          module: testRRI('foo-bar'),
          name: 'TestCard',
        },
        fields: {
          field1: {
            adoptsFrom: {
              type: 'ancestorOf',
              card: {
                module: testRRI('foo-bar-1'),
                name: 'TestCard1',
              },
            },
          },
          field2: [
            {
              adoptsFrom: {
                type: 'fieldOf',
                card: {
                  module: testRRI('foo-bar-3'),
                  name: 'TestCard3',
                },
                field: 'someField',
              },
            },
          ],
        },
      },
    });
  });

  test('serializes CodeRef modules to absolute URLs', function (assert) {
    let ref = { module: './person', name: 'Person' };
    let base = new URL(`${testRealmURL}Listing/author`);
    let doc = { data: { id: base.href } };
    let serialized = CodeRefSerializer.serialize(ref, doc, undefined, {
      relativeTo: base,
    }) as any;
    assert.strictEqual(
      serialized.module,
      `${testRealmURL}Listing/person`,
      'module is absolutized using provided base URL',
    );
  });

  test('resolves relative CodeRef modules against a prefix-form RRI base', async function (assert) {
    // A card whose own id is canonical prefix-form (a realm with a prefix
    // mapping) with a relative CodeRef module: resolution must happen in RRI
    // space and stay prefix-form, not require an http(s) base.
    let ref = { module: './person', name: 'Person' };
    let baseRRI = rri('@cardstack/catalog/Listing/author');
    let doc = { data: { id: baseRRI } };
    let serialized = CodeRefSerializer.serialize(ref, doc, undefined, {
      relativeTo: baseRRI,
    }) as any;
    assert.strictEqual(
      serialized.module,
      '@cardstack/catalog/Listing/person',
      'module resolves against the prefix-form base, preserving prefix form',
    );

    // The same resolution on the deserialize-absolute path (the field
    // deserialize protocol), which passes the base through directly. Before
    // the RRI-space fix this reached `new URL('./person', undefined)`.
    let result = await CodeRefSerializer.deserializeAbsolute.call(
      class {} as any,
      ref,
      baseRRI,
      undefined,
      {} as any,
    );
    assert.strictEqual(
      (result as any).module,
      '@cardstack/catalog/Listing/person',
      'deserializeAbsolute resolves the relative module against the prefix base',
    );
  });
});
