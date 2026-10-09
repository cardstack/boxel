/**
 * The gallery site, whole: the gallery card as the realm serves it — every
 * demo its index links, in that order — rendered isolated, with the palette,
 * the theme switch, and a trip to a demo page and back.
 */
import { click, waitFor } from '@ember/test-helpers';

import { live, liveAll } from '@cardstack/choreo/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';

import {
  GALLERY_DEMOS,
  setupChoreoGalleryTest,
} from '../helpers/choreo-gallery-stage';

import type * as TempoModule from '../../../choreo-gallery/realm/lib/tempo';
import type * as ThemeModule from '../../../choreo-gallery/realm/lib/theme';

const THEME_KEY = 'choreo-theme';

const tiles = () =>
  liveAll<HTMLElement>('[data-gallery-tile]').map(
    (tile) => tile.dataset['galleryTile'],
  );

module('Integration | Choreo gallery | site', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);
  let storedTheme: string | null = null;

  hooks.beforeEach(async function () {
    try {
      storedTheme = window.localStorage.getItem(THEME_KEY);
    } catch {
      storedTheme = null;
    }
    let { setTempo } = await gallery.import<typeof TempoModule>('lib/tempo');
    setTempo('instant');
  });

  hooks.afterEach(async function () {
    let { setTempo } = await gallery.import<typeof TempoModule>('lib/tempo');
    setTempo('smooth');
    let { setThemeMode } =
      await gallery.import<typeof ThemeModule>('lib/theme');
    setThemeMode('dark');
    try {
      if (storedTheme === null) {
        window.localStorage.removeItem(THEME_KEY);
      } else {
        window.localStorage.setItem(THEME_KEY, storedTheme);
      }
    } catch {
      // persistence is optional
    }
  });

  test('the isolated gallery renders its hero and one tile per linked demo', async function (assert) {
    await gallery.renderGallery();

    assert.dom('[data-choreo-site] .hero').exists('the hero is there');
    assert.dom('.hero h1').includesText('Choreographed', 'with its headline');
    assert.true(GALLERY_DEMOS.length > 0, 'the index links demos');
    assert.deepEqual(
      tiles(),
      GALLERY_DEMOS,
      'one tile per demo the index links, in its order',
    );
  });

  test('the theme toggle switches the site between light and dark', async function (assert) {
    await gallery.renderGallery();
    let site = () => document.querySelector<HTMLElement>('.choreo-site')!;
    let appearance = () =>
      document.querySelector<HTMLElement>(
        '.header-picker:has(summary[aria-label="Appearance"])',
      )!;
    let option = (label: string) =>
      [...appearance().querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === label,
      )!;

    assert.strictEqual(
      site().dataset['theme'],
      'dark',
      'dark is the gallery’s default',
    );

    await click(appearance().querySelector('summary')!);
    await click(option('Light'));
    assert.strictEqual(site().dataset['theme'], 'light', 'light, on request');
    assert.strictEqual(
      option('Light').getAttribute('aria-pressed'),
      'true',
      'and the picker says so',
    );

    await click(option('Dark'));
    assert.strictEqual(site().dataset['theme'], 'dark', 'and dark again');
  });

  test('a tile opens its demo page in place, and the topbar brings it back', async function (assert) {
    await gallery.renderGallery();

    await click(live("[data-gallery-tile='keyframes'] .card-meta")!);
    await waitFor('[data-demo="keyframes"]');

    assert.deepEqual(tiles(), [], 'the grid has left');
    assert
      .dom('.demo-head h1')
      .hasText('Keyframes', 'the keyframes demo page renders in its place');
    let code = live('.sample code');
    assert.ok(code, 'the page shows its usage example');
    assert.ok(
      code!.querySelector('[class^="syn-"]'),
      'the example is highlighted',
    );
    assert.true(
      code!.textContent?.includes('motion'),
      'and it is the GTS that uses motion',
    );

    await click(live('.topbar [data-gallery-brand]')!);
    await waitFor('[data-gallery-tile]');
    assert.deepEqual(tiles(), GALLERY_DEMOS, 'back on the index, every tile');
    assert.dom('.demo-head').doesNotExist('the demo page has gone');
  });
});
