/**
 * The widget room: every demo the gallery links hangs on a wall, and a tile
 * the visitor focuses mounts its live stage. The room's code finds demos and
 * their controls through hooks of its own and the demos' own markup, never
 * through a test selector.
 */
import { click, render, settled, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { choreoGalleryContents } from '../helpers/choreo-gallery';
import {
  GALLERY_DEMOS,
  setupChoreoGalleryTest,
  setupStageViewport,
} from '../helpers/choreo-gallery-stage';

import type * as LayoutModule from '../../../choreo-gallery/realm/lib/widget-gallery-layout';
import type * as RoomModule from '../../../choreo-gallery/realm/shell/widget-room';

module('Integration | Choreo gallery | widget room', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);
  setupStageViewport(hooks, { width: 1200, height: 800 });

  async function renderRoom() {
    let { WidgetRoom, roomDemos } =
      await gallery.import<typeof RoomModule>('shell/widget-room');
    let demos = roomDemos(await gallery.demos());
    await render(
      <template>
        <WidgetRoom @demos={{demos}} @homeHref='https://example.test/' />
      </template>,
    );
    // the room loads three.js before its first paint, which places the world
    await waitUntil(
      () => document.querySelector<HTMLElement>('.wr-world')?.style.transform,
      { timeout: 10000 },
    );
  }

  test('hangs every demo the gallery links, each in a bay', async function (assert) {
    let { galleryZones } = await gallery.import<typeof LayoutModule>(
      'lib/widget-gallery-layout',
    );
    let zoned = new Set(galleryZones.flat());
    await renderRoom();
    let hung = [...document.querySelectorAll<HTMLElement>('[data-widget-id]')]
      .map((tile) => tile.dataset.widgetId!)
      .sort();
    assert.deepEqual(
      hung,
      GALLERY_DEMOS.filter((slug) => zoned.has(slug)).sort(),
      'one tile per linked demo a bay names',
    );
    assert.deepEqual(
      GALLERY_DEMOS.filter((slug) => !zoned.has(slug)),
      [],
      'and every linked demo has a bay',
    );
  });

  test('focusing a tile mounts its live stage', async function (assert) {
    await renderRoom();
    let tile = '[data-widget-id="keyframes"]';
    assert
      .dom(`${tile} .wr-live-canvas`)
      .hasNoText('a distant tile shows its preview, not its stage');
    await click(`${tile} .wr-live-hit`);
    await waitUntil(
      () =>
        document.querySelector(`${tile} .wr-live-canvas`)!.childElementCount >
        0,
      { timeout: 5000 },
    );
    await settled();
    assert
      .dom(`${tile} .wr-live-canvas .morph`)
      .exists('the Keyframes stage is live in the tile');
    assert
      .dom('.wr-shell')
      .hasClass('has-selection', 'the room reports the selection');
  });

  test('no gallery module finds anything by a test selector', function (assert) {
    let offenders = Object.entries(choreoGalleryContents())
      .filter(([path]) => /\.(gts|ts)$/.test(path))
      .filter(([, source]) => /\[data-test-/.test(source as string))
      .map(([path]) => path);
    assert.deepEqual(offenders, [], 'test selectors are for tests');
  });
});
