import {
  click,
  fillIn,
  triggerKeyEvent,
  triggerEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';

import { testRealmURL, visitOperatorMode } from '../../helpers';
import { setupInteractSubmodeTests } from '../../helpers/interact-submode-setup';

module(
  'Acceptance | interact submode | search sheet persistence tests',
  function (hooks) {
    setupInteractSubmodeTests(hooks, {
      reuseIndexAcrossTests: 'interactSearchSheetPersistence',
      setRealm() {},
    });

    module('search sheet persistence', function () {
      test('restores the query, view, and results after a close/reopen', async function (assert) {
        await visitOperatorMode({});

        // Run a search and switch the results to the strip view.
        await click('[data-test-open-search-field]');
        await fillIn('[data-test-search-field]', 'Mango');
        assert.dom('[data-test-search-sheet]').hasClass('results');
        assert
          .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
          .exists('the search found the card');

        await click('[data-test-search-result-header] [aria-label="strip"]');
        assert
          .dom('[data-test-search-result-header] [aria-label="strip"]')
          .hasClass('is-selected', 'strip view is active');

        // Close the sheet by clicking outside it (a plain close keeps the search).
        await click('[data-test-submode-layout]');
        assert.dom('[data-test-search-sheet]').hasClass('closed');

        // Reopening restores the results view, the query text, the view toggle, and
        // the results (rendered from the service-owned resource, which outlived
        // the close, so there's no re-run).
        await click('[data-test-open-search-field]');
        assert.dom('[data-test-search-sheet]').hasClass('results');
        assert.dom('[data-test-search-field]').hasValue('Mango');
        assert
          .dom('[data-test-search-result-header] [aria-label="strip"]')
          .hasClass('is-selected', 'strip view is restored');
        assert
          .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
          .exists('the results are restored');
      });

      test('reopens a filter-only search (no term) to its results, not the compact prompt', async function (assert) {
        await visitOperatorMode({});

        // Reproduce code mode's "Find instances": a type filter with no search
        // term. The reopen gate keys on the service's `hasActiveSearch` (term OR
        // type OR realm), so this must reopen to the live type-filtered results
        // rather than the recents-only compact prompt.
        let searchSheetState = getService('search-sheet-state');
        searchSheetState.selectedTypes = [
          { module: rri(`${testRealmURL}pet`), name: 'Pet' },
        ];

        await click('[data-test-open-search-field]');
        assert
          .dom('[data-test-search-sheet]')
          .hasClass(
            'results',
            'a filter-only search opens to the results view',
          );
        assert
          .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
          .exists('the type-filtered results are shown');

        // Close by clicking outside (a plain close keeps the search).
        await click('[data-test-submode-layout]');
        assert.dom('[data-test-search-sheet]').hasClass('closed');

        // Reopening must land on the results view even though the term is empty.
        await click('[data-test-open-search-field]');
        assert
          .dom('[data-test-search-sheet]')
          .hasClass(
            'results',
            'reopening a filter-only search restores the results view',
          );
        assert
          .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
          .exists('the type-filtered results are restored on reopen');
      });

      test('reopening an unchanged search does not re-run the query', async function (assert) {
        await visitOperatorMode({});

        let store = getService('store');
        let originalSearchEntries = store.searchEntries.bind(store);
        let mainSearchFetches = 0;
        store.searchEntries = async (query, realms) => {
          // Isolate the main search from the recents query (component-owned, so
          // it re-runs on reopen) by keying on the search term.
          if (JSON.stringify(query).toLowerCase().includes('mango')) {
            mainSearchFetches++;
          }
          return originalSearchEntries(query, realms);
        };

        try {
          await click('[data-test-open-search-field]');
          await fillIn('[data-test-search-field]', 'Mango');
          assert
            .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
            .exists('the search found the card');
          let fetchesAfterSearch = mainSearchFetches;
          assert.ok(fetchesAfterSearch >= 1, 'the initial search fetched');

          // Close and reopen with the query unchanged.
          await click('[data-test-submode-layout]');
          assert.dom('[data-test-search-sheet]').hasClass('closed');
          await click('[data-test-open-search-field]');

          assert
            .dom(`[data-test-search-result="${testRealmURL}Pet/mango"]`)
            .exists('the results are shown immediately on reopen');
          assert.strictEqual(
            mainSearchFetches,
            fetchesAfterSearch,
            'reopen reuses the same resource — no additional main-search fetch',
          );

          // Changing the term still runs a fresh search (the derived query
          // changed).
          await fillIn('[data-test-search-field]', 'Van Gogh');
          assert
            .dom(`[data-test-search-result="${testRealmURL}Pet/vangogh"]`)
            .exists('a changed query re-runs the search');
        } finally {
          store.searchEntries = originalSearchEntries;
        }
      });

      test('restores the results scroll position after a close/reopen', async function (assert) {
        await visitOperatorMode({});

        // A broad term returns enough results for the list to overflow.
        await click('[data-test-open-search-field]');
        await fillIn('[data-test-search-field]', 'ma');
        assert.dom('[data-test-search-sheet]').hasClass('results');
        await waitFor('[data-test-search-result]');

        let scrollContainer = document.querySelector(
          '[data-test-search-sheet] .search-sheet-content',
        ) as HTMLElement;
        assert.ok(
          scrollContainer.scrollHeight > scrollContainer.clientHeight,
          'the results list overflows and can scroll',
        );

        // A user gesture then a scroll partway down: the gesture is what marks the
        // scroll as user-driven so the offset is recorded (programmatic restores
        // and layout resets, which lack a gesture, are deliberately ignored).
        await triggerEvent(scrollContainer, 'wheel');
        scrollContainer.scrollTop = 60;
        let expected = scrollContainer.scrollTop;
        assert.ok(expected > 0, 'the list was scrolled away from the top');
        await triggerEvent(scrollContainer, 'scroll');

        await click('[data-test-submode-layout]');
        assert.dom('[data-test-search-sheet]').hasClass('closed');

        await click('[data-test-open-search-field]');
        let restoredContainer = document.querySelector(
          '[data-test-search-sheet] .search-sheet-content',
        ) as HTMLElement;
        // Restore re-applies per frame until the restored rows are laid out and
        // the offset sticks; wait for that to settle.
        for (
          let i = 0;
          i < 30 && Math.abs(restoredContainer.scrollTop - expected) > 1;
          i++
        ) {
          // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for the per-frame scroll restore
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        assert.strictEqual(
          restoredContainer.scrollTop,
          expected,
          'the scroll position is restored on reopen',
        );
        // While the offset hadn't stuck the list was hidden behind this tag (so
        // the restore never paints a clamped-to-top frame); once restored — and
        // the container's box has been quiet for the reveal's short gate — it
        // must be visible again.
        await waitUntil(
          () => !restoredContainer.hasAttribute('data-scroll-restore-pending'),
          { timeout: 3000 },
        );
        assert
          .dom(restoredContainer)
          .doesNotHaveAttribute(
            'data-scroll-restore-pending',
            'the restored list is revealed once the offset sticks',
          );
      });

      test('the Cancel button clears the persisted search', async function (assert) {
        await visitOperatorMode({});

        await click('[data-test-open-search-field]');
        await fillIn('[data-test-search-field]', 'Mango');
        assert.dom('[data-test-search-sheet]').hasClass('results');

        await click('[data-test-search-sheet-cancel-button]');
        assert.dom('[data-test-search-sheet]').hasClass('closed');

        await click('[data-test-open-search-field]');
        assert
          .dom('[data-test-search-sheet]')
          .hasClass(
            'prompt',
            'reopens to a blank prompt, not the prior results',
          );
        assert.dom('[data-test-search-field]').hasValue('');
      });

      test('Escape clears the persisted search', async function (assert) {
        await visitOperatorMode({});

        await click('[data-test-open-search-field]');
        await fillIn('[data-test-search-field]', 'Mango');
        assert.dom('[data-test-search-sheet]').hasClass('results');

        await triggerKeyEvent('[data-test-search-field]', 'keydown', 'Escape');
        assert.dom('[data-test-search-sheet]').hasClass('closed');

        await click('[data-test-open-search-field]');
        assert.dom('[data-test-search-sheet]').hasClass('prompt');
        assert.dom('[data-test-search-field]').hasValue('');
      });

      test('emptying the query then closing reopens to a blank prompt', async function (assert) {
        await visitOperatorMode({});

        await click('[data-test-open-search-field]');
        await fillIn('[data-test-search-field]', 'Mango');
        assert.dom('[data-test-search-sheet]').hasClass('results');

        // Clear the query, then close by clicking outside.
        await fillIn('[data-test-search-field]', '');
        await click('[data-test-submode-layout]');
        assert.dom('[data-test-search-sheet]').hasClass('closed');

        await click('[data-test-open-search-field]');
        assert
          .dom('[data-test-search-sheet]')
          .hasClass('prompt', 'an empty query reopens to the compact prompt');
        assert.dom('[data-test-search-field]').hasValue('');
      });
    });
  },
);
