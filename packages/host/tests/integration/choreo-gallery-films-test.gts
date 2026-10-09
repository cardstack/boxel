import {
  click,
  find,
  triggerEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { setupChoreo } from '@cardstack/choreo/test-support';
import { getService } from '@universal-ember/test-support';
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

// The gallery's films — Towers, Sagrada and Sylva — loaded from the gallery
// realm's own source. Each film plays in a document of its own, built from
// choreo-film-app; the realm here serves a stand-in for that document's page,
// so these tests cover the card's side of the frame: which face a stage
// wears, how the frame is mounted, and theater.

const FILM_PAGE =
  '<!doctype html><html><head><title>Film</title></head><body></body></html>';

module('Integration | Choreo gallery | films', function (hooks) {
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

  async function renderFilm(
    slug: 'sagrada' | 'sylva' | 'towers',
    className: string,
    format: 'embedded' | 'isolated',
  ) {
    let module = (await loader.import(`${testRealmURL}stages/${slug}`)) as {
      [name: string]: new (attrs: Record<string, unknown>) => CardDefType;
    };
    let demo = new module[className]!({
      slug,
      title: slug,
      group: 'Film',
      lede: `The ${slug} film`,
      apis: [],
      sample: '',
      slowmo: false,
      theater: true,
    });
    await renderCard(loader, demo, format);
  }

  test('a film is a poster in a tile, with no frame and no WebGL', async function (assert) {
    await renderFilm('towers', 'TowersDemo', 'embedded');

    assert.dom('.tw-face .ft-tile').exists('the tile wears the poster');
    assert
      .dom('.tw-face .ft-art')
      .hasAttribute(
        'src',
        `${testRealmURL}asset/towers-poster.webp`,
        'the poster is the realm’s own still',
      );
    assert.dom('.tw-face iframe').doesNotExist('no film runs in a tile');
    assert
      .dom('.tw-face button.ft-play')
      .doesNotExist('a tile with nowhere to open has an inert ring');
  });

  test('on its page a film plays in a frame that names it', async function (assert) {
    await renderFilm('towers', 'TowersDemo', 'isolated');

    await waitFor('.tw-face iframe.film-frame');
    let frame = find('.tw-face iframe.film-frame') as HTMLIFrameElement;
    assert.true(
      frame.srcdoc.includes('<html data-film="towers">'),
      'the document names the film it plays',
    );
    assert.true(
      frame.srcdoc.includes(`<base href="${testRealmURL}film-app/">`),
      'the document resolves its scripts and media against the realm',
    );
    assert
      .dom('[data-demo-stage]')
      .hasAttribute('data-well', 'wide', 'Towers asks for a wide well');
    assert.dom('.tw-face .film-grip').exists('the frame can be resized');
  });

  test('the film’s poster stands in its frame’s place until the film’s first frame is up', async function (assert) {
    await renderFilm('towers', 'TowersDemo', 'isolated');
    assert
      .dom('.tw-face [data-test-film-poster]')
      .hasAttribute(
        'src',
        `${testRealmURL}asset/towers-poster.webp`,
        'the page’s stage shows the film’s still from its first render',
      );

    await waitFor('.tw-face iframe.film-frame');
    let frame = find('.tw-face iframe.film-frame') as HTMLIFrameElement;
    await waitUntil(() => frame.contentDocument?.readyState === 'complete');
    assert
      .dom(frame)
      .doesNotHaveAttribute(
        'data-film-shown',
        'the frame stays clear of the poster while the film loads',
      );

    // the film app posts this from inside its own document once its picture
    // is seated (choreo-film-app's lib/first-frame)
    (frame.contentWindow as Window & typeof globalThis).eval(
      "parent.postMessage({ type: 'choreo-film:first-frame' }, '*')",
    );
    await waitUntil(() => frame.hasAttribute('data-film-shown'));
    assert
      .dom(frame)
      .hasAttribute('data-film-shown', '', 'the film comes up over its poster');
    assert
      .dom('.tw-face [data-test-film-poster]')
      .exists('the poster stays under the frame');
  });

  test('a film’s page leaving takes its frame down before the swap, so the poster is what flies', async function (assert) {
    let { ChoreoGallery } = (await loader.import(`${testRealmURL}gallery`)) as {
      ChoreoGallery: new (attrs: Record<string, unknown>) => CardDefType;
    };
    let module = (await loader.import(`${testRealmURL}stages/towers`)) as {
      TowersDemo: new (attrs: Record<string, unknown>) => CardDefType;
    };
    let gallery = new ChoreoGallery({
      demos: [
        new module.TowersDemo({
          slug: 'towers',
          title: 'towers',
          group: 'Film',
          lede: 'The towers film',
          apis: [],
          sample: '',
          slowmo: false,
          theater: true,
        }),
      ],
    });
    await renderCard(loader, gallery, 'isolated');
    await click('[data-test-gallery-tile-link="towers"]');
    await waitFor('.tw-face iframe.film-frame');

    // what the page held at the moment its frame went
    let pageWhenFrameWent: boolean | undefined;
    let observer = new MutationObserver(() => {
      if (
        pageWhenFrameWent === undefined &&
        !document.querySelector('.tw-face iframe.film-frame')
      ) {
        pageWhenFrameWent = Boolean(
          document.querySelector('[data-test-demo-body]'),
        );
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      await triggerEvent('[data-gallery-home]', 'click');
      await waitUntil(() => !document.querySelector('[data-test-demo-body]'), {
        timeout: 8000,
      });
    } finally {
      observer.disconnect();
    }
    assert.true(
      pageWhenFrameWent,
      'the frame was gone while the page was still showing, with its poster in its place',
    );
  });

  test('the stage’s controls keep their own ink, type and cursor inside the site', async function (assert) {
    await renderFilm('towers', 'TowersDemo', 'isolated');
    await waitFor('.tw-face iframe.film-frame');

    let way = getComputedStyle(find('.tw-face [data-film-theater]')!);
    assert.strictEqual(
      way.color,
      'rgb(242, 233, 210)',
      'the theater button wears its own ink, not the page’s',
    );
    assert.strictEqual(way.fontSize, '11px', 'and its own type');
    assert.strictEqual(
      getComputedStyle(find('.tw-face .film-grip')!).cursor,
      'nwse-resize',
      'the grip shows the resize cursor',
    );
  });

  test('theater brings the stage to the front, and the mark leads back', async function (assert) {
    await renderFilm('sagrada', 'SagradaDemo', 'isolated');
    await waitFor('.sg-face iframe.film-frame');
    let frame = find('.sg-face iframe.film-frame');

    await click('[data-film-theater]');
    assert.dom('.demo-body.is-theater').exists('the page is in theater');
    assert
      .dom('[data-film-theater]')
      .doesNotExist('the way in stands down once you are through it');
    assert
      .dom('.sg-face .film-grip')
      .doesNotExist('in theater the frame is the window');
    assert.dom('.theater-built').exists('the mark is the way out');
    assert.strictEqual(
      find('.sg-face iframe.film-frame'),
      frame,
      'the frame is the same element: entering theater does not reload the film',
    );

    await click('.theater-built');
    assert.dom('.demo-body.is-theater').doesNotExist('back on the page');
    assert.dom('[data-film-theater]').exists('the way in is back');
  });

  test('Sylva has a theater but no resize grip', async function (assert) {
    await renderFilm('sylva', 'SylvaDemo', 'isolated');
    await waitFor('.sy-face iframe.film-frame');

    assert.true(
      (find('.sy-face iframe.film-frame') as HTMLIFrameElement).srcdoc.includes(
        '<html data-film="sylva">',
      ),
      'the document plays Sylva',
    );
    assert.dom('.sy-face [data-film-theater]').exists();
    assert.dom('.sy-face .film-grip').doesNotExist();
  });
});
