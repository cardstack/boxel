import type { TOC } from '@ember/component/template-only';
import type Owner from '@ember/owner';
import { click, triggerEvent } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  CardContextName,
  type Loader,
  type RenderableSearchEntryLike,
  type SearchEntryWireQuery,
  type SearchResultsComponentSignature,
} from '@cardstack/runtime-common';

import {
  provideConsumeContext,
  saveCard,
  testRealmURL,
} from '@cardstack/host/tests/helpers';
import {
  CardDef,
  setupBaseRealm,
} from '@cardstack/host/tests/helpers/base-realm';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { setupRenderingTest } from '@cardstack/host/tests/helpers/setup';

import { FrameSettingsField, PosterBoard } from './poster-board';

import type { CardContext } from 'https://cardstack.com/base/card-api';

// This file is type-checked by two projects: experiments-realm's (which never
// loads host's service-registry augmentations, so `getService` returns a bare
// object) and host's (which loads the real `LoaderService` registry entry). A
// registry augmentation here would conflict with host's, so cast structurally
// to just the member these tests use — `Loader` is the real type, so
// downstream `saveCard` / `loader.import` calls check for real.
function loaderService(): { loader: Loader } {
  return getService('loader-service') as unknown as { loader: Loader };
}

// The board renders its tiles through `@context.searchResultsComponent`, which
// only the host app provides (operator mode / index / prerender routes). The
// stub below stands in for it: it captures each query the board issues and
// yields a test-controlled entry set, so tile mapping and fallbacks are
// exercised deterministically without a live prerender index.
let stubEntries: RenderableSearchEntryLike[] = [];
let capturedQueries: (SearchEntryWireQuery | undefined)[] = [];

function stubEntry(id: string): RenderableSearchEntryLike {
  // The board stamps its content class through `...attributes`, the same way
  // it lands on real prerendered HTML's root element.
  let component: TOC<{ Element: Element }> = <template>
    <div data-test-stub-entry={{id}} ...attributes>
      <button type='button' data-test-stub-entry-button>Stub button</button>
    </div>
  </template>;
  return {
    id,
    type: 'card',
    realmUrl: testRealmURL,
    name: id.replace(testRealmURL, ''),
    isError: false,
    component,
  };
}

class StubSearchResults extends GlimmerComponent<SearchResultsComponentSignature> {
  constructor(owner: Owner, args: SearchResultsComponentSignature['Args']) {
    super(owner, args);
    capturedQueries.push(args.query);
  }

  get results() {
    return {
      entries: stubEntries,
      isLoading: false,
      meta: { page: { total: stubEntries.length } },
      errors: undefined,
    };
  }

  <template>{{yield this.results}}</template>
}

async function renderPosterBoard(board?: PosterBoard) {
  let loader = loaderService().loader;
  await renderCard(loader, board ?? new PosterBoard({}), 'isolated');
}

async function makeSavedNotes() {
  let loader = loaderService().loader;
  class Note extends CardDef {
    static displayName = 'Note';
  }
  loader.shimModule(`${testRealmURL}note`, { Note });
  let note1 = new Note();
  let note2 = new Note();
  await saveCard(note1, `${testRealmURL}Note/1`, loader);
  await saveCard(note2, `${testRealmURL}Note/2`, loader);
  return { note1, note2 };
}

