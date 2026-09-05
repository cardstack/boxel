import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  declaredCaptureSpecHash,
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

  async function writeAndSettle(path: string, content: string) {
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
    let served = new Uint8Array(await imageResponse!.arrayBuffer());
    assert.ok(startsWith(served, PNG_MAGIC), 'the served bytes are the PNG');

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

  test('the image family captures its declared thumb and rendition slots', async function (assert) {
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
    assert.deepEqual(Object.keys(manifest!).sort(), [
      'rendition-1280',
      'rendition-640',
      'thumb',
    ]);
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

    // The fitted shell prefers the captured thumbnail: the view model reads
    // the render context's declaration-derived meta.screenshots, so the
    // file's prerendered fitted HTML embeds the durable thumb URL.
    let fitted = JSON.stringify(fileRow!.fitted_html ?? {});
    assert.ok(
      fitted.includes(`_screenshot/picture.svg?name=thumb`),
      `the fitted rendering carries the captured thumbnail URL (got: ${fitted.slice(0, 500)})`,
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
