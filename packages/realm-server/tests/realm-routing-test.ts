import { module, test } from 'qunit';
import { basename } from 'path';
import { rri } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import { setupPermissionedRealmCached } from './helpers';

// CS-10054: fixture for Realm.getHostRoutingMap coverage. The fixture is a
// realm.json RealmConfig card with one routing rule mapping `/whitepaper`
// to a white-paper card in the same realm.
function makeRoutingFixture(): Record<
  string,
  string | LooseSingleCardDocument
> {
  return {
    'white-paper.gts': `
      import { CardDef, Component } from "https://cardstack.com/base/card-api";
      export class WhitePaper extends CardDef {
        static displayName = 'White Paper';
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <article data-test-white-paper>White paper content</article>
          </template>
        }
      }
    `,
    'white-paper.json': {
      data: {
        type: 'card',
        attributes: {},
        meta: {
          adoptsFrom: { module: rri('./white-paper'), name: 'WhitePaper' },
        },
      },
    },
    'realm.json': {
      data: {
        type: 'card',
        attributes: {
          cardInfo: { name: 'Routing Test Realm' },
          hostRoutingRules: [
            { path: '/whitepaper', instance: './white-paper' },
          ],
        },
        meta: {
          adoptsFrom: {
            module: rri('https://cardstack.com/base/realm-config'),
            name: 'RealmConfig',
          },
        },
      },
    },
  };
}

module(basename(__filename), function () {
  module('Realm.getHostRoutingMap', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/routing-unit/');
    let testRealm: Realm;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: makeRoutingFixture(),
      onRealmSetup({ testRealm: realm }) {
        testRealm = realm;
      },
    });

    hooks.beforeEach(async function () {
      await testRealm.indexing();
    });

    test('reads routing rules from the indexed RealmConfig card', async function (assert) {
      let map = await testRealm.getHostRoutingMap();

      assert.deepEqual(
        map,
        [{ path: '/whitepaper', id: `${realmURL.href}white-paper` }],
        'returns one rule mapping /whitepaper to the absolute white-paper URL',
      );
    });
  });
});
