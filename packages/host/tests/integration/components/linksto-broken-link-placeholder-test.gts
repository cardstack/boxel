import { click, render, waitFor } from '@ember/test-helpers';

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
  linksTo,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const GHOST_URL = `${testRealmURL}Pet/ghost`;

// The cards are declared inside a helper rather than at module scope because the
// base-realm helpers (CardDef, field, …) are only populated once
// `setupBaseRealm` has run. The Person isolated template renders the same `pet`
// link in all four view formats so a single render exercises the whole
// placeholder format matrix; the edit template routes through LinksToEditor.
function makeCards() {
  // The `{{#if @model}}` guard keeps an unset link from rendering the card
  // chrome with an empty model, so "not-set renders nothing" can be asserted
  // literally; a present link renders the name.
  class Pet extends CardDef {
    static displayName = 'Pet';
    @field firstName = contains(StringField);
    static fitted = class extends Component<typeof Pet> {
      <template>
        {{#if @model}}<span data-test-pet>{{@model.firstName}}</span>{{/if}}
      </template>
    };
    static embedded = class extends Component<typeof Pet> {
      <template>
        {{#if @model}}<span data-test-pet>{{@model.firstName}}</span>{{/if}}
      </template>
    };
    static atom = class extends Component<typeof Pet> {
      <template>
        {{#if @model}}<span data-test-pet>{{@model.firstName}}</span>{{/if}}
      </template>
    };
    static isolated = class extends Component<typeof Pet> {
      <template>
        {{#if @model}}<span data-test-pet>{{@model.firstName}}</span>{{/if}}
      </template>
    };
  }
  class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    @field pet = linksTo(Pet);
    static isolated = class extends Component<typeof Person> {
      <template>
        <section data-test-slot='fitted'><@fields.pet
            @format='fitted'
          /></section>
        <section data-test-slot='embedded'><@fields.pet
            @format='embedded'
          /></section>
        <section data-test-slot='atom'><@fields.pet @format='atom' /></section>
        <section data-test-slot='isolated'><@fields.pet
            @format='isolated'
          /></section>
      </template>
    };
    static edit = class extends Component<typeof Person> {
      <template><@fields.pet /></template>
    };
  }
  return { Person, Pet };
}

// Drive a real lazy-load failure: the realm never holds `Pet/ghost`, so reading
// the link 404s and the producer plants a `link-not-found` sentinel.
async function createPerson(
  relationships: LooseCardResource['relationships'],
): Promise<CardDefType> {
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
  )) as CardDefType;
}

let loader: Loader;

module(
  'Integration | linksTo broken-link placeholder (singular)',
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

    // Realm holds Person/Pet plus one real Pet (`Pet/mango`); `Pet/ghost` is
    // never present, so links to it resolve to a 404.
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
        },
      });
    }

    test('a broken (404) link renders the placeholder in every view format', async function (assert) {
      await setupRealm();
      let person = await createPerson({
        pet: { links: { self: GHOST_URL } },
      });

      await renderCard(loader, person, 'isolated');
      await waitFor('[data-test-broken-link-template]');

      for (let format of ['fitted', 'embedded', 'atom', 'isolated']) {
        let slot = `[data-test-slot='${format}']`;
        assert
          .dom(`${slot} [data-test-broken-link-template='${format}']`)
          .exists(`placeholder renders in ${format} format`);
        assert
          .dom(`${slot} [data-test-broken-link-state]`)
          .hasAttribute(
            'data-test-broken-link-state',
            'not-found',
            `${format} placeholder reports the not-found state`,
          );
        assert
          .dom(`${slot} [data-test-broken-link-url]`)
          .hasText(GHOST_URL, `${format} placeholder shows the broken URL`);
        assert
          .dom(`${slot} [data-test-pet]`)
          .doesNotExist(`${format} slot does not render a card`);
      }
    });

    test('a link-error sentinel renders the error placeholder with its message', async function (assert) {
      await setupRealm();
      let person = await createPerson({});
      // A non-404 failure surfaces as `link-error`; hand-plant it so the test
      // does not depend on a flaky upstream 500.
      getDataBucket(person).set('pet', {
        type: 'link-error',
        reference: `${testRealmURL}Pet/exploded`,
        errorDoc: {
          status: 500,
          title: 'Internal Server Error',
          message: 'upstream exploded',
          additionalErrors: null,
        } satisfies SerializedError,
      });

      await renderCard(loader, person, 'isolated');
      await waitFor('[data-test-broken-link-template]');

      assert
        .dom(`[data-test-slot='embedded'] [data-test-broken-link-state]`)
        .hasAttribute('data-test-broken-link-state', 'error');
      assert
        .dom(`[data-test-slot='embedded'] [data-test-broken-link-url]`)
        .hasText(`${testRealmURL}Pet/exploded`);
      assert
        .dom(`[data-test-slot='embedded'] [data-test-broken-link-message]`)
        .hasText('upstream exploded');
    });

    test('a present link renders the card, not the placeholder', async function (assert) {
      await setupRealm();
      let person = await createPerson({
        pet: { links: { self: `${testRealmURL}Pet/mango` } },
      });

      await renderCard(loader, person, 'isolated');
      await waitFor(`[data-test-slot='fitted'] [data-test-pet]`);

      assert
        .dom(`[data-test-slot='fitted'] [data-test-pet]`)
        .hasText('Mango', 'the linked card renders normally');
      assert
        .dom('[data-test-broken-link-template]')
        .doesNotExist('no placeholder for a healthy link');
    });

    test('an unset link renders nothing — neither card nor placeholder', async function (assert) {
      await setupRealm();
      let person = await createPerson({});

      await renderCard(loader, person, 'isolated');

      assert
        .dom('[data-test-broken-link-template]')
        .doesNotExist('not-set does not render a placeholder');
      assert
        .dom('[data-test-pet]')
        .doesNotExist('not-set does not render a card');
    });

    test('a broken link converges in at most two renders', async function (assert) {
      await setupRealm();
      let person = await createPerson({
        pet: { links: { self: GHOST_URL } },
      });

      let api = await loader.import<
        typeof import('https://cardstack.com/base/card-api')
      >(`${baseRealm.url}card-api`);
      let PersonComponent = api.getComponent(person);

      let renderCount = 0;
      // Reading `pet` here entangles the counter with the same card-tracking
      // tag the placeholder subtree consumes, so `bump` re-runs on exactly the
      // invalidation that swaps not-loaded → not-found.
      let bump = () => {
        renderCount++;
        void (person as unknown as { pet: unknown }).pet;
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
        `a permanently-broken linksTo converged in ${renderCount} render(s) (initial + post-lazy-load)`,
      );
    });

    test('in edit format a broken link shows the placeholder plus remove and replace affordances', async function (assert) {
      await setupRealm();
      let person = await createPerson({
        pet: { links: { self: GHOST_URL } },
      });

      await renderCard(loader, person, 'edit');
      await waitFor('[data-test-broken-link-template]');

      // The broken state is distinguished from the empty state by the
      // placeholder: a never-set link shows only the bare "Link" button, while a
      // broken link surfaces the URL alongside remove (clear) and replace (swap)
      // controls.
      assert
        .dom('[data-test-broken-link-template]')
        .exists('editor shows the broken-link placeholder');
      assert
        .dom('[data-test-broken-link-url]')
        .hasText(GHOST_URL, 'editor placeholder shows the broken URL');
      assert
        .dom('[data-test-remove-card]')
        .exists('editor offers a remove affordance for the broken reference');
      assert
        .dom('[data-test-add-new="pet"]')
        .exists('editor offers a "Link" affordance to replace the broken link')
        .hasText(
          'Link Pet',
          'the replace control is labelled for the field type',
        );
    });

    test('removing a broken link reverts the slot to the empty "Link" affordance', async function (assert) {
      await setupRealm();
      let person = await createPerson({
        pet: { links: { self: GHOST_URL } },
      });

      await renderCard(loader, person, 'edit');
      await waitFor('[data-test-broken-link-template]');

      await click('[data-test-remove-card]');

      assert
        .dom('[data-test-broken-link-template]')
        .doesNotExist('removing clears the broken reference');
      assert
        .dom('[data-test-add-new="pet"]')
        .exists('the slot reverts to the empty "Link" affordance');
      assert
        .dom('[data-test-remove-card]')
        .doesNotExist('the empty state has nothing to remove');
    });

    test('a read-only broken link shows the placeholder without remove or replace controls', async function (assert) {
      // Override the writable permissions the module installs by default.
      let permissions: Permissions = { canWrite: false, canRead: true };
      provideConsumeContext(PermissionsContextName, permissions);

      await setupRealm();
      let person = await createPerson({
        pet: { links: { self: GHOST_URL } },
      });

      await renderCard(loader, person, 'edit');
      await waitFor('[data-test-broken-link-template]');

      assert
        .dom('[data-test-broken-link-url]')
        .hasText(GHOST_URL, 'read-only editor still surfaces the broken URL');
      assert
        .dom('[data-test-remove-card]')
        .doesNotExist('a read-only broken link cannot be removed');
      assert
        .dom('[data-test-add-new="pet"]')
        .doesNotExist('a read-only broken link cannot be replaced');
    });
  },
);
