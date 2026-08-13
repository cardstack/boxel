import { click, render, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  CardCrudFunctionsContextName,
  PermissionsContextName,
  type LooseCardResource,
  type Permissions,
  type SerializedError,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import CardRenderer from '@cardstack/host/components/card-renderer';

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
import { renderCard, renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

const GHOST_URL = `${testRealmURL}Pet/ghost`;

const rpCardsSource = `
  import {
    CardDef,
    Component,
    contains,
    field,
    linksTo,
    linksToMany,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Pet extends CardDef {
    static displayName = 'Pet';
    @field firstName = contains(StringField);
    static embedded = class extends Component<typeof Pet> {
      <template><span data-test-rp-pet-name><@fields.firstName /></span></template>
    };
  }

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    @field pet = linksTo(Pet);
    @field pets = linksToMany(Pet);
    static isolated = class extends Component<typeof Person> {
      <template>
        <section data-test-slot='fitted'><@fields.pet @format='fitted' /></section>
        <section data-test-slot='embedded'><@fields.pet @format='embedded' /></section>
        <section data-test-slot='atom'><@fields.pet @format='atom' /></section>
        <section data-test-slot='isolated'><@fields.pet @format='isolated' /></section>
        <section data-test-pets-slot><@fields.pets @format='embedded' /></section>
      </template>
    };
  }
`;

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
  module = 'test-cards',
): Promise<CardDefType> {
  let store = getService('store');
  let resource: LooseCardResource = {
    attributes: { firstName: 'Hassan' },
    relationships,
    meta: { adoptsFrom: { module: testRRI(module), name: 'Person' } },
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
      async () => await loader.import('@cardstack/base/card-api'),
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

    test('the RP preserves trusted Base placeholders inside an authored card', async function (assert) {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: { 'rp-test-cards.gts': rpCardsSource },
      });
      let person = await createPerson(
        {
          pet: { links: { self: GHOST_URL } },
        },
        'rp-test-cards',
      );

      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <CardRenderer
              @card={{person}}
              @format='isolated'
              @execution='auto'
            />
          </template>
        },
      );
      await waitFor('[data-boxel-execution]', { timeout: 10000 });
      await waitFor('[data-test-broken-link-template]');

      assert
        .dom('[data-boxel-execution]')
        .hasAttribute(
          'data-boxel-execution',
          'capsule',
          'the authored parent stays inside the Capsule',
        );
      for (let format of ['fitted', 'embedded', 'atom', 'isolated']) {
        assert
          .dom(
            `[data-test-slot='${format}'] [data-test-broken-link-template='${format}']`,
          )
          .exists(`trusted Base owns the ${format} failure presentation`);
      }
    });

    test('the RP replaces one live linksToMany member with a trusted placeholder without disturbing its sibling', async function (assert) {
      let ringoURL = `${testRealmURL}Pet/ringo`;
      let mangoURL = `${testRealmURL}Pet/mango`;
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'rp-test-cards.gts': rpCardsSource,
          'Pet/ringo.json': {
            data: {
              attributes: { firstName: 'Ringo' },
              meta: {
                adoptsFrom: {
                  module: testRRI('rp-test-cards'),
                  name: 'Pet',
                },
              },
            },
          },
          'Pet/mango.json': {
            data: {
              attributes: { firstName: 'Mango' },
              meta: {
                adoptsFrom: {
                  module: testRRI('rp-test-cards'),
                  name: 'Pet',
                },
              },
            },
          },
        },
      });
      let person = await createPerson(
        {
          'pets.0': { links: { self: ringoURL } },
          'pets.1': { links: { self: mangoURL } },
        },
        'rp-test-cards',
      );

      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <CardRenderer
              @card={{person}}
              @format='isolated'
              @execution='auto'
            />
          </template>
        },
      );
      await waitFor('[data-test-rp-pet-name]', { count: 2, timeout: 10000 });

      let api = (await loader.import(
        '@cardstack/base/card-api',
      )) as typeof import('@cardstack/base/card-api');
      api.notifyLinksToTargetDeleted(person, ringoURL);
      await waitFor('[data-test-pets-slot] [data-test-broken-link-template]', {
        timeout: 10000,
      });

      assert
        .dom('[data-test-pets-slot] [data-test-broken-link-template]')
        .exists('the deleted member becomes the trusted warning');
      assert
        .dom('[data-test-pets-slot] [data-test-broken-link-url]')
        .hasText(ringoURL, 'the warning retains the deleted reference');
      assert
        .dom('[data-test-pets-slot] [data-test-rp-pet-name]')
        .hasText('Mango', 'the present sibling remains rendered through RP');
    });

    test('the reveal overlay is non-linking and offers copy + "Open anyway"', async function (assert) {
      await setupRealm();

      // viewCard is normally provided by the host per-submode; a stub records
      // where "Open anyway" tries to navigate.
      let opened: string[] = [];
      provideConsumeContext(CardCrudFunctionsContextName, {
        createCard: () => {},
        saveCard: () => {},
        editCard: () => {},
        deleteCard: async () => {},
        viewCard: (cardOrURL: URL | { id: string } | string) => {
          opened.push(
            cardOrURL instanceof URL ? cardOrURL.href : String(cardOrURL),
          );
        },
      });

      let person = await createPerson({
        pet: { links: { self: GHOST_URL } },
      });

      await renderCard(loader, person, 'isolated');
      await waitFor('[data-test-broken-link-template]');

      // The broken reference is informational only — never a clickable anchor.
      assert
        .dom('a[data-test-broken-link-url]')
        .doesNotExist('the broken URL is rendered as text, not a link');

      let embedded = `[data-test-slot='embedded']`;
      await click(`${embedded} [data-test-broken-link-reveal]`);
      assert
        .dom(`${embedded} [data-test-broken-link-copy]`)
        .exists(
          'the overlay offers a copy-to-clipboard affordance for the URL',
        );
      assert
        .dom(`${embedded} [data-test-broken-link-open-anyway]`)
        .exists('the overlay offers an "Open anyway" affordance');

      await click(`${embedded} [data-test-broken-link-open-anyway]`);
      assert.deepEqual(
        opened,
        [GHOST_URL],
        '"Open anyway" navigates to the broken reference via viewCard',
      );
    });

    test('"Open anyway" is withheld for a non-http(s) reference', async function (assert) {
      await setupRealm();
      provideConsumeContext(CardCrudFunctionsContextName, {
        createCard: () => {},
        saveCard: () => {},
        editCard: () => {},
        deleteCard: async () => {},
        viewCard: () => {},
      });

      // A corrupted realm could ship a non-http reference; the placeholder still
      // renders it as text, but the navigate affordance must never forward a
      // javascript:/data: URL into viewCard.
      let person = await createPerson({});
      getDataBucket(person).set('pet', {
        type: 'link-error',
        reference: 'javascript:alert(1)',
        errorDoc: {
          status: 500,
          title: 'Internal Server Error',
          message: 'boom',
          additionalErrors: null,
        } satisfies SerializedError,
      });

      await renderCard(loader, person, 'isolated');
      await waitFor('[data-test-broken-link-template]');

      let embedded = `[data-test-slot='embedded']`;
      await click(`${embedded} [data-test-broken-link-reveal]`);
      assert
        .dom(`${embedded} [data-test-broken-link-url]`)
        .hasText('javascript:alert(1)', 'the reference is still shown as text');
      assert
        .dom(`${embedded} [data-test-broken-link-open-anyway]`)
        .doesNotExist(
          'no "Open anyway" affordance for a non-navigable reference',
        );
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

      let api = await loader.import<typeof import('@cardstack/base/card-api')>(
        '@cardstack/base/card-api',
      );
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

    test('in edit format a broken link shows the placeholder plus a remove-only affordance', async function (assert) {
      await setupRealm();
      let person = await createPerson({
        pet: { links: { self: GHOST_URL } },
      });

      await renderCard(loader, person, 'edit');
      await waitFor('[data-test-broken-link-template]');

      // The broken state is distinguished from the empty state by the
      // placeholder: a never-set link shows only the bare "Link" button, while a
      // broken link surfaces the URL alongside a remove control. There is no
      // inline replace affordance — relinking routes through the not-set state.
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
        .doesNotExist(
          'the broken state offers no inline "Link" replace button',
        );

      // Removing the broken reference reverts to the not-set state, whose "Link"
      // button is the single entry point for adding a working replacement.
      await click('[data-test-remove-card]');
      assert
        .dom('[data-test-add-new="pet"]')
        .exists('the not-set state offers the "Link" affordance to relink')
        .hasText(
          'Link Pet',
          'the relink control is labelled for the field type',
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
