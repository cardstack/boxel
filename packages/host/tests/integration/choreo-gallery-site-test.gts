/**
 * The gallery site, whole: the gallery card as the realm serves it — every
 * demo its index links, in that order — rendered isolated, with the palette,
 * the theme switch, and each tile handing its demo card to the host to open.
 */
import { htmlSafe } from '@ember/template';
import { click, render, waitFor, waitUntil } from '@ember/test-helpers';

import { live, liveAll } from '@cardstack/choreo/test-support';

import { modifier } from 'ember-modifier';
import { module, test } from 'qunit';

import { CardContextName } from '@cardstack/runtime-common';

import {
  GALLERY_DEMOS,
  setupChoreoGalleryTest,
} from '../helpers/choreo-gallery-stage';
import { provideConsumeContext, testRealmURL } from '../helpers/index';

import type * as ThemeModule from '../../../choreo-gallery/realm/lib/theme';
import type * as CardAPI from '@cardstack/base/card-api';
import type { CardContext } from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

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
        '.header-picker:has([role="radiogroup"][aria-label="Appearance"])',
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
      option('Light').getAttribute('aria-checked'),
      'true',
      'and the picker says so',
    );

    await click(option('Dark'));
    assert.strictEqual(site().dataset['theme'], 'dark', 'and dark again');
  });

  test('a narrow site keeps its appearance menu inside its bar, and two sites keep their own', async function (assert) {
    let { SiteFrame } = await gallery.import<{
      SiteFrame: ComponentLike<{ Blocks: { default: [] } }>;
    }>('shell/site-frame');
    let narrow = htmlSafe('width: 320px;');
    let wide = htmlSafe('width: 1000px;');
    await render(
      <template>
        <div class='narrow' style={{narrow}}><SiteFrame /></div>
        <div class='wide' style={{wide}}><SiteFrame /></div>
      </template>,
    );
    let picker = (site: string) =>
      document.querySelector<HTMLDetailsElement>(`.${site} .header-picker`)!;

    for (let site of ['narrow', 'wide']) {
      await click(picker(site).querySelector('summary')!);
      // positions as the screen shows them, since the test container is scaled
      let bar = document
        .querySelector(`.${site} .topbar`)!
        .getBoundingClientRect();
      let menu = picker(site)
        .querySelector('.header-picker-menu')!
        .getBoundingClientRect();
      assert.true(
        menu.left >= bar.left,
        `${site}: the menu starts inside the bar (${menu.left} against ${bar.left})`,
      );
      assert.true(
        menu.right <= bar.right,
        `${site}: the menu ends inside the bar (${menu.right} against ${bar.right})`,
      );
      if (site === 'narrow') {
        // the window is wide, so the bar keeps its wide padding: the menu
        // spanning the bar lines up with it
        let topbar = document.querySelector<HTMLElement>('.narrow .topbar')!;
        let scale = bar.width / topbar.offsetWidth;
        let gutter = parseFloat(getComputedStyle(topbar).paddingLeft);
        let inset = (menu.left - bar.left) / scale;
        assert.true(
          Math.abs(inset - gutter) < 1,
          `the menu is inset ${inset}px, the bar's ${gutter}px gutter`,
        );
      }
    }
    assert.true(
      picker('narrow').open,
      'opening the other site’s picker leaves this one open',
    );
    assert.true(picker('wide').open, 'and that one is open too');
  });

  test('the headline sizes to its site, not the window, as in a host stack', async function (assert) {
    let demos = await gallery.demos(['keyframes']);
    let { ChoreoGallery } = await gallery.import<{
      ChoreoGallery: new (attrs: object) => CardAPI.CardDef;
    }>('gallery');
    let { getComponent } = (await gallery.loader.import(
      '@cardstack/base/card-api',
    )) as typeof CardAPI;
    let Gallery = getComponent(new ChoreoGallery({ demos }));
    let narrow = htmlSafe('width: 420px;');
    await render(
      <template>
        <div class='narrow' style={{narrow}}>
          <Gallery @format='isolated' />
        </div>
      </template>,
    );
    let hero = document.querySelector<HTMLElement>('.narrow .hero')!;
    let size = parseFloat(getComputedStyle(hero.querySelector('h1')!).fontSize);

    // the condensed face sets 'Choreographed.' about 5.5em wide, so at 17.5%
    // of the hero's width the word fits it
    assert.true(
      size <= hero.clientWidth * 0.175 + 0.5,
      `the headline is ${size}px in a ${hero.clientWidth}px hero`,
    );
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

    // the title is the tile's link: a real one, for the keyboard, whose
    // activation is a click the host takes like any other
    let link = live<HTMLAnchorElement>(
      "[data-gallery-tile='enter'] a.tile-title",
    )!;
    assert.strictEqual(link.textContent?.trim(), 'Enter', 'named for its demo');
    assert.strictEqual(
      link.getAttribute('href'),
      `${testRealmURL}demos/enter`,
      'and pointing at its card',
    );
    let navigated: boolean | undefined;
    link.addEventListener('click', (event) => {
      navigated = !event.defaultPrevented;
    });
    await click(link);
    assert.deepEqual(
      opened,
      ['keyframes', 'keyframes', 'enter'],
      'following the link opens the card through the host',
    );
    assert.false(navigated, 'and the link does not navigate the page itself');
    assert
      .dom(
        '[data-gallery-tile] [role="link"], [data-gallery-tile][role="link"]',
      )
      .doesNotExist(
        'the tile holds its links side by side, none inside another',
      );
    assert
      .dom('[data-gallery-tile][tabindex]')
      .doesNotExist('and the tile is one stop, its link, not a second');
    assert
      .dom('.demo-head')
      .doesNotExist('the gallery never shows a demo page itself');
  });

  test('a tap the stage uses for itself stays with the stage', async function (assert) {
    let opened = gallery.provideViewCard();
    await gallery.renderGallery();
    await waitFor("[data-gallery-tile='slides'] .slide");
    await waitFor("[data-gallery-tile='drift'] .drift-view");

    await click(live("[data-gallery-tile='slides'] .slide")!);
    await click(live("[data-gallery-tile='drift'] .drift-view")!);
    assert.deepEqual(
      opened,
      [],
      'a tap that advances the slide or steers the car opens nothing',
    );

    await click(live("[data-gallery-tile='slides'] .tile-title")!);
    assert.deepEqual(opened, ['slides'], 'the rest of the tile still opens it');
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

  test('a tile’s name too long for it ends in an ellipsis on a whole line, at every short size the host draws', async function (assert) {
    let [keyframes] = await gallery.demos(['keyframes']);
    // long enough to run past two lines of the widest tile here in any face
    keyframes!.title =
      'A demo with a name far too long for any tile the host draws, at any of its sizes, in whichever face the browser sets it';
    let { getComponent } = (await gallery.loader.import(
      '@cardstack/base/card-api',
    )) as typeof CardAPI;
    let Fitted = getComponent(keyframes!);
    // the host's badges and strips, and a box a little taller
    let sizes = [
      [150, 40],
      [250, 40],
      [150, 65],
      [250, 65],
      [400, 65],
      [150, 105],
      [250, 105],
      [180, 120],
    ];
    let boxes = sizes.map(([width, height]) =>
      htmlSafe(`position: relative; width: ${width}px; height: ${height}px;`),
    );
    await render(
      <template>
        {{#each boxes as |box|}}
          <div class='box' style={{box}}><Fitted @format='fitted' /></div>
        {{/each}}
      </template>,
    );

    // a tile measures itself before it settles on what it shows
    await waitUntil(
      () => document.querySelectorAll('.box .tile.is-tiny').length === 2,
    );
    let rendered = Array.from(document.querySelectorAll<HTMLElement>('.box'));
    for (let [index, box] of rendered.entries()) {
      let [width, height] = sizes[index]!;
      let title = box.querySelector<HTMLElement>('.tile-title')!;
      let lineHeight = parseFloat(getComputedStyle(title).lineHeight);
      let lines = Math.max(1, Math.round(title.clientHeight / lineHeight));
      // positions as the screen shows them, since the test container is scaled
      let scale = box.getBoundingClientRect().height / box.offsetHeight;
      let bottom =
        (title.getBoundingClientRect().bottom -
          box.getBoundingClientRect().top) /
        scale;

      assert.true(
        title.scrollHeight > title.clientHeight,
        `${width}×${height}: the name runs past what the tile shows`,
      );
      assert.true(
        Math.abs(title.clientHeight - lines * lineHeight) < 2,
        `${width}×${height}: it shows ${lines} whole line(s) (${title.clientHeight}px at ${lineHeight}px a line)`,
      );
      assert.true(
        bottom <= height + 0.5,
        `${width}×${height}: the last line ends inside the tile (${bottom}px)`,
      );
    }
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
