import { click, settled, waitFor } from '@ember/test-helpers';

import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import { CardLink } from '@cardstack/base/card-link';
import StringField from '@cardstack/base/string';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  CardContextName,
  CardCrudFunctionsContextName,
  PermissionsContextName,
  type LooseCardResource,
  type Permissions,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import ElementTracker from '@cardstack/host/resources/element-tracker';

import {
  provideConsumeContext,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const MANGO_URL = `${testRealmURL}Pet/mango`;
const INTERACTIONS = ['open', 'self', 'chrome', 'none'] as const;

function makeCards() {
  class Pet extends CardDef {
    static displayName = 'Pet';
    @field firstName = contains(StringField);
    static embedded = class extends Component<typeof Pet> {
      <template>
        <span data-test-pet>{{@model.firstName}}</span>
      </template>
    };
  }
  class Person extends CardDef {
    static displayName = 'Person';
    @field pet = linksTo(Pet);
    static isolated = class extends Component<typeof Person> {
      <template>
        <section data-test-slot='open'><@fields.pet
            @format='embedded'
          /></section>
        <section data-test-slot='self'><@fields.pet
            @format='embedded'
            @interactions='self'
          /></section>
        <section data-test-slot='chrome'><@fields.pet
            @format='embedded'
            @interactions='chrome'
          /></section>
        <section data-test-slot='none'><@fields.pet
            @format='embedded'
            @interactions='none'
          /></section>
        <CardLink @field='pet' data-test-link='field'>Pet</CardLink>
        <CardLink @path='/journal' data-test-link='path'>Journal</CardLink>
      </template>
    };
  }
  return { Person, Pet };
}

module('Integration | CardLink and @interactions', function (hooks) {
  let loader: Loader;

  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  // A followed link would navigate the test page away. Each link's own
  // handler runs first, so it still sees an unhandled click.
  let keepPage = (event: Event) => event.preventDefault();
  hooks.beforeEach(function () {
    document.addEventListener('click', keepPage);
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    loader = getService('loader-service').loader;
  });
  hooks.afterEach(function () {
    document.removeEventListener('click', keepPage);
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  async function personWithPet(): Promise<CardDef> {
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
    let store = getService('store');
    let resource: LooseCardResource = {
      attributes: {},
      relationships: { pet: { links: { self: MANGO_URL } } },
      meta: { adoptsFrom: { module: testRRI('test-cards'), name: 'Person' } },
    };
    return (await store.__dangerousCreateFromSerialized(
      resource,
      { data: resource },
      new URL(testRealmURL),
    )) as CardDef;
  }

  function crud(overrides: Record<string, unknown>) {
    provideConsumeContext(CardCrudFunctionsContextName, {
      createCard: () => {},
      saveCard: () => {},
      editCard: () => {},
      deleteCard: async () => {},
      ...overrides,
    });
  }

  test('outside the app, only a linked card that opens gets a link over it', async function (assert) {
    let person = await personWithPet();
    await renderCard(loader, person, 'isolated');
    await waitFor('[data-test-slot="none"] [data-test-pet]');

    for (let interactions of INTERACTIONS) {
      let slot = `[data-test-slot="${interactions}"]`;
      assert
        .dom(`${slot} [data-test-pet]`)
        .hasText('Mango', `'${interactions}' still renders the card`);
      let cover = `${slot} a[data-boxel-card-link="${MANGO_URL}"]`;
      if (interactions === 'open') {
        assert
          .dom(cover)
          .hasAttribute('href', MANGO_URL, `'open' links to the card`);
      } else {
        assert.dom(cover).doesNotExist(`'${interactions}' draws no link`);
      }
    }
  });

  test('in the app, the environment tracks every linked card but one nobody owns', async function (assert) {
    let tracker = new ElementTracker();
    provideConsumeContext(CardContextName, {
      mode: 'operator',
      cardComponentModifier: tracker.trackElement,
    });
    let person = await personWithPet();
    await renderCard(loader, person, 'isolated');
    await waitFor('[data-test-slot="none"] [data-test-pet]');
    await settled();

    let tracked = (interactions: string) =>
      tracker.elements.filter(
        ({ element, meta }) =>
          meta.fieldName === 'pet' &&
          element.closest(`[data-test-slot="${interactions}"]`),
      );
    for (let interactions of ['open', 'self', 'chrome'] as const) {
      let entries = tracked(interactions);
      assert.strictEqual(
        entries.length,
        1,
        `'${interactions}' is tracked, so the app outlines it`,
      );
      let owner = entries[0]?.meta.interactions;
      assert.strictEqual(
        owner === undefined ? 'open' : owner,
        interactions,
        `the app knows who owns a click on '${interactions}'`,
      );
    }
    assert.strictEqual(tracked('none').length, 0, `'none' is not tracked`);
    assert
      .dom('[data-test-slot] a[data-boxel-card-link]')
      .doesNotExist('the app opens linked cards with its own click');
  });

  test('with no environment, a CardLink is a plain link to the card or path', async function (assert) {
    let person = await personWithPet();
    await renderCard(loader, person, 'isolated');
    await waitFor('[data-test-link="field"]');

    assert
      .dom('[data-test-link="field"]')
      .hasAttribute('href', MANGO_URL)
      .hasAttribute('data-boxel-card-link', MANGO_URL);
    assert
      .dom('[data-test-link="path"]')
      .hasAttribute('href', '/journal')
      .hasAttribute('data-boxel-card-link', '/journal');
  });

  test('on a published site, a CardLink is the site address and navigates the site', async function (assert) {
    let navigated: unknown[] = [];
    let viewed: unknown[] = [];
    crud({
      hrefFor: (target: { card?: string; path?: string }) =>
        target.card ? '/pets/mango' : `/site${target.path}`,
      navigateTo: (target: unknown) => navigated.push(target),
      viewCard: (card: unknown) => viewed.push(card),
    });
    let person = await personWithPet();
    await renderCard(loader, person, 'isolated');
    await waitFor('[data-test-link="field"]');

    assert.dom('[data-test-link="field"]').hasAttribute('href', '/pets/mango');
    assert.dom('[data-test-link="path"]').hasAttribute('href', '/site/journal');

    await click('[data-test-link="field"]');
    await click('[data-test-link="path"]');
    assert.deepEqual(
      navigated,
      [{ card: MANGO_URL }, { path: '/journal' }],
      'a click navigates the site to the card or path',
    );

    await click('[data-test-link="field"]', { metaKey: true });
    assert.strictEqual(
      navigated.length,
      2,
      'a modified click is left to the browser, for a new tab',
    );
    assert.deepEqual(viewed, [], 'the site never opens a card in place');
  });

  test('in interact and code mode, a CardLink opens the card the way the mode does', async function (assert) {
    let viewed: unknown[][] = [];
    crud({
      viewCard: (card: unknown, format: unknown, opts: unknown) =>
        viewed.push([card, format, opts]),
    });
    let person = await personWithPet();
    await renderCard(loader, person, 'isolated');
    await waitFor('[data-test-link="field"]');

    assert
      .dom('[data-test-link="field"]')
      .hasAttribute('href', MANGO_URL, 'the link is still a real address');
    await click('[data-test-link="field"]');
    assert.deepEqual(
      viewed,
      [
        [
          MANGO_URL,
          'isolated',
          { openCardInRightMostStack: false, overlay: undefined },
        ],
      ],
      'a click opens the card through the mode’s viewCard',
    );

    await click('[data-test-link="path"]');
    assert.strictEqual(
      viewed.length,
      1,
      'a path link has no card to open, so the browser follows it',
    );
  });
});
