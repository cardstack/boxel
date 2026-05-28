import { click, fillIn, render, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  PermissionsContextName,
  type LooseCardResource,
  type Permissions,
  type SerializedError,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

import {
  provideConsumeContext,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import {
  CardDef,
  Component,
  contains,
  field,
  getDataBucket,
  linksToMany,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const GHOST_URL = `${testRealmURL}Pet/ghost`;
const MANGO_URL = `${testRealmURL}Pet/mango`;
const VANGOGH_URL = `${testRealmURL}Pet/vangogh`;
const EXPLODED_URL = `${testRealmURL}Pet/exploded`;

// Pet renders its name in every view format; the `{{#if @model}}` guard means a
// slot with no card renders nothing, so "the broken slot shows no card" can be
// asserted literally. Person renders its `pets` linksToMany field fitted (so the
// list flows through the standard 65px item-container view path) and, in edit
// format, alongside an editable `firstName` so a focus/stability test can type
// into a sibling input while a broken element sits in the list.
function makeCards() {
  class Pet extends CardDef {
    static displayName = 'Pet';
    @field firstName = contains(StringField);
    static fitted = class extends Component<typeof Pet> {
      <template>
        {{#if @model}}<span data-test-pet>{{@model.firstName}}</span>{{/if}}
      </template>
    };
    static atom = class extends Component<typeof Pet> {
      <template>
        {{#if @model}}<span data-test-pet>{{@model.firstName}}</span>{{/if}}
      </template>
    };
  }
  class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    @field pets = linksToMany(Pet);
    static isolated = class extends Component<typeof Person> {
      <template><@fields.pets @format='fitted' /></template>
    };
    static edit = class extends Component<typeof Person> {
      <template>
        <section data-test-name-field><@fields.firstName /></section>
        <@fields.pets />
      </template>
    };
  }
  return { Person, Pet };
}

// Build a Person attached to the realm-backed store without indexing it, so
// reading `pets` drives the real lazilyLoadLink fetch (and its failure path)
// rather than surfacing a persisted error doc.
async function createPerson(
  relationships: LooseCardResource['relationships'],
): Promise<CardDefType & { pets: unknown }> {
  let store = getService('store');
  let resource: LooseCardResource = {
    attributes: { firstName: 'Hassan' },
    relationships,
    meta: { adoptsFrom: { module: testRRI('test-cards'), name: 'Person' } },
  };
  return (await store.__dangerousCreateFromSerialized(
    resource,
    { data: resource },
    new URL(testRealmURL),
  )) as CardDefType & { pets: unknown };
}

let loader: Loader;

module(
  'Integration | linksToMany broken-link placeholder (per element)',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
    });

    hooks.beforeEach(function () {
      let permissions: Permissions = { canWrite: true, canRead: true };
      provideConsumeContext(PermissionsContextName, permissions);
      loader = getService('loader-service').loader;
    });

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    // Realm holds Person/Pet plus two real Pets (`Pet/mango`, `Pet/vangogh`);
    // `Pet/ghost` is never present, so links to it resolve to a 404.
    async function setupRealm() {
      let { Person, Pet } = makeCards();
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Pet },
          'Pet/mango.json': {
            data: {
              attributes: { firstName: 'Mango' },
              meta: {
                adoptsFrom: { module: testRRI('test-cards'), name: 'Pet' },
              },
            },
          },
          'Pet/vangogh.json': {
            data: {
              attributes: { firstName: 'Van Gogh' },
              meta: {
                adoptsFrom: { module: testRRI('test-cards'), name: 'Pet' },
              },
            },
          },
        },
      });
    }

    test('a mixed list renders each element correctly — present cards plus a per-element placeholder for the broken slot', async function (assert) {
      await setupRealm();
      let person = await createPerson({
        'pets.0': { links: { self: MANGO_URL } },
        'pets.1': { links: { self: GHOST_URL } },
        'pets.2': { links: { self: VANGOGH_URL } },
      });

      await renderCard(loader, person, 'isolated');
      await waitFor('[data-test-broken-link-template]');
      await waitFor('[data-test-plural-view-item="0"] [data-test-pet]');
      await waitFor('[data-test-plural-view-item="2"] [data-test-pet]');

      // The two healthy slots render their cards; the broken slot in the middle
      // renders the placeholder, not a card. (The broken slot is the one item
      // container that holds no card — every slot still gets its own container.)
      assert
        .dom('[data-test-plural-view-item="0"] [data-test-pet]')
        .hasText('Mango', 'the first (present) element renders its card');
      assert
        .dom('[data-test-plural-view-item="2"] [data-test-pet]')
        .hasText('Van Gogh', 'the sibling after the broken slot still renders');

      // One broken element does not break the list: three item containers, two
      // cards, exactly one placeholder, and the placeholder sits in neither
      // healthy slot — i.e. it occupies the middle slot.
      assert.dom('.linksToMany-itemContainer').exists({ count: 3 });
      assert.dom('[data-test-pet]').exists({ count: 2 });
      assert.dom('[data-test-broken-link-template]').exists({ count: 1 });
      assert
        .dom('[data-test-broken-link-state]')
        .hasAttribute('data-test-broken-link-state', 'not-found');
      assert.dom('[data-test-broken-link-url]').hasText(GHOST_URL);
      assert
        .dom(
          '[data-test-plural-view-item="0"] [data-test-broken-link-template]',
        )
        .doesNotExist('the first (present) slot is not the broken one');
      assert
        .dom(
          '[data-test-plural-view-item="2"] [data-test-broken-link-template]',
        )
        .doesNotExist('the last (present) slot is not the broken one');
    });

    test('a link-error sentinel element renders the error placeholder with its message', async function (assert) {
      await setupRealm();
      // A non-404 failure surfaces as `link-error`; hand-plant it in the slot so
      // the test does not depend on a flaky upstream 500.
      let person = await createPerson({
        'pets.0': { links: { self: MANGO_URL } },
      });
      // Read once so the present slot resolves to a card instance, then append
      // an error sentinel into the same array (identity preserved).
      person.pets;
      await waitUntil(() => {
        let arr = getDataBucket(person).get('pets');
        return Array.isArray(arr) && arr.length === 1 && arr[0]?.firstName;
      });
      let arr = getDataBucket(person).get('pets');
      arr.push({
        type: 'link-error',
        reference: EXPLODED_URL,
        errorDoc: {
          status: 500,
          title: 'Internal Server Error',
          message: 'upstream exploded',
          additionalErrors: null,
        } satisfies SerializedError,
      });

      await renderCard(loader, person, 'isolated');
      await waitFor('[data-test-broken-link-template]');
      await waitFor('[data-test-plural-view-item="0"] [data-test-pet]');

      assert
        .dom('[data-test-plural-view-item="0"] [data-test-pet]')
        .hasText('Mango', 'the present element still renders its card');
      assert.dom('[data-test-broken-link-template]').exists({ count: 1 });
      // The list renders fitted, so the placeholder adopts the fitted footprint
      // (which suppresses the verbose error message); the error state and broken
      // URL are what surface per element.
      assert
        .dom('[data-test-broken-link-template]')
        .hasAttribute('data-test-broken-link-template', 'fitted');
      assert
        .dom('[data-test-broken-link-state]')
        .hasAttribute('data-test-broken-link-state', 'error');
      assert.dom('[data-test-broken-link-url]').hasText(EXPLODED_URL);
      assert
        .dom(
          '[data-test-plural-view-item="0"] [data-test-broken-link-template]',
        )
        .doesNotExist('the present slot is not the broken one');
    });

    test('a list of only present links renders no placeholder', async function (assert) {
      await setupRealm();
      let person = await createPerson({
        'pets.0': { links: { self: MANGO_URL } },
        'pets.1': { links: { self: VANGOGH_URL } },
      });

      await renderCard(loader, person, 'isolated');
      await waitFor('[data-test-plural-view-item="1"] [data-test-pet]');

      assert
        .dom('[data-test-broken-link-template]')
        .doesNotExist('no placeholder for a healthy list');
      assert.dom('[data-test-pet]').exists({ count: 2 });
    });

    test('the placeholder occupies the same per-element item container as a card', async function (assert) {
      await setupRealm();
      let person = await createPerson({
        'pets.0': { links: { self: GHOST_URL } },
      });

      await renderCard(loader, person, 'isolated');
      await waitFor('[data-test-broken-link-template]');

      // The placeholder is mounted inside the standard linksToMany item
      // container (the 65px fitted row), exactly where the card would have been.
      assert
        .dom('.linksToMany-itemContainer [data-test-broken-link-template]')
        .exists('the placeholder renders inside the item container');
      assert
        .dom('[data-test-broken-link-template]')
        .hasAttribute(
          'data-test-broken-link-template',
          'fitted',
          'the placeholder adopts the fitted footprint of the list item',
        );
    });

    test('a list with one broken element converges in at most two renders', async function (assert) {
      await setupRealm();
      // The broken element is the only slot with pending work — a present
      // sibling would lazy-load independently and add its own re-render, which
      // is orthogonal to the broken-link mechanism under test here.
      let person = await createPerson({
        'pets.0': { links: { self: GHOST_URL } },
      });

      let api = await loader.import<
        typeof import('https://cardstack.com/base/card-api')
      >(`${baseRealm.url}card-api`);
      let PersonComponent = api.getComponent(person);

      let renderCount = 0;
      // Reading `pets` here entangles the counter with the same card-tracking
      // tag the list subtree consumes, so `bump` re-runs on exactly the
      // invalidation that swaps not-loaded → not-found.
      let bump = () => {
        renderCount++;
        void (person as unknown as { pets: unknown }).pets;
        return '';
      };

      await render(
        <template>
          <span>{{bump}}</span>
          <PersonComponent @format='isolated' />
        </template>,
      );
      await waitFor('[data-test-broken-link-template]');

      assert.ok(
        renderCount <= 2,
        `a list with a permanently-broken element converged in ${renderCount} render(s) (initial + post-lazy-load)`,
      );
    });

    test('in edit format a broken element shows the placeholder and can be removed', async function (assert) {
      await setupRealm();
      let person = await createPerson({
        'pets.0': { links: { self: MANGO_URL } },
        'pets.1': { links: { self: GHOST_URL } },
      });

      await renderCard(loader, person, 'edit');
      await waitFor('[data-test-broken-link-template]');
      await waitFor('[data-test-pet]');

      assert
        .dom('[data-test-broken-link-template]')
        .exists({ count: 1 }, 'the broken element shows the placeholder');
      assert
        .dom('[data-test-broken-link-url]')
        .hasText(GHOST_URL, 'editor placeholder shows the broken URL');
      // The healthy sibling still renders its card and the editor still offers
      // the add affordance — a broken element is not treated as the empty state.
      assert.dom('[data-test-pet]').exists({ count: 1 });
      assert.dom('[data-test-add-new]').exists();

      // The broken slot keeps its remove affordance so the dead reference can be
      // cleared. `pets.1` is the broken slot (data-test-remove is index-based).
      await click('[data-test-remove="1"]');
      await waitUntil(
        () =>
          !document.querySelector('[data-test-broken-link-template]') &&
          document.querySelectorAll('[data-test-pet]').length === 1,
      );

      assert
        .dom('[data-test-broken-link-template]')
        .doesNotExist('removing clears the broken reference');
      assert
        .dom('[data-test-pet]')
        .exists(
          { count: 1 },
          'the healthy sibling is untouched by the removal',
        );
    });

    test('editing a sibling field while a broken element is present does not tear down the present element', async function (assert) {
      await setupRealm();
      let person = await createPerson({
        'pets.0': { links: { self: MANGO_URL } },
        'pets.1': { links: { self: GHOST_URL } },
      });

      await renderCard(loader, person, 'edit');
      // Wait until both slots have settled: the broken one shows the placeholder
      // and the healthy one has finished its lazy load and rendered its card.
      // In edit format the per-item hook is the `<li data-test-item>` wrapper.
      await waitFor('[data-test-broken-link-template]');
      await waitFor('[data-test-item="0"] [data-test-pet]');

      // Capture the present element's rendered DOM node. If the list
      // re-rendered unstably when an unrelated field mutates, Glimmer would tear
      // this node down and the identity check below would fail — the same class
      // of churn that steals focus from an input mid-edit.
      let presentNodeBefore = document.querySelector(
        '[data-test-item="0"] [data-test-pet]',
      );
      assert.dom(presentNodeBefore).hasText('Mango');

      // Mutating the sibling `firstName` bumps the card-tracking tag, re-running
      // the whole edit form (including the pets list).
      await fillIn('[data-test-name-field] input', 'Hassan A.');

      let presentNodeAfter = document.querySelector(
        '[data-test-item="0"] [data-test-pet]',
      );
      assert.strictEqual(
        presentNodeBefore,
        presentNodeAfter,
        'the present element keeps its DOM identity across an unrelated re-render — the list is stable',
      );
      assert
        .dom('[data-test-broken-link-template]')
        .exists({ count: 1 }, 'the broken placeholder is still in place');
    });
  },
);
