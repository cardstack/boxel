import { click, waitFor } from '@ember/test-helpers';

import { setupChoreo } from '@cardstack/choreo/test-support';
import { getService } from '@universal-ember/test-support';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { choreoGalleryContents } from '../helpers/choreo-gallery';
import { frames } from '../helpers/choreo-gallery-stage';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

// Theater, the films' full-window mode: the way in and out from the gallery,
// how the stage sizes itself against what the viewer can see of the card and
// at phone, tablet and desktop viewports, and how it moves between the two
// modes.

const FILM_PAGE =
  '<!doctype html><html><head><title>Film</title></head><body></body></html>';

const FILMS = [
  { slug: 'towers', className: 'TowersDemo' },
  { slug: 'sagrada', className: 'SagradaDemo' },
  { slug: 'sylva', className: 'SylvaDemo' },
] as const;

// portrait phones, a landscape phone, and a desktop window
const VIEWPORTS = [
  [390, 844],
  [430, 932],
  [844, 390],
  [1440, 1000],
] as const;

type CardClass = new (attrs: Record<string, unknown>) => CardDefType;

/** the element that scrolls the card: the test's own container, here */
function scrollerOf(el: Element): Element {
  let node = el.parentElement;
  while (node) {
    let { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement!;
}

/**
 * Lays the rendered page out again in an iframe of the given size, with every
 * stylesheet the page has, so viewport units resolve against that size. The
 * test window has one viewport; sizing is layout alone, so a static copy of
 * the page sizes exactly as the live one would in a window that size. The
 * copy's film frames load nothing, and it drops the sizes the live page
 * measured for theater, so it lays out as a page whose document is its own
 * scroller: as tall as the window, inside the page's measure.
 */
function layOutAt(
  page: Element,
  width: number,
  height: number,
): HTMLIFrameElement {
  let css = '';
  for (let sheet of Array.from(document.styleSheets)) {
    try {
      for (let rule of Array.from(sheet.cssRules)) {
        css += `${rule.cssText}\n`;
      }
    } catch {
      // a cross-origin sheet can't be read, and the page's own CSS is not one
    }
  }
  let copy = page.cloneNode(true) as Element;
  for (let frame of Array.from(copy.querySelectorAll('iframe'))) {
    frame.removeAttribute('src');
    frame.removeAttribute('srcdoc');
  }
  for (let el of Array.from(copy.querySelectorAll<HTMLElement>('[style]'))) {
    el.style.removeProperty('--view-h');
    el.style.removeProperty('--site-w');
  }

  let iframe = document.createElement('iframe');
  iframe.style.cssText = `position: fixed; top: 0; left: -${width + 100}px; width: ${width}px; height: ${height}px; border: 0;`;
  document.body.append(iframe);
  let doc = iframe.contentDocument!;
  doc.open();
  doc.write(
    `<!doctype html><html><head><style>${css}</style><style>body { margin: 0; }</style></head><body>${copy.outerHTML}</body></html>`,
  );
  doc.close();
  return iframe;
}

module('Integration | Choreo gallery | theater', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupChoreo(hooks);
  let loader: Loader;

  setupLocalIndexing(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        ...choreoGalleryContents(),
        'film-app/index.html': FILM_PAGE,
      },
      skipBootIndex: true,
    });
  });

  async function film(slug: string, className: string) {
    let module = (await loader.import(`${testRealmURL}stages/${slug}`)) as {
      [name: string]: CardClass;
    };
    return new module[className]!({
      slug,
      title: slug,
      group: 'Film',
      lede: `The ${slug} film`,
      apis: [],
      sample: '',
      slowmo: false,
      theater: true,
    });
  }

  test('a film opened from the gallery enters theater, and only the way out is on screen', async function (assert) {
    let { ChoreoGallery } = (await loader.import(`${testRealmURL}gallery`)) as {
      ChoreoGallery: CardClass;
    };
    let gallery = new ChoreoGallery({
      demos: [await film('towers', 'TowersDemo')],
    });
    await renderCard(loader, gallery, 'isolated');
    await animationsSettled();

    await click('[data-test-gallery-tile-link="towers"]');
    await waitFor('[data-test-film="towers"] [data-test-theater-enter]');
    await animationsSettled();
    assert
      .dom('[data-test-choreo-site]')
      .doesNotHaveAttribute('data-test-theater', 'the film opens on its page');

    await click('[data-test-theater-enter]');
    assert
      .dom('[data-test-choreo-site]')
      .hasAttribute('data-test-theater', '', 'the site is in theater');
    assert
      .dom('[data-test-theater-enter]')
      .doesNotExist('the way in does not overlap the way out');
    assert
      .dom('[data-test-theater-exit]')
      .isVisible('the way out stays on screen');
  });

  test('switching theater on and off carries the stage between its two boxes', async function (assert) {
    await renderCard(loader, await film('towers', 'TowersDemo'), 'isolated');
    await waitFor('[data-test-film="towers"] [data-test-theater-enter]');
    await animationsSettled();
    let stage = document.querySelector<HTMLElement>('[data-test-stage]')!;
    let frame = stage.querySelector('iframe');

    for (let [label, selector] of [
      ['in', '[data-test-theater-enter]'],
      ['out', '[data-test-theater-exit]'],
    ] as const) {
      await click(selector);
      await frames(1);
      let glide = stage
        .getAnimations()
        .find((animation) =>
          (animation.effect as KeyframeEffect | null)
            ?.getKeyframes()
            .some((keyframe) => typeof keyframe.transform === 'string'),
        );
      assert.ok(glide, `going ${label}, the stage glides rather than snaps`);
      glide?.finish();
    }
    assert.strictEqual(
      stage.querySelector('iframe'),
      frame,
      'the frame kept its parent through both switches',
    );
  });

  for (let { slug, className } of FILMS) {
    test(`${slug}: in theater the stage spans the site and fills what its scroller shows`, async function (assert) {
      await renderCard(loader, await film(slug, className), 'isolated');
      await waitFor(`[data-test-film="${slug}"] [data-test-theater-enter]`);
      await click('[data-test-theater-enter]');
      await animationsSettled();
      await frames(1);
      // the stage glides into theater on an animation of its own
      await Promise.all(
        document
          .querySelector<HTMLElement>('[data-test-stage]')!
          .getAnimations()
          .map((animation) => animation.finished),
      );

      let row = document.querySelector<HTMLElement>('[data-test-stage-row]')!;
      let scroller = scrollerOf(row);
      let siteEl = document.querySelector<HTMLElement>(
        '[data-test-choreo-site]',
      )!;
      let stageEl = document.querySelector<HTMLElement>(
        `[data-test-stage]:has([data-test-film="${slug}"])`,
      )!;
      // sizes in layout pixels; positions as the screen shows them, since the
      // test container is scaled
      let site = siteEl.getBoundingClientRect();
      let stage = stageEl.getBoundingClientRect();
      let view = scroller.getBoundingClientRect();

      assert.true(
        Math.abs(stage.left - site.left) < 1,
        `the stage starts at the site's left edge (${stage.left} against ${site.left})`,
      );
      assert.true(
        Math.abs(stageEl.offsetWidth - siteEl.clientWidth) < 1,
        `the stage is as wide as the site (${stageEl.offsetWidth} against ${siteEl.clientWidth})`,
      );
      assert.true(
        Math.abs(
          stageEl.offsetHeight -
            Math.min(scroller.clientHeight, stageEl.offsetWidth),
        ) < 1,
        `the stage is ${stageEl.offsetHeight}px tall: the lesser of the ${scroller.clientHeight}px its scroller shows and its own width, not the window's ${window.innerHeight}px`,
      );
      assert.true(
        stage.bottom <= view.bottom + 1,
        `the film's foot is in view (${stage.bottom} within ${view.bottom})`,
      );
    });

    test(`${slug}: in theater the stage fills the window, capped at a square`, async function (assert) {
      await renderCard(loader, await film(slug, className), 'isolated');
      await waitFor(`[data-test-film="${slug}"] [data-test-theater-enter]`);
      await click('[data-test-theater-enter]');
      await animationsSettled();
      let page = document.querySelector('[data-test-choreo-site]')!;
      assert.dom('[data-test-demo-body]').hasAttribute('data-test-theater');

      for (let [width, height] of VIEWPORTS) {
        let iframe = layOutAt(page, width, height);
        try {
          let doc = iframe.contentDocument!;
          let row = doc.querySelector('[data-test-stage-row]') as HTMLElement;
          let rowStyle = iframe.contentWindow!.getComputedStyle(row);
          // the stage row is the size container; its content box is 100cqi
          let rowWidth =
            row.clientWidth -
            parseFloat(rowStyle.paddingLeft) -
            parseFloat(rowStyle.paddingRight);
          let stage = doc
            .querySelector(`[data-test-stage]:has([data-test-film="${slug}"])`)!
            .getBoundingClientRect();

          assert.true(
            Math.abs(stage.height - Math.min(height, rowWidth)) < 1,
            `${width}×${height}: the stage is ${stage.height}px tall, the lesser of the window's height and the stage row's ${rowWidth}px width`,
          );
          assert.true(
            stage.height <= stage.width + 0.5,
            `${width}×${height}: the stage is never taller than it is wide`,
          );
        } finally {
          iframe.remove();
        }
      }
    });
  }
});
