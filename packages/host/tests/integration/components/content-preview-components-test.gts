import { find, waitUntil } from '@ember/test-helpers';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as AudioDefModule from '@cardstack/base/audio-file-def';
import type * as CardApiModule from '@cardstack/base/card-api';
import type * as FileFormatsModule from '@cardstack/base/file-formats/index';
import type * as MetadataFieldsModule from '@cardstack/base/file-formats/metadata-fields';
import type * as MarkdownDefModule from '@cardstack/base/markdown-file-def';
import type * as VideoDefModule from '@cardstack/base/video-file-def';

// The content-only preview components: a card author imports one from the
// `file-formats/index` barrel, passes the FileDef instance, and gets just the
// file's content — no shell chrome (file bar, inspector, Download/Copy-link),
// which stays with the default FileDef format templates.
module('Integration | content-only file preview components', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let fileFormats: typeof FileFormatsModule;
  let MarkdownDef: typeof MarkdownDefModule.MarkdownDef;
  let ImageDef: typeof CardApiModule.ImageDef;
  let AudioDef: typeof AudioDefModule.AudioDef;
  let VideoDef: typeof VideoDefModule.VideoDef;
  let WaveformMetadataField: typeof MetadataFieldsModule.WaveformMetadataField;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    // The one stable import path for embedding authors:
    // `https://cardstack.com/base/file-formats/index`.
    fileFormats = await loader.import<typeof FileFormatsModule>(
      `${baseRealm.url}file-formats/index`,
    );
    ({ MarkdownDef } = await loader.import<typeof MarkdownDefModule>(
      `${baseRealm.url}markdown-file-def`,
    ));
    ({ ImageDef } = await loader.import<typeof CardApiModule>(
      `${baseRealm.url}card-api`,
    ));
    ({ AudioDef } = await loader.import<typeof AudioDefModule>(
      `${baseRealm.url}audio-file-def`,
    ));
    ({ VideoDef } = await loader.import<typeof VideoDefModule>(
      `${baseRealm.url}video-file-def`,
    ));
    ({ WaveformMetadataField } = await loader.import<
      typeof MetadataFieldsModule
    >(`${baseRealm.url}file-formats/metadata-fields`));
  });

  function makeMarkdownFile() {
    return new MarkdownDef({
      id: 'http://example.com/docs/notes.md',
      url: 'http://example.com/docs/notes.md',
      sourceUrl: 'http://example.com/docs/notes.md',
      name: 'notes.md',
      contentType: 'text/markdown',
      title: 'Field Notes',
      content: '# Field Notes\n\nSome **important** prose.',
    });
  }

  function assertNoShellChrome(assert: Assert) {
    assert.dom('[data-test-file-atom]').doesNotExist('no atom shell');
    assert.dom('[data-test-file-embedded]').doesNotExist('no embedded shell');
    assert.dom('[data-test-file-fitted]').doesNotExist('no fitted shell');
    assert.dom('[data-test-file-isolated]').doesNotExist('no isolated shell');
    assert
      .dom('[data-test-file-preview-stage]')
      .doesNotExist('no preview stage');
    assert.dom('[data-test-file-download]').doesNotExist('no download action');
    assert
      .dom('[data-test-file-copy-link]')
      .doesNotExist('no copy-link action');
  }

  test('the barrel exports the content-only components and their helpers', async function (assert) {
    assert.ok(fileFormats.MarkdownPreview, 'MarkdownPreview is exported');
    assert.ok(fileFormats.ImagePreview, 'ImagePreview is exported');
    assert.ok(fileFormats.AudioPreview, 'AudioPreview is exported');
    assert.ok(fileFormats.VideoPreview, 'VideoPreview is exported');
    assert.ok(
      fileFormats.filePreviewComponentFor,
      'filePreviewComponentFor is exported',
    );
    assert.ok(
      fileFormats.ensureFileViewModel,
      'ensureFileViewModel is exported',
    );
  });

  test('filePreviewComponentFor dispatches to the renderer the file class declares', async function (assert) {
    assert.strictEqual(
      fileFormats.filePreviewComponentFor(makeMarkdownFile()),
      fileFormats.MarkdownPreview,
      'a markdown file dispatches to MarkdownPreview',
    );
    assert.strictEqual(
      fileFormats.filePreviewComponentFor(
        new ImageDef({ name: 'hero.png', contentType: 'image/png' }),
      ),
      fileFormats.ImagePreview,
      'an image file dispatches to ImagePreview',
    );
    assert.strictEqual(
      fileFormats.filePreviewComponentFor(
        new VideoDef({ name: 'demo.mp4', contentType: 'video/mp4' }),
      ),
      fileFormats.VideoPreview,
      'a video file dispatches to VideoPreview',
    );
  });

  test('VideoPreview mounts a native player from a bare FileDef instance', async function (assert) {
    let { VideoPreview } = fileFormats;
    let file = new VideoDef({
      id: 'http://example.com/clips/demo.mp4',
      url: 'http://example.com/clips/demo.mp4',
      sourceUrl: 'http://example.com/clips/demo.mp4',
      name: 'demo.mp4',
      contentType: 'video/mp4',
    });
    await renderComponent(
      <template><VideoPreview @model={{file}} /></template>,
    );
    assert
      .dom('[data-test-video-player]')
      .exists('mounts a native video player');
    assert
      .dom('[data-test-video-preview]')
      .hasAttribute('data-mode', 'embedded', "mode defaults to 'embedded'");
    assertNoShellChrome(assert);
  });

  test('VideoPreview in fitted mode shows the glyph fallback, not a player', async function (assert) {
    let { VideoPreview } = fileFormats;
    let file = new VideoDef({
      id: 'http://example.com/clips/demo.mp4',
      url: 'http://example.com/clips/demo.mp4',
      sourceUrl: 'http://example.com/clips/demo.mp4',
      name: 'demo.mp4',
      contentType: 'video/mp4',
    });
    await renderComponent(
      <template><VideoPreview @model={{file}} @format='fitted' /></template>,
    );
    assert.dom('[data-test-video-fitted]').exists();
    assert
      .dom('[data-test-video-player]')
      .doesNotExist('a fitted cell never mounts a player');
    assertNoShellChrome(assert);
  });

  test('MarkdownPreview renders the file content from a bare FileDef instance', async function (assert) {
    let { MarkdownPreview } = fileFormats;
    let file = makeMarkdownFile();
    await renderComponent(
      <template><MarkdownPreview @model={{file}} /></template>,
    );
    assert.dom('[data-test-markdown-preview] h1').hasText('Field Notes');
    assert.dom('[data-test-markdown-preview] strong').hasText('important');
    assert
      .dom('[data-test-markdown-preview]')
      .hasAttribute('data-mode', 'embedded', "mode defaults to 'embedded'");
    assertNoShellChrome(assert);
  });

  test('MarkdownPreview accepts a prebuilt view model', async function (assert) {
    let { MarkdownPreview, fileProfileSource, fileViewModel } = fileFormats;
    let file = makeMarkdownFile();
    let viewModel = fileViewModel(file, 'isolated', fileProfileSource(file));
    await renderComponent(
      <template>
        <MarkdownPreview @model={{viewModel}} @format='isolated' />
      </template>,
    );
    assert.dom('[data-test-markdown-preview] h1').hasText('Field Notes');
    assert
      .dom('[data-test-markdown-preview]')
      .hasAttribute('data-mode', 'isolated');
    assertNoShellChrome(assert);
  });

  test('MarkdownPreview in fitted mode renders the budgeted snippet rendition', async function (assert) {
    let { MarkdownPreview, FITTED_TEXT_LINE_BUDGET } = fileFormats;
    // A fixture longer than the fitted line budget, so this test pins that
    // `@format` flows through `ensureFileViewModel` into the projection-time
    // budget — not just the branch selection the class name reflects. The
    // heading occupies line one, so items 1..(budget - 1) survive the cut.
    let content = [
      '# Field Notes',
      ...Array.from(
        { length: FITTED_TEXT_LINE_BUDGET + 6 },
        (_, i) => `- budget line ${i + 1}`,
      ),
    ].join('\n');
    let file = new MarkdownDef({
      id: 'http://example.com/docs/notes.md',
      url: 'http://example.com/docs/notes.md',
      sourceUrl: 'http://example.com/docs/notes.md',
      name: 'notes.md',
      contentType: 'text/markdown',
      title: 'Field Notes',
      content,
    });
    await renderComponent(
      <template><MarkdownPreview @model={{file}} @format='fitted' /></template>,
    );
    assert
      .dom('[data-test-markdown-preview]')
      .hasClass('md-preview--fitted', 'the fitted rendition is selected');
    assert.dom('[data-test-markdown-preview] h1').hasText('Field Notes');
    assert
      .dom('[data-test-markdown-preview]')
      .includesText(
        `budget line ${FITTED_TEXT_LINE_BUDGET - 1}`,
        'the last line inside the budget is rendered',
      );
    assert
      .dom('[data-test-markdown-preview]')
      .doesNotIncludeText(
        `budget line ${FITTED_TEXT_LINE_BUDGET}`,
        'lines beyond the fitted budget are cut at projection time',
      );
  });

  test('MarkdownPreview reflects its format as a class on the container', async function (assert) {
    let { MarkdownPreview } = fileFormats;
    let file = makeMarkdownFile();
    await renderComponent(
      <template>
        <MarkdownPreview @model={{file}} @format='isolated' />
      </template>,
    );
    assert.dom('[data-test-markdown-preview]').hasClass('md-preview');
    assert.dom('[data-test-markdown-preview]').hasClass('md-preview--full');
    assert
      .dom('[data-test-markdown-preview]')
      .hasClass('md-preview--isolated', 'the format lands as a class');
  });

  test('MarkdownPreview only reflects known formats as classes', async function (assert) {
    let { MarkdownPreview } = fileFormats;
    let file = makeMarkdownFile();
    // `@format` arrives from dynamic card code, so an arbitrary string must
    // not be interpolated into the class attribute.
    let bogusFormat = 'bogus' as FileFormatsModule.FileFormat;
    await renderComponent(
      <template>
        <MarkdownPreview @model={{file}} @format={{bogusFormat}} />
      </template>,
    );
    assert
      .dom('[data-test-markdown-preview]')
      .doesNotHaveClass('md-preview--bogus', 'no class for an unknown format');
    assert
      .dom('[data-test-markdown-preview] h1')
      .hasText('Field Notes', 'the content still renders');
  });

  test('MarkdownPreview can opt out of its container styles', async function (assert) {
    let { MarkdownPreview } = fileFormats;
    let file = makeMarkdownFile();
    await renderComponent(
      <template>
        <MarkdownPreview @model={{file}} @displayContainer={{false}} />
      </template>,
    );
    assert
      .dom('[data-test-markdown-preview]')
      .doesNotHaveClass('md-preview', 'no pane surface');
    assert
      .dom('[data-test-markdown-preview]')
      .doesNotHaveClass('md-preview--full', 'no reading-format padding');
    assert
      .dom('[data-test-markdown-preview] h1')
      .hasText('Field Notes', 'the content renders the same');
  });

  test('ImagePreview renders a native <img> from a bare FileDef instance', async function (assert) {
    let { ImagePreview } = fileFormats;
    let image = new ImageDef({
      id: 'http://example.com/img/hero.png',
      url: 'http://example.com/img/hero.png',
      sourceUrl: 'http://example.com/img/hero.png',
      name: 'hero.png',
      contentType: 'image/png',
      width: 640,
      height: 480,
    });
    await renderComponent(
      <template>
        {{! The component fills its nearest positioned ancestor (the same
        contract it has inside the shells' stage), so the embedding author
        supplies the frame. }}
        {{! template-lint-disable no-inline-styles }}
        <div style='position: relative; width: 200px; height: 150px;'>
          <ImagePreview @model={{image}} />
        </div>
      </template>,
    );
    assert.dom('img[data-test-image-preview]').exists();
    assert
      .dom('img[data-test-image-preview]')
      .hasAttribute(
        'data-image-fit',
        'scale-down',
        'the default embedded mode never crops or upscales',
      );
    assert
      .dom('img[data-test-image-preview]')
      .hasAttribute('alt', 'hero.png', 'reading formats describe the image');
    assertNoShellChrome(assert);
  });

  test('ImagePreview assembles srcset from the captured rendition slots', async function (assert) {
    let { ImagePreview } = fileFormats;
    // A wire-shape model carrying the same `screenshotsMeta` key a FileDef
    // instance exposes: the reading formats offer the captured renditions as
    // narrower candidates with the original as the largest.
    let image = {
      id: 'http://example.com/img/hero.png',
      url: 'http://example.com/img/hero.png',
      name: 'hero.png',
      contentType: 'image/png',
      width: 3000,
      height: 2250,
      screenshotsMeta: {
        thumb: {
          url: 'http://example.com/_screenshot/img/hero.png?name=thumb',
          width: 170,
          height: 250,
          deviceScaleFactor: 2,
          useAsThumbnail: true,
        },
        'rendition-640': {
          url: 'http://example.com/_screenshot/img/hero.png?name=rendition-640',
          width: 640,
          height: 480,
          deviceScaleFactor: 1,
        },
        'rendition-1280': {
          url: 'http://example.com/_screenshot/img/hero.png?name=rendition-1280',
          width: 1280,
          height: 960,
          deviceScaleFactor: 1,
        },
      },
    };
    await renderComponent(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style='position: relative; width: 200px; height: 150px;'>
          <ImagePreview @model={{image}} />
        </div>
      </template>,
    );
    let srcset =
      find('img[data-test-image-preview]')?.getAttribute('srcset') ?? '';
    assert.ok(
      srcset.includes('?name=rendition-640 640w'),
      `the small rendition is a candidate (got: ${srcset})`,
    );
    assert.ok(
      srcset.includes('?name=rendition-1280 1280w'),
      'the large rendition is a candidate',
    );
    assert.ok(
      srcset.includes('http://example.com/img/hero.png 3000w'),
      'the original is the largest candidate',
    );
    assert.notOk(
      srcset.includes('?name=thumb'),
      'the cover-cropped thumb is not a srcset candidate',
    );
    assert
      .dom('img[data-test-image-preview]')
      .hasAttribute('sizes', '100vw', 'w descriptors carry a sizes hint');
  });

  test('ImagePreview offers no srcset for animated or vector sources', async function (assert) {
    let { ImagePreview } = fileFormats;
    // A GIF with no extracted verdict may animate, and a rendition of it is a
    // still of its first frame — substituting it in a reading format would
    // silently drop the animation.
    let gif = {
      id: 'http://example.com/img/loop.gif',
      url: 'http://example.com/img/loop.gif',
      name: 'loop.gif',
      contentType: 'image/gif',
      width: 3000,
      height: 2250,
      screenshotsMeta: {
        'rendition-640': {
          url: 'http://example.com/_screenshot/img/loop.gif?name=rendition-640',
          width: 640,
          height: 480,
          deviceScaleFactor: 1,
        },
      },
    };
    await renderComponent(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style='position: relative; width: 200px; height: 150px;'>
          <ImagePreview @model={{gif}} />
        </div>
      </template>,
    );
    assert.dom('img[data-test-image-preview]').doesNotHaveAttribute('srcset');
    assert.dom('img[data-test-image-preview]').doesNotHaveAttribute('sizes');
  });

  // A 4:3 image large enough for both renditions, so animation is the only
  // thing that can keep srcset off.
  function renditionReadyImage(
    fileName: string,
    contentType: string,
    animation?: 'animated' | 'still',
  ) {
    let url = `http://example.com/img/${fileName}`;
    return {
      id: url,
      url,
      name: fileName,
      contentType,
      width: 3000,
      height: 2250,
      ...(animation ? { animation } : {}),
      screenshotsMeta: {
        'rendition-640': {
          url: `http://example.com/_screenshot/img/${fileName}?name=rendition-640`,
          width: 640,
          height: 480,
          deviceScaleFactor: 1,
        },
      },
    };
  }

  async function renderImagePreview(image: object) {
    let { ImagePreview } = fileFormats;
    await renderComponent(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style='position: relative; width: 200px; height: 150px;'>
          <ImagePreview @model={{image}} />
        </div>
      </template>,
    );
  }

  test('ImagePreview offers no srcset for an animated WebP or AVIF', async function (assert) {
    // A rendition of an animated file is a frozen first frame.
    await renderImagePreview(
      renditionReadyImage('loop.webp', 'image/webp', 'animated'),
    );
    assert.dom('img[data-test-image-preview]').doesNotHaveAttribute('srcset');

    await renderImagePreview(
      renditionReadyImage('loop.avif', 'image/avif', 'animated'),
    );
    assert.dom('img[data-test-image-preview]').doesNotHaveAttribute('srcset');
  });

  test('ImagePreview offers no srcset for a WebP or AVIF not known to be a still', async function (assert) {
    // No extracted verdict — a reader that couldn't tell, or a row that
    // predates the field — is treated as possibly animated for these
    // animation-capable containers.
    await renderImagePreview(renditionReadyImage('photo.webp', 'image/webp'));
    assert.dom('img[data-test-image-preview]').doesNotHaveAttribute('srcset');

    await renderImagePreview(renditionReadyImage('photo.avif', 'image/avif'));
    assert.dom('img[data-test-image-preview]').doesNotHaveAttribute('srcset');
  });

  test('ImagePreview offers srcset for a WebP, AVIF, or GIF known to be a still', async function (assert) {
    for (let [fileName, contentType] of [
      ['photo.webp', 'image/webp'],
      ['photo.avif', 'image/avif'],
      ['diagram.gif', 'image/gif'],
    ]) {
      await renderImagePreview(
        renditionReadyImage(fileName!, contentType!, 'still'),
      );
      let srcset =
        find('img[data-test-image-preview]')?.getAttribute('srcset') ?? '';
      assert.ok(
        srcset.includes(`${fileName}?name=rendition-640 640w`),
        `a still ${contentType} offers its rendition (got: ${srcset})`,
      );
    }
  });

  test('ImagePreview offers no srcset for an animated PNG, and keeps it for a PNG with no verdict', async function (assert) {
    // APNG is the exception among PNGs, so only a positive finding excludes
    // one; an unknown PNG keeps srcset.
    await renderImagePreview(
      renditionReadyImage('spinner.png', 'image/png', 'animated'),
    );
    assert.dom('img[data-test-image-preview]').doesNotHaveAttribute('srcset');

    await renderImagePreview(renditionReadyImage('photo.png', 'image/png'));
    assert
      .dom('img[data-test-image-preview]')
      .hasAttribute('srcset', /rendition-640 640w/);
  });

  test('ImagePreview offers no srcset for images narrower than the rendition canvas', async function (assert) {
    let { ImagePreview } = fileFormats;
    // The renditions' canvas is 4:3 with the image contained inside; under
    // scale-down the browser sizes the canvas, so a portrait image's
    // rendition would display at a fraction of the original's size.
    let portrait = {
      id: 'http://example.com/img/tall.png',
      url: 'http://example.com/img/tall.png',
      name: 'tall.png',
      contentType: 'image/png',
      width: 2250,
      height: 3000,
      screenshotsMeta: {
        'rendition-640': {
          url: 'http://example.com/_screenshot/img/tall.png?name=rendition-640',
          width: 640,
          height: 480,
          deviceScaleFactor: 1,
        },
        'rendition-1280': {
          url: 'http://example.com/_screenshot/img/tall.png?name=rendition-1280',
          width: 1280,
          height: 960,
          deviceScaleFactor: 1,
        },
      },
    };
    await renderComponent(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style='position: relative; width: 200px; height: 150px;'>
          <ImagePreview @model={{portrait}} />
        </div>
      </template>,
    );
    assert.dom('img[data-test-image-preview]').doesNotHaveAttribute('srcset');
    assert.dom('img[data-test-image-preview]').doesNotHaveAttribute('sizes');
  });

  test('PdfViewer hands its fetched document to the object as a blob URL in live renders', async function (assert) {
    let loader: Loader = getService('loader-service').loader;
    let { PdfViewer } = await loader.import<any>(
      `${baseRealm.url}file-formats/pdf-viewer`,
    );
    // A native <object>'s own fetch bypasses service workers, so the viewer
    // fetches the bytes itself and hands the object a blob URL. A data: URL
    // stands in for the realm document — the fetch path is identical, no
    // auth needed. What this pins is the fetch→blob handoff only: the
    // Authorization injection that motivates it lives in the host auth
    // service worker, and `isServiceWorkerSupported()` short-circuits under
    // `isTesting()`, so the authed private-realm leg has no test coverage —
    // a green run here says nothing about it.
    let pdfB64 =
      'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1MiAwMDAwMCBuIAowMDAwMDAwMTAxIDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTY0CiUlRU9G';
    let model = {
      url: `data:application/pdf;base64,${pdfB64}`,
      name: 'doc.pdf',
      contentType: 'application/pdf',
    };
    await renderComponent(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style='position: relative; width: 400px; height: 300px;'>
          <PdfViewer @model={{model}} @format='isolated' />
        </div>
      </template>,
    );
    // The object is withheld until the fetch settles (no unauthenticated
    // flash), then mounts with the blob-backed document.
    await waitUntil(() => find('[data-test-pdf-viewer]'), { timeout: 10000 });
    let data = find('[data-test-pdf-viewer]')?.getAttribute('data') ?? '';
    assert.ok(
      data.startsWith('blob:'),
      `the object loads the fetched blob, not the plain URL (got: ${data})`,
    );
  });

  test('PdfViewer falls back to the plain URL when its fetch cannot get the bytes', async function (assert) {
    let loader: Loader = getService('loader-service').loader;
    let { PdfViewer } = await loader.import<any>(
      `${baseRealm.url}file-formats/pdf-viewer`,
    );
    // An anonymous visitor on a public realm has no session for the viewer's
    // fetch to ride; the plain URL is the working path there, so a failed
    // fetch must fall back to it rather than rendering nothing.
    let model = {
      url: '/definitely-not-here.pdf',
      name: 'missing.pdf',
      contentType: 'application/pdf',
    };
    await renderComponent(
      <template>
        {{! template-lint-disable no-inline-styles }}
        <div style='position: relative; width: 400px; height: 300px;'>
          <PdfViewer @model={{model}} @format='isolated' />
        </div>
      </template>,
    );
    await waitUntil(() => find('[data-test-pdf-viewer]'), { timeout: 10000 });
    let data = find('[data-test-pdf-viewer]')?.getAttribute('data') ?? '';
    assert.ok(
      data.endsWith('/definitely-not-here.pdf'),
      `the object falls back to the plain URL (got: ${data})`,
    );
  });

  test('AudioPreview renders the waveform and player from a bare FileDef instance', async function (assert) {
    let { AudioPreview } = fileFormats;
    let audio = new AudioDef({
      id: 'http://example.com/audio/take.wav',
      url: 'http://example.com/audio/take.wav',
      sourceUrl: 'http://example.com/audio/take.wav',
      name: 'take.wav',
      contentType: 'audio/wav',
      contentSize: 2_646_078,
      duration: 10,
      waveform: new WaveformMetadataField({
        decodeStatus: 'ok',
        barsJson: JSON.stringify(Array.from({ length: 32 }, () => 0.5)),
        barCount: 32,
      }),
    });
    await renderComponent(
      <template><AudioPreview @model={{audio}} /></template>,
    );
    assert
      .dom('[data-test-audio-preview]')
      .hasAttribute('data-mode', 'embedded', "mode defaults to 'embedded'");
    assert.dom('[data-test-audio-preview] .wave-svg').exists();
    assert.dom('[data-test-audio-player]').exists();
    assert.dom('[data-test-audio-duration]').hasText('0:10');
    assertNoShellChrome(assert);
  });
});
