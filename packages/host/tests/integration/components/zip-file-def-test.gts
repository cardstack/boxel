import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as ZipFileDefModule from '@cardstack/base/zip-file-def';

// ZipDef supplies only an archive `previewComponent`; the four shared shells own
// identity, facts, budgets, and state. These tests pin the things unique to the
// archive family: that the renderer mounts into every shell, that it draws a
// folder tree in the reading formats and a compact summary in the budgeted
// fitted cell, that the isolated inspector lists the entry field, and that
// `extractAttributes` reads a real archive's central directory.
module('Integration | zip file def', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let ZipDef: typeof ZipFileDefModule.ZipDef;
  let ArchiveEntryField: typeof ZipFileDefModule.ArchiveEntryField;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    // Both classes must come from the same loader-sourced module: containsMany
    // validates entries with instanceof against the loader's copy, so a
    // statically imported ArchiveEntryField would fail validation.
    ({ ZipDef, ArchiveEntryField } = await loader.import<
      typeof ZipFileDefModule
    >(`${baseRealm.url}zip-file-def`));
  });

  function zipFile() {
    return new ZipDef({
      id: 'http://example.com/archives/project.zip',
      url: 'http://example.com/archives/project.zip',
      sourceUrl: 'http://example.com/archives/project.zip',
      name: 'project.zip',
      contentType: 'application/zip',
      contentSize: 2048,
      archiveContents: [
        new ArchiveEntryField({ path: 'README.md', size: 120 }),
        new ArchiveEntryField({ path: 'src/index.ts', size: 340 }),
        new ArchiveEntryField({ path: 'src/util/helpers.ts', size: 88 }),
      ],
      uncompressedSize: 548,
    });
  }

  for (let format of ['isolated', 'embedded', 'fitted', 'atom'] as const) {
    test(`the archive renderer mounts into the ${format} shell`, async function (assert) {
      await renderCard(loader, zipFile(), format);
      assert
        .dom(`[data-test-file-${format}]`)
        .exists(`${format} shell renders`);
      if (format === 'atom') {
        // Atom is an identity chip — a name and a glyph, no contents listing.
        assert.dom('[data-test-file-atom]').containsText('project');
        assert.dom('[data-test-archive-preview]').doesNotExist();
      } else {
        assert
          .dom('[data-test-archive-preview]')
          .exists('archive preview mounts');
      }
    });
  }

  test('the reading formats draw a folder tree with files and folders', async function (assert) {
    await renderCard(loader, zipFile(), 'embedded');
    assert.dom('[data-test-archive-preview][data-mode="embedded"]').exists();
    // `src` and `src/util` become folder rows; the three files become file rows.
    assert
      .dom('[data-test-archive-tree-row="dir"]')
      .exists({ count: 2 }, 'two folder rows (src, util)');
    assert
      .dom('[data-test-archive-tree-row="file"]')
      .exists({ count: 3 }, 'three file rows');
    assert.dom('[data-test-archive-preview]').containsText('README.md');
    assert.dom('[data-test-archive-preview]').containsText('helpers.ts');
  });

  test('the fitted cell shows a compact entry-count and size summary, not the tree', async function (assert) {
    await renderCard(loader, zipFile(), 'fitted');
    assert.dom('[data-test-archive-preview][data-mode="fitted"]').exists();
    assert
      .dom('[data-test-archive-preview]')
      .containsText('3 entries', 'the entry count is summarized');
    // A budgeted cell lists leading names but never draws the full tree.
    assert.dom('[data-test-archive-tree-row]').doesNotExist();
  });

  test('the fitted shell surfaces the entry count as its hero fact', async function (assert) {
    await renderCard(loader, zipFile(), 'fitted');
    assert.dom('[data-test-file-fitted]').containsText('3 entries');
    assert.dom('[data-test-file-kind]').containsText('ZIP archive');
  });

  test('the isolated inspector lists the archive entries through the entry field', async function (assert) {
    await renderCard(loader, zipFile(), 'isolated');
    assert.dom('[data-test-file-isolated]').containsText('Archive contents');
    assert
      .dom('[data-test-archive-entry]')
      .exists({ count: 3 }, 'each entry renders as a field row');
    assert.dom('[data-test-archive-entry]').containsText('README.md');
  });

  test('an empty archive reads as an honest empty listing', async function (assert) {
    let file = new ZipDef({
      id: 'http://example.com/archives/empty.zip',
      url: 'http://example.com/archives/empty.zip',
      sourceUrl: 'http://example.com/archives/empty.zip',
      name: 'empty.zip',
      contentType: 'application/zip',
      contentSize: 22,
      archiveContents: [],
      uncompressedSize: 0,
    });
    await renderCard(loader, file, 'embedded');
    assert.dom('[data-test-archive-preview]').containsText('Empty archive');
    assert.dom('[data-test-archive-tree-row]').doesNotExist();
  });

  test('extractAttributes reads the central directory of a real archive', async function (assert) {
    // A minimal stored (uncompressed) ZIP holding two files, built inline so the
    // extractor runs against a real central directory rather than seeded fields.
    let zip = buildStoredZip([
      { name: 'notes.txt', size: 11 },
      { name: 'assets/logo.txt', size: 5 },
    ]);

    let result = await ZipDef.extractAttributes(
      'http://example.com/archives/real.zip',
      async () => zip,
    );

    assert.deepEqual(
      (result.archiveContents ?? []).map((e) => e.path),
      ['notes.txt', 'assets/logo.txt'],
      'both files are listed from the archive',
    );
    assert.strictEqual(result.uncompressedSize, 16, 'total uncompressed size');
    assert.notOk(result.truncatedListing, 'a small archive is not truncated');
  });

  test('extractAttributes rejects a non-zip extension so the base falls back', async function (assert) {
    await assert.rejects(
      ZipDef.extractAttributes(
        'http://example.com/archives/photo.png',
        async () => new Uint8Array(0),
      ),
      /Expected a \.zip file/,
    );
  });
});

// A tiny stored-ZIP builder for the extract test: local headers + central
// directory + EOCD, no compression.
function buildStoredZip(files: { name: string; size: number }[]): Uint8Array {
  let encoder = new TextEncoder();
  let locals: Uint8Array[] = [];
  let centrals: Uint8Array[] = [];
  let offset = 0;

  for (let file of files) {
    let name = encoder.encode(file.name);
    let data = new Uint8Array(file.size);

    let local = new Uint8Array(30 + name.length + data.length);
    let lv = new DataView(local.buffer);
    lv.setUint32(0, 0x0403_4b50, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    let central = new Uint8Array(46 + name.length);
    let cv = new DataView(central.buffer);
    cv.setUint32(0, 0x0201_4b50, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  let centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  let eocd = new Uint8Array(22);
  let ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x0605_4b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  let out = new Uint8Array(offset + centralSize + eocd.length);
  let cursor = 0;
  for (let chunk of [...locals, ...centrals, eocd]) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}
