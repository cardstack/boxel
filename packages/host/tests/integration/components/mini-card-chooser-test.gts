import type { TOC } from '@ember/component/template-only';
import {
  type RenderingTestContext,
  click,
  fillIn,
  render,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import {
  baseRealm,
  rri,
  CardContextName,
  GetCardContextName,
  GetCardCollectionContextName,
  GetCardsContextName,
} from '@cardstack/runtime-common';

import MiniCardChooser from '@cardstack/host/components/card-chooser/mini';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type RecentCardsService from '@cardstack/host/services/recent-cards-service';
import type StoreService from '@cardstack/host/services/store';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';

import { setupRenderingTest } from '../../helpers/setup';

// Sized envelope mirroring the chooser's intended hosting context (a narrow
// side panel, ~360×480). The chooser's layout is fluid (100% of parent), so
// every behavioral assertion below — single-line rows, show-more wrapping,
// the recents header sitting flush above its rows — only holds at a
// realistic width. Rendering unsized would let rows expand to the viewport
// and quietly mask layout regressions.
const DesignRatioContainer: TOC<{ Blocks: { default: [] } }> = <template>
  <div class='design-ratio-container' data-test-design-ratio-container>
    {{yield}}
  </div>
  <style scoped>
    .design-ratio-container {
      width: 360px;
      height: 480px;
      border: 1px solid var(--boxel-border-color, var(--boxel-300));
      border-radius: var(--boxel-border-radius);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
  </style>
</template>;

// Provides the contexts SearchContent reads via @consume so the
// chooser can render in isolation, without OperatorMode.
class HostContextProvider extends GlimmerComponent<{
  Blocks: { default: [] };
}> {
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
    return {};
  }

  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

module('Integration | mini-card-chooser', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  const noop = () => {};

  // The Book module path inside the test realm — referenced by the baseFilter
  // test below to scope results to the Book type only.
  const bookModule = `${testRealmURL}book`;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    class Book extends CardDef {
      static displayName = 'Book';
      @field title = contains(StringField);
    }
    class Movie extends CardDef {
      static displayName = 'Movie';
      @field title = contains(StringField);
    }
    // Overrides `fitted` with a distinctive marker so the uniform-rendering
    // test can prove the mini chooser rows use the CardDef-level fitted tile,
    // not this card's own fitted template.
    class Gadget extends CardDef {
      static displayName = 'Gadget';
      @field title = contains(StringField);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <div class='custom-gadget-fitted' data-test-custom-gadget-fitted>
            Custom Gadget Fitted:
            <@fields.title />
          </div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'book.gts': { Book },
        'movie.gts': { Movie },
        'gadget.gts': { Gadget },
        'books/mango.json': new Book({ title: 'Mango' }),
        'books/vincent.json': new Book({ title: 'Vincent' }),
        'movies/casablanca.json': new Movie({ title: 'Casablanca' }),
        'gadgets/atomizer.json': new Gadget({ title: 'Atomizer' }),
      },
    });
    await getService('realm').login(testRealmURL);
  });

  test('mounts in isolation with a search input and no filter chips, and renders the mini visual variant', async function (assert) {
    // Seed a recent so a row actually renders — without one, the empty state
    // has nothing to click and the design assertions (no show-only, no view
    // picker) verify the negative case but the screenshot for manual diff
    // would be blank.
    let recent = getService('recent-cards-service') as RecentCardsService;
    recent.add(`${testRealmURL}books/mango`);

    // Round-trip the selection: clicking a row fires onSelect, which sets
    // tracked state, which feeds back into @selected so the row visibly
    // highlights. Mirrors what a real consumer (hosting container) does.
    class SelectionHarness {
      @tracked selected: string | undefined = undefined;
      onSelect = (url: string) => {
        this.selected = url;
      };
    }
    const harness = new SelectionHarness();

    await render(
      <template>
        <DesignRatioContainer>
          <HostContextProvider>
            <MiniCardChooser
              @onSelect={{harness.onSelect}}
              @selected={{harness.selected}}
            />
          </HostContextProvider>
        </DesignRatioContainer>
      </template>,
    );

    await waitFor('[data-test-mini-card-chooser] [data-test-search-field]');

    assert
      .dom('[data-test-mini-card-chooser]')
      .exists('the mini chooser mounts in isolation');
    assert
      .dom('[data-test-mini-card-chooser] [data-test-search-field]')
      .exists('the search input is rendered');
    // The realm/type chips are deliberately suppressed in the mini variant.
    assert
      .dom('[data-test-mini-card-chooser] .search-sheet__search-bar-picker')
      .doesNotExist('realm/type filter chips are hidden in the mini variant');
    // The grid/strip view-mode picker is suppressed; the Sort dropdown stays.
    assert
      .dom('[data-test-search-result-header] .view-options-label')
      .doesNotExist('view-mode picker is hidden under the mini variant');
    // The per-section show-only toggle is gated off.
    assert
      .dom('[data-test-mini-card-chooser] [data-test-search-sheet-show-only]')
      .doesNotExist('show-only toggle is suppressed in the mini variant');

    // Type a token that the seeded fixtures share — `a` matches Mango,
    // Casablanca, and (via the Vincent display name) any card whose
    // title or type label contains an "a". This proves the search wire
    // is live and gives us every visible row to iterate over.
    await fillIn('[data-test-mini-card-chooser] [data-test-search-field]', 'a');
    await waitFor('[data-test-mini-card-chooser] [data-test-item-button]', {
      timeout: 5000,
    });

    // The results header carries the "Searching…"/count indicator and lives
    // inside the same scroll container as the rows, so it must be sticky to
    // stay visible while the list scrolls.
    const resultHeader = document.querySelector(
      '[data-test-mini-card-chooser] [data-test-search-result-header]',
    );
    assert.ok(
      resultHeader,
      'the results header is rendered once search is live',
    );
    assert.strictEqual(
      getComputedStyle(resultHeader!).position,
      'sticky',
      'the results header sticks so the Searching…/count indicator stays visible while scrolling',
    );

    // Capture the URL of every visible row, then click each in turn and
    // assert that exactly that row carries the selected marker.
    const buttonEls = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-test-mini-card-chooser] [data-test-item-button]',
      ),
    );
    const urls = buttonEls
      .map((el) => el.getAttribute('data-test-item-button'))
      .filter((u): u is string => Boolean(u));

    assert.ok(
      urls.length > 0,
      `at least one row matches "a" (saw ${urls.length})`,
    );

    for (const url of urls) {
      await click(
        `[data-test-mini-card-chooser] [data-test-item-button="${url}"]`,
      );
      await waitUntil(() => harness.selected === url);

      // The clicked row carries the selected marker…
      assert
        .dom(
          `[data-test-mini-card-chooser] [data-test-item-button="${url}"][data-test-item-button-selected="true"]`,
        )
        .exists(`row ${url} highlights after click`);
      // …and the visible checkmark icon lands inside it (the mini
      // variant's @showSelectedCheckmark path).
      assert
        .dom(
          `[data-test-mini-card-chooser] [data-test-item-button="${url}"] [data-test-item-button-selected-checkmark]`,
        )
        .exists(`row ${url} shows the CheckMark icon`);
      // …and no other row is marked selected at the same time.
      assert
        .dom(
          '[data-test-mini-card-chooser] [data-test-item-button-selected="true"]',
        )
        .exists({ count: 1 }, `exactly one row selected after clicking ${url}`);
    }
  });

  test('shows recents in the empty state, and selecting one fires onSelect with the canonical URL', async function (assert) {
    let recent = getService('recent-cards-service') as RecentCardsService;
    recent.add(`${testRealmURL}books/mango`);

    const selections: string[] = [];
    const onSelect = (url: string) => selections.push(url);

    await render(
      <template>
        <DesignRatioContainer>
          <HostContextProvider>
            <MiniCardChooser @onSelect={{onSelect}} />
          </HostContextProvider>
        </DesignRatioContainer>
      </template>,
    );

    const cardUrl = `${testRealmURL}books/mango`;
    await waitFor(
      `[data-test-mini-card-chooser] [data-section-sid="recents"] [data-test-item-button="${cardUrl}"]`,
      { timeout: 5000 },
    );

    // The wrapper carries the mini modifier class so the scoped CSS applies.
    assert
      .dom('[data-test-mini-card-chooser] .search-result-block--mini')
      .exists('section wrapper carries the mini modifier class');

    await click(
      `[data-test-mini-card-chooser] [data-test-item-button="${cardUrl}"]`,
    );

    await waitUntil(() => selections.length > 0);
    assert.deepEqual(
      selections,
      [cardUrl],
      'onSelect receives the canonical URL exactly once (no .json suffix)',
    );
  });

  test('typing in the search input renders matching results from the realm', async function (assert) {
    await render(
      <template>
        <DesignRatioContainer>
          <HostContextProvider>
            <MiniCardChooser @onSelect={{noop}} />
          </HostContextProvider>
        </DesignRatioContainer>
      </template>,
    );

    await waitFor('[data-test-mini-card-chooser] [data-test-search-field]');

    const vincent = `${testRealmURL}books/vincent`;
    const mango = `${testRealmURL}books/mango`;

    await fillIn(
      '[data-test-mini-card-chooser] [data-test-search-field]',
      'Vincent',
    );
    await waitFor(
      `[data-test-mini-card-chooser] [data-test-item-button="${vincent}"]`,
      { timeout: 5000 },
    );

    assert
      .dom(`[data-test-mini-card-chooser] [data-test-item-button="${vincent}"]`)
      .exists('the matching card surfaces');
    assert
      .dom(`[data-test-mini-card-chooser] [data-test-item-button="${mango}"]`)
      .doesNotExist('non-matching cards are filtered out');
  });

  test('baseFilter narrows results to the requested card type', async function (assert) {
    const bookFilter = { type: { module: rri(bookModule), name: 'Book' } };

    await render(
      <template>
        <DesignRatioContainer>
          <HostContextProvider>
            <MiniCardChooser @onSelect={{noop}} @baseFilter={{bookFilter}} />
          </HostContextProvider>
        </DesignRatioContainer>
      </template>,
    );

    const mango = `${testRealmURL}books/mango`;
    const vincent = `${testRealmURL}books/vincent`;
    const casablanca = `${testRealmURL}movies/casablanca`;

    await waitFor(
      `[data-test-mini-card-chooser] [data-test-item-button="${mango}"]`,
      { timeout: 5000 },
    );

    assert
      .dom(`[data-test-mini-card-chooser] [data-test-item-button="${mango}"]`)
      .exists('Book-type cards are included under a Book baseFilter');
    assert
      .dom(`[data-test-mini-card-chooser] [data-test-item-button="${vincent}"]`)
      .exists('all Book-type cards surface');
    assert
      .dom(
        `[data-test-mini-card-chooser] [data-test-item-button="${casablanca}"]`,
      )
      .doesNotExist('Movie-type cards are excluded by a Book baseFilter');
  });

  test('rows render the uniform CardDef fitted tile, not each card’s own template', async function (assert) {
    const gadget = `${testRealmURL}gadgets/atomizer`;

    const selections: string[] = [];
    const onSelect = (url: string) => selections.push(url);

    await render(
      <template>
        <DesignRatioContainer>
          <HostContextProvider>
            <MiniCardChooser @onSelect={{onSelect}} />
          </HostContextProvider>
        </DesignRatioContainer>
      </template>,
    );

    await waitFor('[data-test-mini-card-chooser] [data-test-search-field]');
    await fillIn(
      '[data-test-mini-card-chooser] [data-test-search-field]',
      'Atomizer',
    );
    await waitFor(
      `[data-test-mini-card-chooser] [data-test-item-button="${gadget}"]`,
      { timeout: 5000 },
    );

    // The row renders CardDef's default fitted template (served from the
    // per-ancestor fitted index at renderType CardDef)…
    assert
      .dom(
        `[data-test-mini-card-chooser] [data-test-item-button="${gadget}"] .fitted-template`,
      )
      .exists('the row renders the uniform CardDef fitted tile');
    // …and not the Gadget's own fitted template.
    assert
      .dom(
        `[data-test-mini-card-chooser] [data-test-item-button="${gadget}"] [data-test-custom-gadget-fitted]`,
      )
      .doesNotExist(
        'the card’s own fitted template does not leak into the row',
      );

    // Selection still works from an ancestor-rendered row.
    await click(
      `[data-test-mini-card-chooser] [data-test-item-button="${gadget}"]`,
    );
    await waitUntil(() => selections.length > 0);
    assert.deepEqual(
      selections,
      [gadget],
      'clicking an ancestor-rendered row fires onSelect with the canonical URL',
    );
  });
});