export function runTests() {
  module('Rendering | poster-board card', function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);

    hooks.beforeEach(function () {
      stubEntries = [];
      capturedQueries = [];
      // Partial by design: CardContextConsumer spreads defaults over what the
      // provider supplies, so only the member the board reads is stubbed.
      provideConsumeContext(CardContextName, {
        searchResultsComponent: StubSearchResults,
      } as unknown as CardContext);
    });

    test('poster-board renders its zoom toolbar and the controls zoom, reset, and fit', async function (assert) {
      await renderPosterBoard();

      assert.dom('[data-test-poster-board]').exists('board surface renders');
      assert.dom('[data-test-poster-board-hud]').exists('zoom toolbar renders');
      assert
        .dom('[data-test-poster-board] h1')
        .hasText('Untitled Poster Board', 'computed card title renders');
      assert
        .dom('[data-test-zoom-level]')
        .hasText('100%', 'zoom starts at 100%');

      await click('[data-test-zoom-in]');
      assert.dom('[data-test-zoom-level]').hasText('120%', 'zoom in → 120%');

      await click('[data-test-zoom-out]');
      assert
        .dom('[data-test-zoom-level]')
        .hasText('100%', 'zoom out returns to 100%');

      await click('[data-test-zoom-in]');
      await click('[data-test-zoom-in]');
      await click('[data-test-zoom-reset]');
      assert
        .dom('[data-test-zoom-level]')
        .hasText('100%', '100% button resets zoom');

      await click('[data-test-zoom-in]');
      await click('[data-test-zoom-in]');
      await click('[data-test-fit]');
      assert
        .dom('[data-test-zoom-level]')
        .hasText('100%', 'fit resets zoom to 100%');
    });

    test('poster-board keyboard shortcuts match physical keys, stay scoped to the board, and leave browser zoom alone', async function (assert) {
      await renderPosterBoard();

      // The listener lives on the board element, not window — a keystroke
      // while focus is elsewhere must not zoom the board
      await triggerEvent(document, 'keydown', {
        code: 'Equal',
        key: '+',
        shiftKey: true,
      });
      assert
        .dom('[data-test-zoom-level]')
        .hasText('100%', 'keystroke outside the board is ignored');

      // event.key carries the shifted character ('+', '_', ')') — the
      // handler must match the physical event.code instead
      await triggerEvent('[data-test-poster-board]', 'keydown', {
        code: 'Equal',
        key: '+',
        shiftKey: true,
      });
      assert.dom('[data-test-zoom-level]').hasText('120%', 'Shift+= zooms in');

      await triggerEvent('[data-test-poster-board]', 'keydown', {
        code: 'Equal',
        key: '+',
        shiftKey: true,
        ctrlKey: true,
      });
      assert
        .dom('[data-test-zoom-level]')
        .hasText('120%', 'ctrl+shift+= is left to the browser');

      await triggerEvent('[data-test-poster-board]', 'keydown', {
        code: 'Digit0',
        key: ')',
        shiftKey: true,
      });
      assert
        .dom('[data-test-zoom-level]')
        .hasText('100%', 'Shift+0 resets to 100%');

      await triggerEvent('[data-test-poster-board]', 'keydown', {
        code: 'Minus',
        key: '_',
        shiftKey: true,
      });
      assert.dom('[data-test-zoom-level]').hasText('83%', 'Shift+- zooms out');
    });

    test('poster-board renders prerendered entries at persisted and grid-default positions, mapped by reference', async function (assert) {
      let { note1, note2 } = await makeSavedNotes();

      // Reversed relative to the linked order: the board must map each tile
      // to its entry by reference, never by result position
      stubEntries = [stubEntry(note2.id), stubEntry(note1.id)];

      let board = new PosterBoard({
        cards: [note1, note2],
        frameSettings: [
          new FrameSettingsField({ cardIndex: 1, x: 500, y: 120 }),
        ],
      });
      await renderPosterBoard(board);

      assert
        .dom('[data-test-poster-board-tile]')
        .exists({ count: 2 }, 'a tile renders per linked card');
      assert
        .dom('[data-test-poster-board-tile="0"]')
        .hasStyle(
          { left: '10px', top: '10px' },
          'card without settings lands at its padded grid-default slot',
        );
      assert
        .dom('[data-test-poster-board-tile="1"]')
        .hasStyle(
          { left: '500px', top: '120px' },
          'card with frame settings renders at its persisted position',
        );
      assert
        .dom(
          `[data-test-poster-board-tile="0"] [data-test-stub-entry="${note1.id}"]`,
        )
        .exists('first tile shows the first linked card despite result order');
      assert
        .dom(
          `[data-test-poster-board-tile="1"] [data-test-stub-entry="${note2.id}"]`,
        )
        .exists(
          'second tile shows the second linked card despite result order',
        );
      assert
        .dom('[data-test-poster-board] h1')
        .doesNotExist('hint header is hidden when the board has cards');

      await triggerEvent('[data-test-poster-board-tile="0"]', 'pointerdown', {
        button: 0,
        pointerId: 7,
        clientX: 20,
        clientY: 20,
      });
      assert
        .dom('[data-test-poster-board]')
        .hasStyle(
          { cursor: 'grab' },
          'pointerdown on a card tile does not start a board pan',
        );
    });

    test("poster-board queries prerendered fitted html by the linked cards' URLs", async function (assert) {
      await renderPosterBoard();
      assert.deepEqual(
        capturedQueries,
        [undefined],
        'a board with no cards issues no query',
      );

      let { note1, note2 } = await makeSavedNotes();
      capturedQueries = [];
      stubEntries = [stubEntry(note1.id), stubEntry(note2.id)];
      await renderPosterBoard(new PosterBoard({ cards: [note1, note2] }));

      let query = capturedQueries[capturedQueries.length - 1];
      assert.deepEqual(
        query?.cardUrls,
        [`${note1.id}.json`, `${note2.id}.json`],
        'cards are addressed by their .json file URLs',
      );
      assert.strictEqual(
        query?.scope,
        'cards',
        'the card scope drops dual-indexed file rows',
      );
      assert.deepEqual(
        query?.filter,
        { eq: { htmlQuery: { eq: { format: 'fitted' } } } },
        'the fitted rendering is bound through htmlQuery',
      );
    });

    test('poster-board zoom reset is not undone by pending pinch momentum', async function (assert) {
      await renderPosterBoard();

      // Pinch-style zoom (ctrl+wheel) records velocity and schedules
      // momentum to start after a short idle delay
      await triggerEvent('[data-test-poster-board]', 'wheel', {
        deltaY: -120,
        ctrlKey: true,
      });
      await click('[data-test-zoom-reset]');

      // Wait past the momentum-start delay (45ms); without clearing it,
      // the stale pinch velocity would resume and drift off 100%
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert
        .dom('[data-test-zoom-level]')
        .hasText('100%', 'zoom stays at 100% after momentum delay elapses');
    });
  });
}
