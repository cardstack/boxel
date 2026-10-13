/**
 * The gallery site, whole: the gallery card as the realm serves it — every
 * demo its index links, in that order — rendered isolated, with the palette,
 * the theme switch, and each tile handing its demo card to the host to open.
 */
import { htmlSafe } from '@ember/template';
import { click, render, triggerKeyEvent, waitFor } from '@ember/test-helpers';

import { live, liveAll } from '@cardstack/choreo/test-support';
import { modifier } from 'ember-modifier';
import { module, test } from 'qunit';

import { CardContextName } from '@cardstack/runtime-common';

import {
  GALLERY_DEMOS,
  setupChoreoGalleryTest,
} from '../helpers/choreo-gallery-stage';
import { provideConsumeContext } from '../helpers/index';

import type * as ThemeModule from '../../../choreo-gallery/realm/lib/theme';
import type * as CardAPI from '@cardstack/base/card-api';
import type { CardContext } from '@cardstack/base/card-api';

const THEME_KEY = 'choreo-theme';

const tiles = () =>
  liveAll<HTMLElement>('[data-gallery-tile]').map(
    (tile) => tile.dataset['galleryTile'],
  );

module('Integration | Choreo gallery | site', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);
  let storedTheme: string | null = null;

  hooks.beforeEach(async function () {
    // the gallery's theme persists to the document's own storage, not the
    // test's window mock: keep what a developer chose on this origin, and
    // start every test from the gallery's default
    try {
      storedTheme = globalThis.localStorage.getItem(THEME_KEY);
      globalThis.localStorage.removeItem(THEME_KEY);
    } catch {
      storedTheme = null;
    }
  });

  hooks.afterEach(async function () {
    let { setThemeMode } =
      await gallery.import<typeof ThemeModule>('lib/theme');
    setThemeMode('dark');
    try {
      if (storedTheme === null) {
        globalThis.localStorage.removeItem(THEME_KEY);
      } else {
        globalThis.localStorage.setItem(THEME_KEY, storedTheme);
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

  test('a tile hands its demo card to the host, which opens it', async function (assert) {
    let opened = gallery.provideViewCard();
    await gallery.renderGallery();
    // the stage boots once the tile has measured room for it
    await waitFor("[data-gallery-tile='keyframes'] .tile-stage");

    await click(live("[data-gallery-tile='keyframes'] .tile-title")!);
    assert.deepEqual(opened, ['keyframes'], 'a click on the tile opens it');

    await click(live("[data-gallery-tile='keyframes'] .tile-stage")!);
    assert.deepEqual(
      opened,
      ['keyframes', 'keyframes'],
      'and so does a click on the picture: the whole tile is the link',
    );

    let guide = live<HTMLAnchorElement>(
      "[data-gallery-tile='keyframes'] .guide-link",
    )!;
    guide.addEventListener('click', (event) => event.preventDefault());
    await click(guide);
    assert.strictEqual(opened.length, 2, 'the guide link keeps its click');

    await triggerKeyEvent(
      live("[data-gallery-tile='enter']")!,
      'keydown',
      'Enter',
    );
    assert.deepEqual(
      opened,
      ['keyframes', 'keyframes', 'enter'],
      'Enter on a focused tile opens it too',
    );
    assert
      .dom('.demo-head')
      .doesNotExist('the gallery never shows a demo page itself');
  });

  test('a tile with no room for a stage is just the demo’s name', async function (assert) {
    let [keyframes] = await gallery.demos(['keyframes']);
    let { getComponent } = (await gallery.loader.import(
      '@cardstack/base/card-api',
    )) as typeof CardAPI;
    let Fitted = getComponent(keyframes!);
    let small = htmlSafe('position: relative; width: 260px; height: 80px;');
    let roomy = htmlSafe('position: relative; width: 420px; height: 540px;');
    await render(
      <template>
        <div class='small' style={{small}}><Fitted @format='fitted' /></div>
        <div class='roomy' style={{roomy}}><Fitted @format='fitted' /></div>
      </template>,
    );
    await waitFor('.roomy .tile-stage');

    assert.dom('.small .tile-title').hasText('Keyframes', 'the name');
    assert.dom('.small .tile-stage').doesNotExist('no stage boots');
    assert.dom('.small .guide-link').doesNotExist('and no guide link');
    assert.dom('.roomy .tile-lede').exists('with room, what the demo is');
    assert.dom('.roomy .guide-link').exists('and its guide');
  });

  test('where the host opens cards on a click, the tile leaves the click to it', async function (assert) {
    // the overlay's listener: on the card's element, and it keeps the click
    let overlay: string[] = [];
    let opensOnClick = modifier((element: HTMLElement) => {
      let open = (event: Event) => {
        event.stopPropagation();
        overlay.push('card');
      };
      element.addEventListener('click', open);
      return () => element.removeEventListener('click', open);
    });
    provideConsumeContext(CardContextName, {
      cardComponentModifier: opensOnClick,
    } as unknown as CardContext);
    let opened = gallery.provideViewCard();
    await gallery.renderGallery();
    await waitFor("[data-gallery-tile='keyframes'] .tile-title");

    await click(live("[data-gallery-tile='keyframes'] .tile-title")!);
    assert.deepEqual(overlay, ['card'], 'the host takes the click');
    assert.deepEqual(opened, [], 'and the gallery does not open it again');
  });
});
