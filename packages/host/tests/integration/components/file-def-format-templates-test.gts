import type { RenderingTestContext } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as CardApiModule from '@cardstack/base/card-api';
import type { FilePreviewSignature } from '@cardstack/base/file-formats/file-preview-stage';

module('Integration | FileDef format templates', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let FileDef: typeof CardApiModule.FileDef;
  let ImageDef: typeof CardApiModule.ImageDef;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    let cardApiModule = await loader.import<typeof CardApiModule>(
      `${baseRealm.url}card-api`,
    );
    FileDef = cardApiModule.FileDef;
    ImageDef = cardApiModule.ImageDef;
  });

  function makeFile(overrides: Record<string, unknown> = {}) {
    return new FileDef({
      id: 'http://example.com/docs/report.pdf',
      url: 'http://example.com/docs/report.pdf',
      sourceUrl: 'http://example.com/docs/report.pdf',
      name: 'report.pdf',
      contentType: 'application/pdf',
      contentSize: 12_345,
      ...overrides,
    });
  }

  test('atom renders the file identity as name plus extension pill', async function (assert) {
    await renderCard(loader, makeFile(), 'atom');
    assert.dom('[data-test-file-atom]').containsText('report');
    assert.dom('[data-test-file-atom]').containsText('.PDF');
    assert.dom('[data-test-file-embedded]').doesNotExist();
    assert.dom('[data-test-file-fitted]').doesNotExist();
    assert.dom('[data-test-file-isolated]').doesNotExist();
  });

  test('embedded renders the embedded shell with the file identity', async function (assert) {
    await renderCard(loader, makeFile(), 'embedded');
    assert.dom('[data-test-file-embedded]').containsText('report');
    assert.dom('[data-test-file-embedded]').containsText('.PDF');
    assert.dom('[data-test-file-atom]').doesNotExist();
    assert.dom('[data-test-file-fitted]').doesNotExist();
    assert.dom('[data-test-file-isolated]').doesNotExist();
  });

  test('fitted renders the fitted shell with the file identity', async function (assert) {
    await renderCard(loader, makeFile(), 'fitted');
    assert.dom('[data-test-file-fitted]').containsText('report');
    assert.dom('[data-test-file-fitted]').containsText('.PDF');
    assert.dom('[data-test-file-atom]').doesNotExist();
    assert.dom('[data-test-file-embedded]').doesNotExist();
    assert.dom('[data-test-file-isolated]').doesNotExist();
  });

  test('isolated renders the isolated shell with the file identity', async function (assert) {
    await renderCard(loader, makeFile(), 'isolated');
    assert.dom('[data-test-file-isolated]').containsText('report');
    assert.dom('[data-test-file-isolated]').containsText('.PDF');
    assert.dom('[data-test-file-atom]').doesNotExist();
    assert.dom('[data-test-file-embedded]').doesNotExist();
    assert.dom('[data-test-file-fitted]').doesNotExist();
  });

  // A generic FileDef standing in for a format with no subclass yet should
  // still be named by what it actually is. `displayName` ('File') is the
  // weaker signal, so the taxonomy registry wins.
  test('the recognized format names the file, not the base class displayName', async function (assert) {
    await renderCard(loader, makeFile(), 'fitted');
    assert.dom('[data-test-file-kind]').hasText('PDF document');
  });

  test('an unrecognized extension falls back to an honest generic kind', async function (assert) {
    let file = makeFile({
      id: 'http://example.com/docs/telemetry.qqq',
      url: 'http://example.com/docs/telemetry.qqq',
      sourceUrl: 'http://example.com/docs/telemetry.qqq',
      name: 'telemetry.qqq',
      contentType: undefined,
    });
    await renderCard(loader, file, 'fitted');
    assert.dom('[data-test-file-kind]').hasText('QQQ file');
  });

  test('isolated exposes download and copy-link actions and the parsed facts', async function (assert) {
    await renderCard(loader, makeFile(), 'isolated');
    assert
      .dom('[data-test-file-download]')
      .hasAttribute('href', 'http://example.com/docs/report.pdf')
      .hasAttribute('download', 'report.pdf');
    assert.dom('[data-test-file-copy-link]').hasText('Copy link');
    assert.dom('[data-test-file-isolated]').containsText('application/pdf');
    assert.dom('[data-test-file-isolated]').containsText('12,345 bytes');
  });

  test('a file with no resource URL renders no download action', async function (assert) {
    let file = new FileDef({ name: 'orphan.pdf' });
    await renderCard(loader, file, 'isolated');
    assert.dom('[data-test-file-isolated]').exists();
    assert.dom('[data-test-file-download]').doesNotExist();
    assert.dom('[data-test-file-copy-link]').doesNotExist();
  });

  // A family that hasn't landed a renderer yet must degrade to an honest pane
  // rather than a broken one.
  test('a family with no preview component renders the generic pane', async function (assert) {
    await renderCard(loader, makeFile(), 'embedded');
    assert.dom('[data-test-file-no-preview]').exists();
    assert.dom('[data-test-file-no-preview]').containsText('No preview');
  });

  test('a family preview component is mounted into the stage', async function (assert) {
    // A family renderer receives the projected view model and the shell that
    // is rendering it, so it can draw differently per format.
    class ReportPreview extends GlimmerComponent<FilePreviewSignature> {
      get summary() {
        return `Report preview for ${this.args.model.name} in ${this.args.mode}`;
      }

      <template>
        <div data-test-report-preview>{{this.summary}}</div>
      </template>
    }

    class ReportDef extends FileDef {
      static displayName = 'Report';
      static previewComponent = ReportPreview;
    }

    let file = new ReportDef({
      id: 'http://example.com/docs/report.pdf',
      url: 'http://example.com/docs/report.pdf',
      sourceUrl: 'http://example.com/docs/report.pdf',
      name: 'report.pdf',
      contentType: 'application/pdf',
    });
    await renderCard(loader, file, 'embedded');
    assert
      .dom('[data-test-report-preview]')
      .containsText('Report preview for report.pdf in embedded');
    assert.dom('[data-test-file-no-preview]').doesNotExist();
  });

  test('a zero-byte file reports the empty state in both the chip and the stage', async function (assert) {
    await renderCard(loader, makeFile({ contentSize: 0 }), 'fitted');
    assert.dom('[data-test-file-state-chip]').hasText('EMPTY');
    assert
      .dom('[data-test-file-preview-stage]')
      .hasAttribute('data-file-state', 'empty');
    assert
      .dom('[data-test-file-preview-stage]')
      .containsText('0 bytes · empty');
  });

  test('image-file embeds still render via ImageDef, not the shared FileDef shell', async function (assert) {
    let image = new ImageDef({
      id: 'http://example.com/img/hero.png',
      url: 'http://example.com/img/hero.png',
      sourceUrl: 'http://example.com/img/hero.png',
      name: 'hero.png',
      contentType: 'image/png',
    });
    await renderCard(loader, image, 'embedded');
    assert
      .dom('img')
      .exists('ImageDef embedded renders an <img>, not the file affordance');
    assert.dom('[data-test-file-embedded]').doesNotExist();
  });
});
