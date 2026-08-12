import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as CardApiModule from '@cardstack/base/card-api';

// A file whose extension has no dedicated FileDef subclass instantiates the
// base FileDef and routes through the four shared shells with the generic
// taxonomy profile. These tests pin the graceful fallback: identity (icon +
// name + type + size) in every format, and a download/open affordance in the
// reading formats.
module('Integration | generic file def fallback preview', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let FileDef: typeof CardApiModule.FileDef;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    FileDef = (
      await loader.import<typeof CardApiModule>(`${baseRealm.url}card-api`)
    ).FileDef;
  });

  function binaryFile(overrides: Record<string, unknown> = {}) {
    return new FileDef({
      id: 'http://example.com/fw/firmware.bin',
      url: 'http://example.com/fw/firmware.bin',
      sourceUrl: 'http://example.com/fw/firmware.bin',
      name: 'firmware.bin',
      contentType: 'application/octet-stream',
      contentSize: 262_144,
      ...overrides,
    });
  }

  test('atom names the binary file and its extension', async function (assert) {
    await renderCard(loader, binaryFile(), 'atom');
    assert.dom('[data-test-file-atom]').containsText('firmware');
    assert.dom('[data-test-file-atom]').containsText('.BIN');
  });

  test('fitted labels the unknown-binary kind and size', async function (assert) {
    await renderCard(loader, binaryFile(), 'fitted');
    assert.dom('[data-test-file-fitted]').exists();
    assert.dom('[data-test-file-kind]').hasText('Unknown binary');
    assert.dom('[data-test-file-fitted]').containsText('256.0 KB');
    // The budgeted cell has the metadata strip beside it, so its pane stays a
    // bare glyph rather than a labeled card.
    assert.dom('[data-test-file-no-preview]').containsText('No preview');
    assert.dom('[data-test-file-generic-name]').doesNotExist();
  });

  test('embedded presents identity plus a download affordance', async function (assert) {
    await renderCard(loader, binaryFile(), 'embedded');
    // The embedded shell header carries the identity...
    assert.dom('[data-test-file-embedded]').containsText('firmware');
    assert.dom('[data-test-file-embedded]').containsText('.BIN');
    // ...and the fallback pane names the file, its kind and size, and offers
    // the bytes — the only reading format whose shell has no download of its
    // own.
    assert.dom('[data-test-file-generic-name]').hasText('firmware.bin');
    assert.dom('[data-test-file-generic-kind]').hasText('Unknown binary');
    assert.dom('[data-test-file-generic-size]').containsText('256.0 KB');
    assert
      .dom('[data-test-file-generic-download]')
      .hasAttribute('href', 'http://example.com/fw/firmware.bin')
      .hasAttribute('download', 'firmware.bin');
  });

  test('isolated exposes a download/open affordance and the file facts', async function (assert) {
    await renderCard(loader, binaryFile(), 'isolated');
    assert
      .dom('[data-test-file-download]')
      .hasAttribute('href', 'http://example.com/fw/firmware.bin')
      .hasAttribute('download', 'firmware.bin');
    assert.dom('[data-test-file-copy-link]').hasText('Copy link');
    assert.dom('[data-test-file-isolated]').containsText('Unknown binary');
    assert
      .dom('[data-test-file-isolated]')
      .containsText('application/octet-stream');
    // The isolated pane names the file but defers the download to its header
    // rather than showing a second button.
    assert.dom('[data-test-file-generic-name]').hasText('firmware.bin');
    assert
      .dom('[data-test-file-isolated] [data-test-file-generic-download]')
      .doesNotExist();
  });

  test('a file with no resource URL offers no download affordance', async function (assert) {
    await renderCard(loader, binaryFile({ url: undefined }), 'embedded');
    assert.dom('[data-test-file-generic-name]').hasText('firmware.bin');
    assert.dom('[data-test-file-generic-download]').doesNotExist();
  });

  test('an unregistered extension still gets an honest generic kind', async function (assert) {
    let file = binaryFile({
      id: 'http://example.com/data/telemetry.xyz',
      url: 'http://example.com/data/telemetry.xyz',
      sourceUrl: 'http://example.com/data/telemetry.xyz',
      name: 'telemetry.xyz',
      contentType: undefined,
    });
    await renderCard(loader, file, 'embedded');
    assert.dom('[data-test-file-generic-name]').hasText('telemetry.xyz');
    assert.dom('[data-test-file-generic-kind]').hasText('XYZ file');
  });
});
