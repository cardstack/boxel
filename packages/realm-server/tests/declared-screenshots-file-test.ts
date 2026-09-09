import QUnit from 'qunit';
const { module, test } = QUnit;
import { readFileSync } from 'fs';
import { basename } from 'path';
import { fileURLToPath } from 'url';

import {
  declaredCaptureSpecHash,
  putMedia,
  screenshotLedgerSourceURL,
  type ScreenshotManifest,
} from '@cardstack/runtime-common';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import { setupPermissionedRealmCached } from './helpers/index.ts';
import { FakeMediaCacheAdapter } from './helpers/fake-media-cache-adapter.ts';
import {
  maxPrerenderHtmlJobId,
  prerenderedHtmlRowFor,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';

const testRealm = new URL('http://127.0.0.1:4445/test/');

// PNG magic — enough to prove a real capture reached the encoder.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

// Declared screenshots on a FileDef family, captured on the URL's *file* row.
// The `.mismatch` extension resolves its FileDef class from the realm's own
// `./filedef-mismatch` module (the one realm-supplied entry in
// FILEDEF_CODE_REF_BY_EXTENSION), which is what lets this fixture declare a
// family-level poster slot without touching packages/base.
const FILEDEF_MISMATCH_SOURCE = `
      import { FileDef as BaseFileDef } from "@cardstack/base/file-api";
      import { Component, type ScreenshotSpec } from "@cardstack/base/card-api";

      // Capture-only: referenced only from the declaration, rendered only by
      // the screenshot render route.
      class PosterShot extends Component<typeof FileDef> {
        <template>
          <h1>Poster: {{@model.name}}</h1>
        </template>
      }

      export class FileDef extends BaseFileDef {
        static screenshots: Record<string, ScreenshotSpec> = {
          poster: {
            render: PosterShot,
            width: 320,
            height: 240,
            keyBy: 'file-content',
            useAsThumbnail: true,
          },
        };
        // Consumes the declared capture in a display format, so the file
        // row's prerendered HTML proves the render context's
        // declaration-derived meta.screenshots covers file renders: the
        // durable URL must land on the very first pass, when the capture
        // itself runs later in that same pass.
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <div data-poster-url={{@model.screenshotURLs.poster}}>
              File: {{@model.name}}
            </div>
          </template>
        };
      }
    `;

function makeFileSystem() {
  return {
    'filedef-mismatch.gts': FILEDEF_MISMATCH_SOURCE,
    'sample.mismatch': 'poster me',
    // Exercises the image family's own declared slots (ImageDef ships a
    // `thumb` + rendition roster): SVG keeps the fixture textual while still
    // hitting the SvgDef -> ImageDef chain.
    'picture.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#3b82f6"/></svg>`,
  };
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let testDbAdapter: DBAdapter;
  // Module-scoped: the cached fixture rebuilds the DB per test, but the
  // object store is content-addressed so leftovers between tests are
  // harmless.
  let mediaCacheAdapter = new FakeMediaCacheAdapter();

  setupPermissionedRealmCached(hooks, {
    mode: 'beforeEach',
    realmURL: testRealm,
    permissions: {
      '*': ['read'],
    },
    fileSystem: makeFileSystem(),
    mediaCacheAdapter,
    onRealmSetup({ dbAdapter, testRealm: r }) {
      testDbAdapter = dbAdapter;
      realm = r;
    },
  });

  async function writeAndSettle(path: string, content: string | Uint8Array) {
    let baseline = await maxPrerenderHtmlJobId(testDbAdapter, realm.url);
    await realm.write(path, content);
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url, {
      afterJobId: baseline,
      timeout: 60000,
    });
  }

  async function declaredLedgerRows(sourceURL: string) {
    return (await testDbAdapter.execute(
      `select capture_spec_hash, source_generation, object_key, lane, source_content_hash from media_cache_ledger where source_url = $1 order by source_generation, capture_spec_hash`,
      { bind: [sourceURL] },
    )) as unknown as {
      capture_spec_hash: string;
      source_generation: number;
      object_key: string;
      lane: string;
      source_content_hash: string | null;
    }[];
  }

  function objectBytes(objectKey: string): Uint8Array | undefined {
    return mediaCacheAdapter.objects.get(objectKey);
  }

  function startsWith(bytes: Uint8Array | undefined, magic: number[]) {
    return !!bytes && magic.every((b, i) => bytes[i] === b);
  }

  async function posterSpecHash() {
    return await declaredCaptureSpecHash('poster', {
      width: 320,
      height: 240,
      keyBy: 'file-content',
      useAsThumbnail: true,
      render: true,
    });
  }

  test("the prerender-html pass captures a file family's declared screenshots onto the file row", async function (assert) {
    // Distinct from the fixture's bytes: an identical write is a no-op that
    // enqueues no indexing pass for the settle to wait on.
    await writeAndSettle('sample.mismatch', 'poster me, freshly written');

    let fileRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}sample.mismatch`,
      'file',
    );
    assert.ok(fileRow, 'the file row exists');
    let manifest = fileRow!.screenshots as ScreenshotManifest | null;
    assert.ok(manifest, 'the manifest landed on the file row');
    assert.deepEqual(Object.keys(manifest!), ['poster']);

    let poster = manifest!.poster;
    assert.strictEqual(
      poster.specHash,
      await posterSpecHash(),
      'the manifest records the declared capture identity',
    );
    assert.strictEqual(poster.contentType, 'image/png');
    assert.strictEqual(poster.width, 320);
    assert.strictEqual(poster.height, 240);
    assert.true(poster.useAsThumbnail, 'the thumbnail flag rides the manifest');
    assert.ok(
      poster.sourceContentHash,
      'a file-content-keyed slot records the source hash it captured from',
    );

    // The ledger keys the file row's captures on the file's own URL,
    // extension intact — only instance ids shed `.json`. The fixture build
    // captured its own generation's row already (older generations are
    // GC-superseded, not overwritten), so scope to this render's generation.
    let ledger = (
      await declaredLedgerRows(`${testRealm}sample.mismatch`)
    ).filter((row) => row.source_generation === fileRow!.generation);
    assert.strictEqual(
      ledger.length,
      1,
      'one ledger row for the slot at this generation',
    );
    assert.strictEqual(ledger[0].lane, 'declared');
    assert.strictEqual(
      ledger[0].source_content_hash,
      poster.sourceContentHash,
      'the ledger row carries the same source content hash as the manifest',
    );
    assert.ok(
      startsWith(objectBytes(poster.objectKey), PNG_MAGIC),
      'the capture is a PNG',
    );

    let errors = (fileRow!.diagnostics as any)?.screenshotErrors;
    assert.strictEqual(
      errors,
      undefined,
      'no screenshotErrors diagnostics on a clean capture',
    );
  });

  test("the ?name= URL serves a file row's capture and the file-meta GET joins meta.screenshots", async function (assert) {
    await writeAndSettle('sample.mismatch', 'poster me, served');
    let fileRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}sample.mismatch`,
      'file',
    );
    let manifest = fileRow!.screenshots as ScreenshotManifest;

    let imageResponse = await realm.handle(
      new Request(`${testRealm}_screenshot/sample.mismatch?name=poster`),
    );
    assert.strictEqual(
      imageResponse!.status,
      200,
      "the named screenshot URL serves the file row's capture",
    );
    assert.strictEqual(imageResponse!.headers.get('content-type'), 'image/png');
    // The body is a node stream, so the served artifact is pinned by its
    // ETag (the capture content hash) and the bytes verified in the store.
    assert.strictEqual(
      imageResponse!.headers.get('etag'),
      `"${manifest.poster.objectKey}"`,
      'the ETag is the capture content hash',
    );
    assert.ok(
      startsWith(objectBytes(manifest.poster.objectKey), PNG_MAGIC),
      'the served artifact is the PNG',
    );

    let metaResponse = await realm.handle(
      new Request(`${testRealm}sample.mismatch`, {
        headers: { Accept: 'application/vnd.card.file-meta+json' },
      }),
    );
    assert.strictEqual(metaResponse!.status, 200);
    let json = await metaResponse!.json();
    assert.deepEqual(
      json.data.meta.screenshots,
      {
        poster: {
          url: `${testRealm}_screenshot/sample.mismatch?name=poster`,
          hash: manifest.poster.objectKey,
          contentType: 'image/png',
          width: 320,
          height: 240,
          deviceScaleFactor: 2,
          useAsThumbnail: true,
        },
      },
      'the file-meta GET joins the manifest into meta.screenshots',
    );
  });

  test("the file's own prerendered HTML embeds the durable URL via the declaration-derived render context", async function (assert) {
    await writeAndSettle('sample.mismatch', 'poster me, embedded');
    let fileRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}sample.mismatch`,
      'file',
    );
    let embedded = JSON.stringify(fileRow!.embedded_html ?? {});
    assert.ok(
      embedded.includes(`_screenshot/sample.mismatch?name=poster`),
      `the embedded rendering carries the durable capture URL (got: ${embedded.slice(0, 500)})`,
    );
  });

  test('a raster image captures its declared thumb and rendition slots', async function (assert) {
    // A real 1×1 PNG: the meta extractor and the capture components decode
    // actual bytes, and the slots are file-content-keyed.
    await writeAndSettle(
      'photo.png',
      Uint8Array.from(
        atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        ),
        (c) => c.charCodeAt(0),
      ),
    );

    let fileRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}photo.png`,
      'file',
    );
    assert.ok(fileRow, 'the file row exists');
    let manifest = fileRow!.screenshots as ScreenshotManifest | null;
    assert.ok(manifest, 'the image captures landed on the file row');
    assert.deepEqual(
      Object.keys(manifest!).sort(),
      ['rendition-1280', 'rendition-640', 'thumb'],
      'a raster declares the thumb plus both renditions',
    );
    assert.true(
      manifest!.thumb.useAsThumbnail,
      'the thumb slot feeds the thumbnail chain',
    );
    assert.strictEqual(manifest!.thumb.contentType, 'image/webp');
    assert.strictEqual(
      manifest!['rendition-640'].deviceScaleFactor,
      1,
      'renditions capture at their declared physical width',
    );
  });

  test('a vector image captures only the thumb — the rendition slots live on RasterImageDef', async function (assert) {
    await writeAndSettle(
      'picture.svg',
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#0ea5e9"/></svg>`,
    );

    let fileRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}picture.svg`,
      'file',
    );
    assert.ok(fileRow, 'the file row exists');
    let manifest = fileRow!.screenshots as ScreenshotManifest | null;
    assert.ok(manifest, 'the image captures landed on the file row');
    assert.deepEqual(
      Object.keys(manifest!),
      ['thumb'],
      'an SVG pays for no renditions: srcset excludes vectors and the fitted cell uses thumb, so nothing could consume them',
    );
    assert.true(
      manifest!.thumb.useAsThumbnail,
      'the thumb slot feeds the thumbnail chain',
    );

    // The fitted shell prefers the captured thumbnail: the view model reads
    // the render context's declaration-derived meta.screenshots, so the
    // file's prerendered fitted HTML embeds the durable thumb URL.
    let fitted = JSON.stringify(fileRow!.fitted_html ?? {});
    assert.ok(
      fitted.includes(`_screenshot/picture.svg?name=thumb`),
      `the fitted rendering carries the captured thumbnail URL (got: ${fitted.slice(0, 500)})`,
    );
  });

  test('the PDF family captures a first-page poster onto the file row', async function (assert) {
    let pdfBytes = new Uint8Array(
      readFileSync(
        fileURLToPath(
          new URL(
            '../../experiments-realm/filedef-fixtures/samples/pdf-simple.pdf',
            import.meta.url,
          ),
        ),
      ),
    );
    await writeAndSettle('doc.pdf', pdfBytes);

    let fileRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}doc.pdf`,
      'file',
    );
    assert.ok(fileRow, 'the file row exists');
    let manifest = fileRow!.screenshots as ScreenshotManifest | null;
    assert.ok(manifest?.poster, 'the first-page poster landed on the file row');
    assert.true(
      manifest!.poster.useAsThumbnail,
      'the poster feeds the thumbnail chain',
    );
    assert.strictEqual(manifest!.poster.contentType, 'image/png');
    assert.ok(
      startsWith(objectBytes(manifest!.poster.objectKey), PNG_MAGIC),
      'the capture is a PNG',
    );

    // The fitted shell prefers the captured poster over the typed page
    // placeholder, via the view model's thumbnail seam.
    let fitted = JSON.stringify(fileRow!.fitted_html ?? {});
    assert.ok(
      fitted.includes(`_screenshot/doc.pdf?name=poster`),
      `the fitted rendering carries the poster URL (got: ${fitted.slice(0, 500)})`,
    );
  });

  test('a corrupt PDF captures no poster and the fitted cell keeps the placeholder', async function (assert) {
    // Not a PDF at all: the capture component's decode fails, readiness
    // never resolves, and the slot's capture fails after the bounded wait —
    // no manifest entry may land, or the blank white capture box would
    // masquerade as a first page in every grid.
    await writeAndSettle(
      'broken.pdf',
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0xde, 0xad, 0xbe, 0xef]),
    );

    let fileRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}broken.pdf`,
      'file',
    );
    assert.ok(fileRow, 'the file row still indexes');
    let manifest = fileRow!.screenshots as ScreenshotManifest | null;
    assert.notOk(
      manifest?.poster,
      'no poster entry lands for an undecodable document',
    );
    // No capture was ever persisted: the ledger is the durable signal here.
    // (Per-pass failure diagnostics and the retry lane's failure-cap
    // bookkeeping have their own coverage; which pass's diagnostics survive
    // on the row depends on how many retries ran before settle.)
    assert.strictEqual(
      (await declaredLedgerRows(`${testRealm}broken.pdf`)).length,
      0,
      'no ledger row lands for an undecodable document',
    );
    // The declaration-derived injection still embeds the durable URL — it is
    // class-level and cannot know this document is unreadable. With no
    // manifest entry, that URL stays an uncaptured 404 miss; the fitted
    // cell's image fallback is what keeps the tile presentable.
    let fitted = JSON.stringify(fileRow!.fitted_html ?? {});
    assert.ok(
      fitted.includes(`_screenshot/broken.pdf?name=poster`),
      'the injected durable URL is embedded regardless of capture outcome',
    );
  });

  test("an alias-addressed request serves from the matched row's own ledger spelling", async function (assert) {
    // A `.json` card is the one URL two live rows answer: the instance row
    // (alias sheds `.json`) and the JsonFileDef file row (same alias). No
    // realm-suppliable family can declare slots on `.json` — the extension
    // registry is static — so the file row's manifest and ledger row are
    // seeded here exactly as a slotted family's capture would persist them:
    // manifest on the type-'file' prerendered row, ledger keyed on the file's
    // own URL, extension intact. What this pins is the serving contract those
    // writes rely on: the `?name=` route must derive the ledger key from the
    // matched row's canonical `url`, never the request's spelling — an
    // alias-addressed hit otherwise resolves the manifest and then misses the
    // ledger — and a URL both rows answer must fall through the manifest-less
    // instance row to the file row that actually holds the name.
    await writeAndSettle(
      'note.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: { title: 'Note' },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/card-api',
              name: 'CardDef',
            },
          },
        },
      }),
    );
    let fileRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}note.json`,
      'file',
    );
    assert.ok(fileRow, 'the .json URL has a file row');
    let instanceRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}note.json`,
      'instance',
    );
    assert.ok(instanceRow, 'and an instance row — both answer the URL');

    let specHash = await posterSpecHash();
    let bytes = new Uint8Array([...PNG_MAGIC, 1, 2, 3]);
    let ledgerSourceURL = screenshotLedgerSourceURL(
      `${testRealm}note.json`,
      'file',
    );
    assert.strictEqual(
      ledgerSourceURL,
      `${testRealm}note.json`,
      'a file capture keys on the extension-intact URL',
    );
    let { objectKey } = await putMedia(testDbAdapter, mediaCacheAdapter, {
      realmURL: testRealm.href,
      sourceURL: ledgerSourceURL,
      captureSpecHash: specHash,
      sourceGeneration: Number(fileRow!.generation),
      bytes,
      contentType: 'image/png',
      lane: 'declared',
    });
    let manifest: ScreenshotManifest = {
      poster: {
        specHash,
        objectKey,
        contentType: 'image/png',
        width: 320,
        height: 240,
        deviceScaleFactor: 2,
      },
    };
    await testDbAdapter.execute(
      `update prerendered_html set screenshots = $1 where url = $2 and type = 'file'`,
      { bind: [JSON.stringify(manifest), `${testRealm}note.json`] },
    );

    // The alias spelling: the instance row is read first (no registered
    // extension on the path), holds no `poster`, and the loop falls through
    // to the file row — matched on `file_alias`, so only the row's own
    // canonical url can key the ledger.
    let aliasResponse = await realm.handle(
      new Request(`${testRealm}_screenshot/note?name=poster`),
    );
    assert.strictEqual(
      aliasResponse!.status,
      200,
      'the alias-addressed request serves the capture',
    );
    assert.strictEqual(
      aliasResponse!.headers.get('etag'),
      `"${objectKey}"`,
      'and it is the seeded artifact',
    );

    // The extension spelling reads the file row first (`urlNamesFile`) and
    // matches it on `url` directly.
    let extensionResponse = await realm.handle(
      new Request(`${testRealm}_screenshot/note.json?name=poster`),
    );
    assert.strictEqual(
      extensionResponse!.status,
      200,
      'the extension-addressed request serves the same capture',
    );
    assert.strictEqual(
      extensionResponse!.headers.get('etag'),
      `"${objectKey}"`,
    );
  });

  test('an unchanged file carries its capture forward; a content change recaptures', async function (assert) {
    await writeAndSettle('sample.mismatch', 'carry me');
    let firstRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}sample.mismatch`,
      'file',
    );
    let firstManifest = firstRow!.screenshots as ScreenshotManifest;
    let ledgerAfterFirstWrite = await declaredLedgerRows(
      `${testRealm}sample.mismatch`,
    );

    // Re-render without a byte change: rewriting identical bytes is a no-op
    // write, so the pass comes from invalidating a dependency instead — the
    // family module every .mismatch file row depends on. The
    // file-content-keyed slot then skips the Chrome capture and copies the
    // prior manifest entry; no new ledger row appears.
    await writeAndSettle(
      'filedef-mismatch.gts',
      `${FILEDEF_MISMATCH_SOURCE}\n// touched to invalidate dependents\n`,
    );
    let secondRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}sample.mismatch`,
      'file',
    );
    let secondManifest = secondRow!.screenshots as ScreenshotManifest;
    assert.ok(
      secondRow!.generation > firstRow!.generation,
      'the rewrite produced a fresh pass',
    );
    assert.deepEqual(
      secondManifest.poster,
      firstManifest.poster,
      "the unchanged file's manifest entry carried forward",
    );
    let ledgerAfterCarryForward = await declaredLedgerRows(
      `${testRealm}sample.mismatch`,
    );
    assert.strictEqual(
      ledgerAfterCarryForward.length,
      ledgerAfterFirstWrite.length,
      'no new ledger row on a carry-forward',
    );

    // A content change must recapture: new ledger row at the new generation,
    // manifest keyed by the new source hash.
    await writeAndSettle('sample.mismatch', 'carry me, but changed');
    let thirdRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}sample.mismatch`,
      'file',
    );
    let thirdManifest = thirdRow!.screenshots as ScreenshotManifest;
    assert.notStrictEqual(
      thirdManifest.poster.sourceContentHash,
      firstManifest.poster.sourceContentHash,
      'the recapture keys on the new content hash',
    );
    let ledgerAfterChange = await declaredLedgerRows(
      `${testRealm}sample.mismatch`,
    );
    assert.strictEqual(
      ledgerAfterChange.length,
      ledgerAfterCarryForward.length + 1,
      'the content change persisted a fresh capture',
    );
  });
});
