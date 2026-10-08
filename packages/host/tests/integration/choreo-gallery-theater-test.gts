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
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

// Theater, the films' full-window mode: the way in and out from the gallery,
// and how the stage sizes itself at phone, tablet and desktop viewports.

const FILM_PAGE =
  '<!doctype html><html><head><title>Film</title></head><body></body></html>';

const FILMS = [
  { slug: 'towers', className: 'TowersDemo', face: 'tw-face' },
  { slug: 'sagrada', className: 'SagradaDemo', face: 'sg-face' },
  { slug: 'sylva', className: 'SylvaDemo', face: 'sy-face' },
] as const;

// portrait phones, a landscape phone, and a desktop window
const VIEWPORTS = [
  [390, 844],
  [430, 932],
  [844, 390],
  [1440, 1000],
] as const;

type CardClass = new (attrs: Record<string, unknown>) => CardDefType;

/**
 * Lays the rendered page out again in an iframe of the given size, with every
 * stylesheet the page has, so viewport units resolve against that size. The
 * test window has one viewport; sizing is layout alone, so a static copy of
 * the page sizes exactly as the live one would in a window that size. The
 * copy's film frames load nothing.
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

    await click('[data-gallery-tile="towers"] .card-meta');
    await waitFor('.tw-face [data-film-theater]');
    await animationsSettled();
    assert
      .dom('.choreo-site')
      .doesNotHaveClass('is-theater', 'the film opens on its page');

    await click('[data-film-theater]');
    assert.dom('.choreo-site').hasClass('is-theater', 'the site is in theater');
    assert
      .dom('[data-film-theater]')
      .doesNotExist('the way in does not overlap the way out');
    assert.dom('.theater-built').isVisible('the way out stays on screen');
  });

  for (let { slug, className, face } of FILMS) {
    test(`${slug}: in theater the stage fills the window, capped at a square`, async function (assert) {
      await renderCard(loader, await film(slug, className), 'isolated');
      await waitFor(`.${face} [data-film-theater]`);
      await click('[data-film-theater]');
      await animationsSettled();
      let page = document.querySelector('[data-choreo-site]')!;
      assert.dom('.demo-body').hasClass('is-theater');

      for (let [width, height] of VIEWPORTS) {
        let iframe = layOutAt(page, width, height);
        try {
          let doc = iframe.contentDocument!;
          let row = doc.querySelector('.stage-row') as HTMLElement;
          let rowStyle = iframe.contentWindow!.getComputedStyle(row);
          // the stage row is the size container; its content box is 100cqi
          let rowWidth =
            row.clientWidth -
            parseFloat(rowStyle.paddingLeft) -
            parseFloat(rowStyle.paddingRight);
          let stage = doc
            .querySelector(`.stage-wrap:has(.${face})`)!
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
