import { module, test } from 'qunit';
import { basename } from 'path';
import { rri } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import { setupPermissionedRealmCached } from './helpers';

// CS-10054: fixture for Realm.getHostRoutingMap coverage. One rule uses
// a relative reference (the recommended form, portable across realm URL
// changes) and one is cross-realm — the latter must be dropped by the
// same-realm guard.
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
          // `instance` is a linksTo on RoutingRuleField, so the link
          // target lives in `relationships` keyed by the field path
          // (`hostRoutingRules.<i>.instance`), not inline in attributes.
          hostRoutingRules: [{ path: '/rel' }, { path: '/foreign' }],
        },
        relationships: {
          'hostRoutingRules.0.instance': {
            links: { self: './white-paper' },
          },
          // Cross-realm: must be filtered out by the same-realm
          // guard. The project spec restricts routing rules to cards
          // within the same realm; this verifies the read path
          // enforces that even when the UI guard is bypassed by
          // hand-editing realm.json.
          'hostRoutingRules.1.instance': {
            links: { self: 'http://otherrealm.test/x' },
          },
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

    test('resolves relative references and drops cross-realm rules', async function (assert) {
      let map = await testRealm.getHostRoutingMap();

      assert.deepEqual(
        map,
        [{ path: '/rel', id: `${realmURL.href}white-paper` }],
        'relative reference resolved against the realm root; cross-realm rule filtered',
      );
    });
  });
});
