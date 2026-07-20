import { click, triggerEvent } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { setupBaseRealm } from '@cardstack/host/tests/helpers/base-realm';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { setupRenderingTest } from '@cardstack/host/tests/helpers/setup';

import { PosterBoard } from './poster-board';

async function renderPosterBoard() {
  let loader = getService('loader-service').loader;
  let card = new PosterBoard({});
  await renderCard(loader, card, 'isolated');
}

export function runTests() {
  module('Rendering | poster-board card', function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);

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

    test('poster-board keyboard shortcuts match physical keys and leave browser zoom alone', async function (assert) {
      await renderPosterBoard();

      // event.key carries the shifted character ('+', '_', ')') — the
      // handler must match the physical event.code instead
      await triggerEvent(document, 'keydown', {
        code: 'Equal',
        key: '+',
        shiftKey: true,
      });
      assert.dom('[data-test-zoom-level]').hasText('120%', 'Shift+= zooms in');

      await triggerEvent(document, 'keydown', {
        code: 'Equal',
        key: '+',
        shiftKey: true,
        ctrlKey: true,
      });
      assert
        .dom('[data-test-zoom-level]')
        .hasText('120%', 'ctrl+shift+= is left to the browser');

      await triggerEvent(document, 'keydown', {
        code: 'Digit0',
        key: ')',
        shiftKey: true,
      });
      assert
        .dom('[data-test-zoom-level]')
        .hasText('100%', 'Shift+0 resets to 100%');

      await triggerEvent(document, 'keydown', {
        code: 'Minus',
        key: '_',
        shiftKey: true,
      });
      assert.dom('[data-test-zoom-level]').hasText('83%', 'Shift+- zooms out');
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
