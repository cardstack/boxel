import { click } from '@ember/test-helpers';

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

    test('poster-board renders isolated view with zoom toolbar', async function (assert) {
      await renderPosterBoard();

      assert.dom('[data-test-poster-board]').exists('board surface renders');
      assert.dom('[data-test-poster-board-hud]').exists('zoom toolbar renders');
      assert
        .dom('[data-test-poster-board] h1')
        .hasText('Untitled Poster Board', 'computed card title renders');
      assert
        .dom('[data-test-zoom-level]')
        .hasText('100%', 'zoom starts at 100%');
    });

    test('poster-board zoom buttons change and reset the zoom level', async function (assert) {
      await renderPosterBoard();

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
    });

    test('poster-board fit button resets the view', async function (assert) {
      await renderPosterBoard();

      await click('[data-test-zoom-in]');
      await click('[data-test-zoom-in]');
      await click('[data-test-fit]');

      assert
        .dom('[data-test-zoom-level]')
        .hasText('100%', 'fit resets zoom to 100%');
    });
  });
}
