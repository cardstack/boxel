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
