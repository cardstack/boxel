import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm, Loader, loadCardDef } from '@cardstack/runtime-common';

import * as CardAPI from 'https://cardstack.com/base/card-api';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

module('code-ref', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  let loader: Loader;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': `
          import { contains, field, CardDef } from 'https://cardstack.com/base/card-api';
          import StringField from 'https://cardstack.com/base/string';
          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringField);
          }
        `,
        'code-ref-test.ts': `
          import { contains, field, Component, CardDef } from 'https://cardstack.com/base/card-api';
          import CodeRefField from 'https://cardstack.com/base/code-ref';

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
    });
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('can dynamically load a card definition', async function (assert) {
    let ref = {
      module: `${testRealmURL}person`,
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
      module: `${testRealmURL}code-ref-test`,
      name: 'TestCard',
    };
    await loadCardDef(adoptsFrom, { loader });
    let ref = { module: `${testRealmURL}person`, name: 'Person' };
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
});
