import { click, find, waitFor, waitUntil } from '@ember/test-helpers';

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

  // The stand-in page has no film in it, so this listens where the film app
  // would and checks what the notes send across the frame.
  async function heardByFilm(face: string) {
    await waitFor(`${face} iframe.film-frame`);
    let frame = find(`${face} iframe.film-frame`) as HTMLIFrameElement;
    await waitUntil(() => frame.contentDocument?.title === 'Film');
    let heard: unknown[] = [];
    // the data arrives as an object of the frame's realm; copy it into this
    // one so deepEqual compares contents rather than prototypes
    frame.contentWindow!.addEventListener('message', (event) =>
      heard.push({ ...event.data }),
    );
    return heard;
  }

  test('the Towers notes play their joins on the film in the frame', async function (assert) {
    await renderFilm('towers', 'TowersDemo', 'isolated');
    let heard = await heardByFilm('.tw-face');

    assert.dom('.dd-joins button').exists({ count: 10 }, 'the strip is live');
    await click('.dd-joins button:first-child');
    await waitUntil(() => heard.length > 0);
    assert.deepEqual(
      heard,
      [{ type: 'choreo-film:preview-join', join: 'wipe' }],
      'the join is posted to the film’s document',
    );
  });

  test('the Sagrada notes play their joins on the film in the frame', async function (assert) {
    await renderFilm('sagrada', 'SagradaDemo', 'isolated');
    let heard = await heardByFilm('.sg-face');

    assert.dom('.dd-joins button').exists({ count: 8 }, 'the strip is live');
    await click('.dd-joins button:nth-child(5)');
    await waitUntil(() => heard.length > 0);
    assert.deepEqual(
      heard,
      [{ type: 'choreo-film:preview-join', join: 'iris' }],
      'the join is posted to the film’s document',
    );
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
