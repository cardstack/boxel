import {
  type RenderingTestContext,
  blur,
  fillIn,
  render,
  waitUntil,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { provide } from 'ember-provide-consume-context';
import { module, test } from 'qunit';

import {
  CardContextName,
  GetCardContextName,
  GetCardCollectionContextName,
  GetCardsContextName,
  type Loader,
} from '@cardstack/runtime-common';

import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type StoreService from '@cardstack/host/services/store';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  StringField,
  contains,
  field,
  Workspace,
  setupBaseRealm,
  setupWorkspaceCard,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type {
  CardDef as CardDefInstance,
  Format,
} from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

// `getComponent` returns an unparameterised ComponentLike; name the one argument
// these tests pass so the wrapper templates below type-check.
type CardComponent = ComponentLike<{ Args: { format?: Format } }>;

// The Workspace chrome updates several surfaces on its own — search results
// appear, setup jobs advance — with no interaction to hang an announcement off.
// These cover the accessible names and status regions that carry those changes,
// and the operator-mode rule that hides the chrome on a buried card.
module('Integration | Card | workspace | accessibility', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupWorkspaceCard(hooks);

  let loader: Loader;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  async function componentFor(card: CardDefInstance): Promise<CardComponent> {
    let api = await loader.import<typeof import('@cardstack/base/card-api')>(
      '@cardstack/base/card-api',
    );
    return api.getComponent(card) as CardComponent;
  }

  test('the hotkey hint is decorative, and the shortcut is on the input', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');

    assert
      .dom('.search-box .search-kbd')
      .hasAttribute(
        'aria-hidden',
        'true',
        'the visible hint is not read out twice',
      );
    // Both spellings, because the binding accepts either modifier.
    assert
      .dom('.search-box .search-input')
      .hasAttribute('aria-keyshortcuts', 'Meta+K Control+K');
  });

  test('the hotkey hint matches the platform', async function (assert) {
    let ws = await loader.import<typeof import('@cardstack/base/workspace')>(
      '@cardstack/base/workspace',
    );
    await renderCard(loader, new Workspace({}), 'isolated');

    // Asserted against the label the module computed for this browser rather
    // than a hardcoded glyph, so the test reads the same on any platform.
    assert
      .dom('.search-box .search-kbd')
      .hasText(ws.searchHotkeyLabel(navigator.platform));
  });

  test('the search status region is present and silent before searching', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');

    // Present from the start: a live region only announces changes that happen
    // while it is already in the DOM.
    assert
      .dom('[data-test-search-announcement]')
      .exists('the status region is rendered up front')
      .hasAttribute('role', 'status')
      .hasNoText('nothing to announce before a term is typed');
  });

  test('a term typed with no realm to search stays silent, not a false no-match', async function (assert) {
    // renderCard supplies no card context, so `runSearch` never reaches a
    // realm: the search does not run. A search that never ran must not announce
    // "No matching cards" — that would report a real absence it never checked.
    await renderCard(loader, new Workspace({}), 'isolated');

    await fillIn('.search-box .search-input', 'anything');
    // Let the debounce fire and the task settle before asserting the negative.
    await waitUntil(() => true, { timeout: 300 });

    assert
      .dom('[data-test-search-announcement]')
      .hasNoText(
        'an unrun search says nothing rather than "No matching cards"',
      );
  });

  test('the search input is not a combobox: no aria-controls or aria-expanded', async function (assert) {
    // Results are click-only, so the input is a plain textbox. `aria-expanded`
    // is not honoured on that role and `aria-controls` would dangle whenever the
    // results list is absent; the status region carries the state instead.
    await renderCard(loader, new Workspace({}), 'isolated');

    assert
      .dom('.search-box .search-input')
      .doesNotHaveAttribute('aria-controls')
      .doesNotHaveAttribute('aria-expanded');
  });

  test('the progress region is present and silent with no running jobs', async function (assert) {
    await renderCard(loader, new Workspace({}), 'isolated');

    assert
      .dom('[data-test-progress-announcement]')
      .exists('rendered at the root, outside every segment')
      .hasAttribute('role', 'status')
      .hasNoText('nothing running, nothing to say');
  });

  test('the chrome is hidden on a buried operator-mode card', async function (assert) {
    let Comp = await componentFor(new Workspace({}));

    // The ancestors the host really renders: `.operator-mode` on the container
    // and `.buried` on a stack item that is not on top. The card's scoped CSS
    // only scopes the selector's last compound, so these match from outside it.
    await render(
      <template>
        <div class='operator-mode'>
          <div class='buried'>
            <Comp @format='isolated' />
          </div>
        </div>
      </template>,
    );

    assert
      .dom('.frame-actions')
      .exists('the search chrome is still rendered')
      .isNotVisible('but hidden while the card is buried');
  });

  test('the chrome is visible on a card that is not buried', async function (assert) {
    let Comp = await componentFor(new Workspace({}));

    await render(
      <template>
        <div class='operator-mode'>
          <div>
            <Comp @format='isolated' />
          </div>
        </div>
      </template>,
    );

    assert.dom('.frame-actions').isVisible('shown for the top card');
  });
});

