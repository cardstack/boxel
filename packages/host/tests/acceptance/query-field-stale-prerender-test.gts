import { findAll, settled, triggerEvent, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { Loader, SearchEntryWireQuery } from '@cardstack/runtime-common';
import { testRealmInfo } from '@cardstack/runtime-common/helpers/const';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import {
  saveCard,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
  visitOperatorMode,
} from '../helpers';
import {
  CardDef,
  Component,
  contains,
  field,
  linksToMany,
  NumberField,
  setupBaseRealm,
  StringField,
} from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const DASHBOARD_URL = `${testRealmURL}dashboard`;
const PARENT_URL = `${testRealmURL}Parent/p1`;

// A rollup over a query-backed relationship is the one number the index cannot
// serve. A card the query merely matched is not a dependency of the card
// holding the query, so writing that card never invalidates the rollup's owner;
// and the render that produces the owner's HTML resolves its fields from the
// document it was handed, which carries no query-backed relationship at all. So
// the prerendered rollup reduces over nothing and renders as empty — the shape
// that is hardest to spot, because an empty rollup is also a real answer.
//
// What holds the surface together is hydration. A prerendered row is inert
// markup until the live instance resolves — on a gesture, or as soon as the
// instance is resident by any other means — and the live card recomputes the
// rollup from the field's own search. Both halves are exercised here against a
// real index: the row is provably stale before, and provably correct after.
module(
  'Acceptance | query-field rollup | stale prerendered HTML self-corrects',
  function (hooks) {
    setupApplicationTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: false,
    });
    let loader: Loader;
    let LeafClass: typeof CardDef;

    hooks.beforeEach(async function () {
      class Leaf extends CardDef {
        static displayName = 'Leaf';
        @field group = contains(StringField);
      }
      class Parent extends CardDef {
        static displayName = 'Parent';
        @field groupName = contains(StringField);
        @field myLeaves = linksToMany(() => Leaf, {
          query: {
            filter: { eq: { group: '$this.groupName' } },
            page: { size: 50 },
          },
        });
        @field leafCount = contains(NumberField, {
          computeVia: function (this: Parent) {
            return (this.myLeaves ?? []).length;
          },
        });
        static fitted = class Fitted extends Component<typeof Parent> {
          <template>
            <div data-test-leaf-count>{{@model.leafCount}}</div>
          </template>
        };
      }
      // Renders the realm's Parent cards through the card-facing search
      // surface, which prefers a prerendered rendering and falls back to a
      // live card.
      class Dashboard extends CardDef {
        static displayName = 'Dashboard';
        static isolated = class Isolated extends Component<typeof Dashboard> {
          get query(): SearchEntryWireQuery {
            return {
              filter: {
                'item.on': { module: testRRI('rollup'), name: 'Parent' },
              },
              realms: [testRealmURL],
            };
          }
          <template>
            <@context.searchResultsComponent
              @query={{this.query}}
              @mode='hover'
            />
          </template>
        };
      }
      LeafClass = Leaf as unknown as typeof CardDef;

      // Nothing here loads the parent, so it stays absent from the store and
      // its row renders as the inert markup the index produced.
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          'rollup.gts': { Leaf, Parent, Dashboard },
          'Parent/p1.json': new Parent({ groupName: 'alpha' }),
          'Leaf/a.json': new Leaf({ group: 'alpha' }),
          'dashboard.json': new Dashboard(),
        },
      });
      loader = getService('loader-service').loader;
    });

    // Add a second card the parent's query matches, and announce it the way
    // the realm does. The parent is not in the invalidation set, because the
    // only thing tying it to the leaf is the query.
    async function addSecondLeaf() {
      await saveCard(
        new (LeafClass as any)({ group: 'alpha' }),
        `${testRealmURL}Leaf/b`,
        loader,
      );
      mockMatrixUtils.simulateRemoteMessage(
        mockMatrixUtils.getRoomIdForRealmAndUser(
          testRealmURL,
          '@testuser:localhost',
        ),
        testRealmInfo.realmUserId!,
        {
          eventName: 'index',
          indexType: 'incremental',
          invalidations: [`${testRealmURL}Leaf/b`],
          realmURL: testRealmURL,
        },
        { type: APP_BOXEL_REALM_EVENT_TYPE },
      );
      await settled();
    }

    function renderedCounts() {
      return findAll('[data-test-leaf-count]').map((el) =>
        el.textContent?.trim(),
      );
    }

    test('an inert row serves the stale count until a gesture hydrates it', async function (assert) {
      await addSecondLeaf();

      await visitOperatorMode({
        stacks: [[{ id: DASHBOARD_URL, format: 'isolated' }]],
      });
      await waitFor(`[data-test-hydratable-card="${PARENT_URL}"]`);

      assert
        .dom(
          `[data-test-hydratable-card="${PARENT_URL}"][data-hydration="hover"]`,
        )
        .exists('the parent row starts as inert prerendered markup');
      assert.deepEqual(
        renderedCounts(),
        ['0'],
        'the prerendered rollup reports the field as empty',
      );

      await triggerEvent(
        `[data-test-hydratable-card="${PARENT_URL}"]`,
        'mouseenter',
      );

      assert
        .dom(
          `[data-test-hydratable-card="${PARENT_URL}"][data-hydration="hydrated"]`,
        )
        .exists('the gesture resolves the live card');
      assert.deepEqual(
        renderedCounts(),
        ['2'],
        'the live card recomputes the rollup from the query field',
      );
    });

    test('a parent already resident in the store renders its rollup live', async function (assert) {
      // Loading the parent is enough — the row resolves live off residency
      // and never shows the prerendered count.
      await getService('store').get(PARENT_URL);
      await addSecondLeaf();

      await visitOperatorMode({
        stacks: [[{ id: DASHBOARD_URL, format: 'isolated' }]],
      });
      await waitFor(`[data-test-hydratable-card="${PARENT_URL}"]`);
      await settled();

      assert.deepEqual(
        renderedCounts(),
        ['2'],
        'residency renders the rollup from live data',
      );
      assert
        .dom(
          `[data-test-hydratable-card="${PARENT_URL}"][data-hydration="hover"]`,
        )
        .doesNotExist('a resident row never sits inert waiting for a gesture');
    });
  },
);