// These exercise the search status region against a real realm, so the search
// actually runs and settles — the lightweight module above can only reach the
// no-realm path. The card `@context` (store + resolvers) is provided the way the
// host wires it, so `runSearch` resolves this space's realm and queries it.
class WorkspaceContext extends GlimmerComponent<{ Blocks: { default: [] } }> {
  @provide(GetCardContextName)
  get getCardFn() {
    return getCard;
  }
  @provide(GetCardsContextName)
  get getCardsFn() {
    let store = getService('store') as StoreService;
    return store.getSearchResource.bind(store);
  }
  @provide(GetCardCollectionContextName)
  get getCardCollectionFn() {
    return getCardCollection;
  }
  @provide(CardContextName)
  get cardContext() {
    let store = getService('store') as StoreService;
    return {
      store,
      getCard,
      getCards: store.getSearchResource.bind(store),
      getCardCollection,
    };
  }
  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

const WORKSPACE_URL = `${testRealmURL}space`;

function announcement(): string {
  return (
    document
      .querySelector('[data-test-search-announcement]')
      ?.textContent?.trim() ?? ''
  );
}

module(
  'Integration | Card | workspace | accessibility | live search',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupWorkspaceCard(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      class Book extends CardDef {
        static displayName = 'Book';
        @field title = contains(StringField);
      }
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          'book.gts': { Book },
          'books/1.json': new Book({ title: 'Mango' }),
          // A Workspace saved in the realm so it carries a realmURL, which is
          // the realm `runSearch` scopes its query to.
          'space.json': new Workspace({}),
        },
      });
      await getService('realm').login(testRealmURL);
    });

    async function renderWorkspace() {
      let loader = getService('loader-service').loader;
      let store = getService('store') as StoreService;
      let card = (await store.get(WORKSPACE_URL)) as CardDefInstance;
      let api = await loader.import<typeof import('@cardstack/base/card-api')>(
        '@cardstack/base/card-api',
      );
      let Comp = api.getComponent(card) as ComponentLike<{
        Args: { format?: Format };
      }>;
      await render(
        <template>
          <WorkspaceContext>
            <Comp @format='isolated' />
          </WorkspaceContext>
        </template>,
      );
      await waitUntil(() =>
        document.querySelector('.search-box .search-input'),
      );
    }

    test('a matching search announces a count, and blurring it falls silent', async function (assert) {
      await renderWorkspace();

      await fillIn('.search-box .search-input', 'Mango');
      await waitUntil(() => announcement() !== '', { timeout: 5000 });
      assert.strictEqual(
        announcement(),
        '1 result',
        'the settled count is announced',
      );

      // The regression: blur clears the dropdown but leaves the term. The region
      // must go silent (dismissed), not re-announce "No matching cards" for a
      // search that did match.
      await blur('.search-box .search-input');
      await waitUntil(() => announcement() === '', { timeout: 5000 });
      assert.strictEqual(
        announcement(),
        '',
        'a dismissed dropdown is silent, not a false no-match',
      );
    });

    test('a genuine no-match announces it, visually hidden', async function (assert) {
      await renderWorkspace();

      await fillIn('.search-box .search-input', 'zzz-no-such-card');
      await waitUntil(() => announcement() !== '', { timeout: 5000 });
      assert.strictEqual(announcement(), 'No matching cards');

      // `.boxel-sr-only` sits in `@layer utilities`, and this card's scoped CSS
      // is unlayered — so any scoped rule matching this span would win and put
      // the announcement on screen. Assert the hiding actually took effect.
      let region = document.querySelector(
        '[data-test-search-announcement]',
      ) as HTMLElement;
      assert.strictEqual(
        getComputedStyle(region).position,
        'absolute',
        'the announcement is visually hidden, not laid out',
      );
      assert.strictEqual(
        getComputedStyle(region).clipPath,
        'inset(50%)',
        'and clipped rather than merely offset',
      );
    });
  },
);
