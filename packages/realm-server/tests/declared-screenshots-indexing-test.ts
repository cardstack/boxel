import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  declaredCaptureSpecHash,
  rri,
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

// PNG magic and WebP RIFF container headers — enough to prove the declared
// `type` reached the encoder.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];
// "%PDF" — the header Chromium's print-to-pdf writer emits.
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

function makeFileSystem() {
  return {
    'product.gts': `
      import { contains, field, linksTo, CardDef, Component, type ScreenshotSpec } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { modifier } from "ember-modifier";

      export class Maker extends CardDef {
        @field name = contains(StringField);
        // A linksTo field component renders its target in FITTED format —
        // this template is what lands in the consumer's captures and HTML.
        // The default fitted layout renders cardTitle/display-name, never
        // this card's own fields, so without this the capture pixels would
        // be insensitive to the very edits these tests assert on.
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <span>Made by <@fields.name/></span>
          </template>
        }
      }

      // Renders linked data no display format touches — the screenshot's
      // deps must come from this component's own loads.
      class HeroShot extends Component<typeof Product> {
        <template>
          <h1>Hero shot: <@fields.name/></h1>
          <@fields.maker/>
        </template>
      }

      export class Product extends CardDef {
        @field name = contains(StringField);
        @field maker = linksTo(Maker);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1>Product: <@fields.name/></h1>
          </template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <h2>Fitted product: <@fields.name/></h2>
          </template>
        }
        static screenshots: Record<string, ScreenshotSpec> = {
          card: { format: 'fitted', width: 400, height: 300, useAsThumbnail: true },
          hero: { render: HeroShot, width: 320, height: 180, type: 'webp' },
        };
      }

      export class Plain extends CardDef {
        @field name = contains(StringField);
      }

      // Default fitted template + a content-bearing capture flagged
      // useAsThumbnail: the persisted tile HTML must carry the capture's
      // durable URL through the cardThumbnailURL fallback chain, with no
      // template edits.
      export class Gallery extends CardDef {
        @field name = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1>Gallery: <@fields.name/></h1>
          </template>
        }
        static screenshots: Record<string, ScreenshotSpec> = {
          tile: { format: 'isolated', width: 170, height: 250, useAsThumbnail: true },
        };
      }

      // Declares a pdf screenshot: a paged document of the isolated render,
      // paginated under print media. An inline break-before forces a second
      // page (independent of paper size and immune to CSS scoping), so the
      // page count is a meaningful, non-trivial assertion.
      export class Statement extends CardDef {
        @field name = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1>Statement: <@fields.name/></h1>
            <section style='break-before: page;'>Continued</section>
          </template>
        }
        static screenshots: Record<string, ScreenshotSpec> = {
          statement: { format: 'isolated', type: 'pdf' },
        };
      }

      // A mixed roster: one pdf slot and one raster slot on the same card.
      // Pins the capture leg order — raster format groups first, then the pdf
      // slots one at a time under print media — by asserting both manifest
      // entries land with the right shape. A media or viewport leak out of the
      // pdf leg onto the raster leg (or vice versa) would show up here.
      export class Combo extends CardDef {
        @field name = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1>Combo doc: <@fields.name/></h1>
          </template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <h2>Combo tile: <@fields.name/></h2>
          </template>
        }
        static screenshots: Record<string, ScreenshotSpec> = {
          doc: { format: 'isolated', type: 'pdf' },
          tile: { format: 'fitted', width: 200, height: 150 },
        };
      }

      // Declares more pdf slots than the per-card pdf sub-cap
      // (SCREENSHOT_MAX_PDF_CAPTURES = 3). The roster is captured name-sorted,
      // so "a"/"b"/"c" capture and the fourth slot "d" deterministically
      // overflows: no ledger row, no manifest entry, one recorded error. Each
      // renders the same trivial isolated format, so the render cost is minimal
      // while still exercising the cap.
      export class PdfHeavy extends CardDef {
        @field name = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1>Heavy: <@fields.name/></h1>
          </template>
        }
        static screenshots: Record<string, ScreenshotSpec> = {
          a: { format: 'isolated', type: 'pdf' },
          b: { format: 'isolated', type: 'pdf' },
          c: { format: 'isolated', type: 'pdf' },
          d: { format: 'isolated', type: 'pdf' },
        };
      }

      // A capture-only component that renders a multi-page document flow
      // itself — three pages via inline break-before rules. Its page count
      // differs from the card's single-page isolated template, so the
      // captured pdf's page count alone proves the content came from the
      // component and not the template.
      class InvoiceDocument extends Component<typeof Invoice> {
        <template>
          <article>
            <h1>Invoice: <@fields.name/></h1>
            <section style='break-before: page;'>Line items</section>
            <section style='break-before: page;'>Totals</section>
          </article>
        </template>
      }

      export class Invoice extends CardDef {
        @field name = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1>Invoice (isolated one-pager): <@fields.name/></h1>
          </template>
        }
        static screenshots: Record<string, ScreenshotSpec> = {
          invoice: { render: InvoiceDocument, type: 'pdf' },
        };
      }

      // A capture-only pdf component that discovers it can never render and
      // swaps the pending signal for the definitive-failure signal — the same
      // contract the raster DoomedShot follows, exercised on the pdf path.
      class BrokenDocument extends Component<typeof BrokenReport> {
        markFailed = modifier((el) => {
          el.removeAttribute('data-screenshot-pending');
          el.setAttribute('data-screenshot-failed', 'fixture: document cannot render');
        });
        <template>
          <div data-screenshot-pending='true' {{this.markFailed}}>never ready</div>
        </template>
      }

      export class BrokenReport extends CardDef {
        @field name = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1>Broken report: <@fields.name/></h1>
          </template>
        }
        static screenshots: Record<string, ScreenshotSpec> = {
          doc: { render: BrokenDocument, type: 'pdf' },
        };
      }

      // Consumes its own declared capture in a display format — pins the
      // render context's declaration-derived meta.screenshots: the durable
      // URL must land in persisted HTML on the instance's very first
      // prerender pass, when the capture itself runs later in that same
      // pass and no manifest exists yet.
      export class SelfPromo extends CardDef {
        @field name = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1>Promo: <@fields.name/></h1>
            {{#if @model.screenshotURLs.card}}
              <img src={{@model.screenshotURLs.card}} alt='self preview' />
            {{/if}}
          </template>
        }
        static screenshots: Record<string, ScreenshotSpec> = {
          card: { format: 'fitted', width: 400, height: 300 },
        };
      }

      // A capture-only component that discovers its content can never be
      // ready and swaps the pending signal for the definitive-failure
      // signal — by direct DOM mutation, per the signalling contract. The
      // engine must fail this slot immediately (no manifest entry, no
      // ledger row) rather than waiting out the pending budget, and the
      // attribute's value must reach the slot's failure diagnostics.
      class DoomedShot extends Component<typeof Doomed> {
        markFailed = modifier((el) => {
          el.removeAttribute('data-screenshot-pending');
          el.setAttribute('data-screenshot-failed', 'fixture: content cannot decode');
        });
        <template>
          <div data-screenshot-pending='true' {{this.markFailed}}>never ready</div>
        </template>
      }

      export class Doomed extends CardDef {
        @field name = contains(StringField);
        static screenshots: Record<string, ScreenshotSpec> = {
          ok: { format: 'fitted', width: 170, height: 250 },
          doomed: { render: DoomedShot, width: 320, height: 180 },
        };
      }

      // Renders the linked card in a display format, so the persisted
      // isolated_html carries the linked data as text — the inspectable
      // twin of the capture-only path above.
      export class ProductWithMakerView extends Product {
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1>Viewed product: <@fields.name/></h1>
            <@fields.maker/>
          </template>
        }
      }
    `,
    'widget.json': {
      data: {
        attributes: {
          name: 'Widget',
        },
        meta: {
          adoptsFrom: {
            module: rri('./product'),
            name: 'Product',
          },
        },
      },
    },
    'nothing.json': {
      data: {
        attributes: {
          name: 'Nothing declared',
        },
        meta: {
          adoptsFrom: {
            module: rri('./product'),
            name: 'Plain',
          },
        },
      },
    },
    'report.json': {
      data: {
        attributes: {
          name: 'Q3',
        },
        meta: {
          adoptsFrom: {
            module: rri('./product'),
            name: 'Statement',
          },
        },
      },
    },
    'combo.json': {
      data: {
        attributes: {
          name: 'Both',
        },
        meta: {
          adoptsFrom: {
            module: rri('./product'),
            name: 'Combo',
          },
        },
      },
    },
    'pdf-heavy.json': {
      data: {
        attributes: {
          name: 'Heavy',
        },
        meta: {
          adoptsFrom: {
            module: rri('./product'),
            name: 'PdfHeavy',
          },
        },
      },
    },
  };
}

function productDoc(name: string) {
  return JSON.stringify({
    data: {
      attributes: { name },
      meta: {
        adoptsFrom: {
          module: rri('./product'),
          name: 'Product',
        },
      },
    },
  });
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

  async function writeAndSettle(path: string, doc: string) {
    let baseline = await maxPrerenderHtmlJobId(testDbAdapter, realm.url);
    await realm.write(path, doc);
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url, {
      afterJobId: baseline,
      timeout: 60000,
    });
  }

  async function declaredLedgerRows(sourceURL: string) {
    return (await testDbAdapter.execute(
      `select capture_spec_hash, source_generation, object_key, lane, content_type, width, height from media_cache_ledger where source_url = $1 order by source_generation, capture_spec_hash`,
      { bind: [sourceURL] },
    )) as unknown as {
      capture_spec_hash: string;
      source_generation: number;
      object_key: string;
      lane: string;
      content_type: string;
      width: number;
      height: number;
    }[];
  }

  function objectBytes(objectKey: string): Uint8Array | undefined {
    return mediaCacheAdapter.objects.get(objectKey);
  }

  function startsWith(bytes: Uint8Array | undefined, magic: number[]) {
    return !!bytes && magic.every((b, i) => bytes[i] === b);
  }

  test('the prerender-html pass captures declared screenshots, persists them, and records the manifest', async function (assert) {
    await writeAndSettle('widget.json', productDoc('Widget'));

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}widget.json`,
    );
    assert.ok(row, 'the instance row exists');
    let manifest = row!.screenshots as ScreenshotManifest | null;
    assert.ok(manifest, 'the manifest landed on the row');
    assert.deepEqual(Object.keys(manifest!).sort(), ['card', 'hero']);

    let card = manifest!.card;
    assert.strictEqual(
      card.specHash,
      await declaredCaptureSpecHash('card', {
        width: 400,
        height: 300,
        format: 'fitted',
      }),
      'the manifest records the declared capture identity',
    );
    assert.strictEqual(card.contentType, 'image/png');
    assert.strictEqual(card.width, 400);
    assert.strictEqual(card.height, 300);
    assert.strictEqual(
      card.deviceScaleFactor,
      2,
      'the declaration default scale applies',
    );
    assert.true(card.useAsThumbnail, 'the thumbnail flag rides the manifest');

    let hero = manifest!.hero;
    assert.strictEqual(hero.contentType, 'image/webp');
    assert.strictEqual(hero.width, 320);
    assert.strictEqual(hero.height, 180);

    let ledger = await declaredLedgerRows(`${testRealm}widget`);
    assert.strictEqual(ledger.length, 2, 'one ledger row per slot');
    for (let ledgerRow of ledger) {
      assert.strictEqual(ledgerRow.lane, 'declared');
      assert.strictEqual(
        ledgerRow.source_generation,
        row!.generation,
        'ledger rows key the generation the row was rendered at',
      );
    }
    assert.ok(
      startsWith(objectBytes(card.objectKey), PNG_MAGIC),
      'the fitted capture is a PNG',
    );
    assert.ok(
      startsWith(objectBytes(hero.objectKey), RIFF_MAGIC),
      'the capture-only render honored the declared webp type',
    );

    let fileRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}widget.json`,
      'file',
    );
    let fileManifest = fileRow?.screenshots ?? null;
    assert.strictEqual(
      fileManifest,
      null,
      'the file rendering of the URL carries no manifest',
    );

    let errors = (row!.diagnostics as any)?.screenshotErrors;
    assert.strictEqual(
      errors,
      undefined,
      'no screenshotErrors diagnostics on a clean capture',
    );

    let timings = (row!.diagnostics as any)?.screenshotTimingsMs;
    assert.deepEqual(
      Object.keys(timings ?? {}).sort(),
      ['card', 'hero'],
      'each captured slot records its per-name timing',
    );
    for (let name of ['card', 'hero']) {
      let timing = typeof timings[name] === 'number' ? timings[name] : -1;
      assert.true(
        timing > 0,
        `the "${name}" capture timing is a positive duration`,
      );
    }
  });

  test('card+json joins the manifest into meta.screenshots and the ?name= URL serves the capture', async function (assert) {
    await writeAndSettle('widget.json', productDoc('Widget'));
    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}widget.json`,
    );
    let manifest = row!.screenshots as ScreenshotManifest;

    let response = await realm.handle(
      new Request(`${testRealm}widget`, {
        headers: { Accept: 'application/vnd.card+json' },
      }),
    );
    assert.strictEqual(response!.status, 200);
    let json = await response!.json();
    assert.deepEqual(
      json.data.meta.screenshots,
      {
        card: {
          url: `${testRealm}_screenshot/widget?name=card`,
          hash: manifest.card.objectKey,
          contentType: 'image/png',
          width: 400,
          height: 300,
          deviceScaleFactor: 2,
          useAsThumbnail: true,
        },
        hero: {
          url: `${testRealm}_screenshot/widget?name=hero`,
          hash: manifest.hero.objectKey,
          contentType: 'image/webp',
          width: 320,
          height: 180,
          deviceScaleFactor: 2,
        },
      },
      'the manifest joins into meta.screenshots in its public projection',
    );

    let served = await realm.handle(
      new Request(`${testRealm}_screenshot/widget?name=card`),
    );
    assert.strictEqual(served!.status, 200);
    assert.strictEqual(served!.headers.get('content-type'), 'image/png');
    assert.strictEqual(
      served!.headers.get('etag'),
      `"${manifest.card.objectKey}"`,
      'the ETag is the capture content hash',
    );
  });

  test('a declared pdf is captured under print media, persisted, and served at ?name=', async function (assert) {
    await writeAndSettle(
      'report.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Q3' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'Statement' },
          },
        },
      }),
    );

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}report.json`,
    );
    assert.ok(row, 'the instance row exists');
    let manifest = row!.screenshots as ScreenshotManifest | null;
    assert.ok(manifest?.statement, 'the pdf capture landed in the manifest');

    let statement = manifest!.statement;
    assert.strictEqual(
      statement.specHash,
      await declaredCaptureSpecHash('statement', {
        format: 'isolated',
        type: 'pdf',
      }),
      'the manifest records the pdf capture identity',
    );
    assert.strictEqual(statement.contentType, 'application/pdf');
    assert.strictEqual(
      statement.width,
      undefined,
      'a pdf manifest entry carries no raster width',
    );
    assert.strictEqual(statement.height, undefined);
    assert.strictEqual(statement.deviceScaleFactor, undefined);
    assert.true(
      (statement.pageCount ?? 0) >= 2,
      'the @page break paginated the render into multiple pages',
    );
    assert.true(
      (statement.byteSize ?? 0) > 0,
      'the manifest records the document byte size',
    );
    assert.notOk(statement.useAsThumbnail, 'a pdf is never a thumbnail');

    let ledger = await declaredLedgerRows(`${testRealm}report`);
    assert.strictEqual(ledger.length, 1, 'one ledger row for the pdf slot');
    assert.strictEqual(ledger[0].lane, 'declared');
    assert.strictEqual(ledger[0].content_type, 'application/pdf');
    assert.strictEqual(
      ledger[0].width,
      null,
      'the pdf ledger row has null width',
    );
    assert.strictEqual(ledger[0].height, null);
    assert.ok(
      startsWith(objectBytes(statement.objectKey), PDF_MAGIC),
      'the persisted bytes are a PDF document',
    );

    let statementTiming = (row!.diagnostics as any)?.screenshotTimingsMs
      ?.statement;
    assert.strictEqual(
      typeof statementTiming,
      'number',
      'the pdf capture records a per-slot timing',
    );
    assert.true(
      statementTiming > 0,
      'the pdf capture timing is a positive duration',
    );

    // The card+json join projects the paged facts, and the durable ?name=
    // URL serves the document.
    let response = await realm.handle(
      new Request(`${testRealm}report`, {
        headers: { Accept: 'application/vnd.card+json' },
      }),
    );
    assert.strictEqual(response!.status, 200);
    let json = await response!.json();
    assert.deepEqual(
      json.data.meta.screenshots.statement,
      {
        url: `${testRealm}_screenshot/report?name=statement`,
        hash: statement.objectKey,
        contentType: 'application/pdf',
        pageCount: statement.pageCount,
        byteSize: statement.byteSize,
      },
      'meta.screenshots projects the pdf entry with its paged facts, no raster geometry',
    );

    let served = await realm.handle(
      new Request(`${testRealm}_screenshot/report?name=statement`),
    );
    assert.strictEqual(served!.status, 200);
    assert.strictEqual(
      served!.headers.get('content-type'),
      'application/pdf',
      'the ?name= URL serves the pdf',
    );
    assert.strictEqual(
      served!.headers.get('etag'),
      `"${statement.objectKey}"`,
      'the ETag is the capture content hash',
    );
    assert.true(
      (served!.headers.get('content-disposition') ?? '').startsWith('inline'),
      'the pdf serves inline with a filename',
    );
  });

  test('a mixed pdf + raster roster captures both legs side by side', async function (assert) {
    await writeAndSettle(
      'combo.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Both' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'Combo' },
          },
        },
      }),
    );

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}combo.json`,
    );
    let manifest = row!.screenshots as ScreenshotManifest | null;
    assert.ok(manifest, 'the manifest landed on the row');
    assert.deepEqual(
      Object.keys(manifest!).sort(),
      ['doc', 'tile'],
      'both the pdf slot and the raster slot joined the manifest',
    );

    // The pdf leg: paged document, no raster geometry.
    let doc = manifest!.doc;
    assert.strictEqual(doc.contentType, 'application/pdf');
    assert.strictEqual(
      doc.width,
      undefined,
      'the pdf entry carries no raster width',
    );
    assert.strictEqual(doc.height, undefined);
    assert.strictEqual(doc.deviceScaleFactor, undefined);
    assert.true(
      (doc.pageCount ?? 0) >= 1,
      'the pdf entry records a page count',
    );
    assert.true((doc.byteSize ?? 0) > 0, 'the pdf entry records a byte size');
    assert.ok(
      startsWith(objectBytes(doc.objectKey), PDF_MAGIC),
      'the pdf slot persisted a PDF document',
    );

    // The raster leg rendered unaffected by the pdf leg that shares the pass —
    // it kept its declared box, its raster encoding, and no paged facts leaked
    // onto it.
    let tile = manifest!.tile;
    assert.strictEqual(
      tile.contentType,
      'image/png',
      'the raster slot rendered as png, not pulled onto the pdf path',
    );
    assert.strictEqual(
      tile.width,
      200,
      'the raster slot kept its declared box',
    );
    assert.strictEqual(tile.height, 150);
    assert.strictEqual(tile.deviceScaleFactor, 2);
    assert.strictEqual(
      tile.pageCount,
      undefined,
      'a raster entry carries no page count',
    );
    assert.ok(
      startsWith(objectBytes(tile.objectKey), PNG_MAGIC),
      'the raster slot persisted a PNG',
    );

    let ledger = await declaredLedgerRows(`${testRealm}combo`);
    assert.strictEqual(ledger.length, 2, 'one ledger row per slot');
  });

  test('declared pdf slots beyond the per-card pdf cap overflow deterministically with a recorded error', async function (assert) {
    await writeAndSettle(
      'pdf-heavy.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Heavy' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'PdfHeavy' },
          },
        },
      }),
    );

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}pdf-heavy.json`,
    );
    let manifest = row!.screenshots as ScreenshotManifest | null;
    assert.deepEqual(
      Object.keys(manifest ?? {}).sort(),
      ['a', 'b', 'c'],
      'the first three name-sorted pdf slots capture; the fourth overflows',
    );

    let ledger = await declaredLedgerRows(`${testRealm}pdf-heavy`);
    assert.strictEqual(
      ledger.length,
      3,
      'the overflow slot persists no ledger row',
    );

    let errors = (row!.diagnostics as any)?.screenshotErrors as
      | { name: string; message: string }[]
      | undefined;
    let overflow = errors?.find((e) => e.name === 'd');
    assert.ok(overflow, 'the overflow slot records a screenshot error');
    assert.ok(
      overflow!.message.includes('exceed the pdf capture cap of 3'),
      `the error names the cap it exceeded (got: ${overflow?.message})`,
    );
  });

  test('a declared pdf render component paginates its own document flow, not the isolated template', async function (assert) {
    await writeAndSettle(
      'invoice.json',
      JSON.stringify({
        data: {
          attributes: { name: 'INV-1' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'Invoice' },
          },
        },
      }),
    );

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}invoice.json`,
    );
    assert.ok(row, 'the instance row exists');
    let manifest = row!.screenshots as ScreenshotManifest | null;
    assert.ok(manifest?.invoice, 'the render-based pdf capture landed');

    let invoice = manifest!.invoice;
    assert.strictEqual(
      invoice.specHash,
      await declaredCaptureSpecHash('invoice', { render: true, type: 'pdf' }),
      'the manifest records the render-based pdf identity',
    );
    assert.strictEqual(invoice.contentType, 'application/pdf');
    assert.strictEqual(
      invoice.width,
      undefined,
      'a render-based pdf carries no raster box either',
    );
    assert.strictEqual(
      invoice.pageCount,
      3,
      "the component's three-page flow drove the document, not the one-page isolated template",
    );
    assert.ok(
      startsWith(objectBytes(invoice.objectKey), PDF_MAGIC),
      'the persisted bytes are a PDF document',
    );

    let served = await realm.handle(
      new Request(`${testRealm}_screenshot/invoice?name=invoice`),
    );
    assert.strictEqual(served!.status, 200);
    assert.strictEqual(
      served!.headers.get('content-type'),
      'application/pdf',
      'the ?name= URL serves the component-rendered pdf',
    );
  });

  test('a failing pdf render component fails its slot under the broken-links model without failing the row', async function (assert) {
    await writeAndSettle(
      'broken.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Broken' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'BrokenReport' },
          },
        },
      }),
    );

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}broken.json`,
    );
    assert.ok(row, 'the instance row still indexes');
    let manifest = row!.screenshots as ScreenshotManifest | null;
    assert.notOk(
      manifest?.doc,
      'no manifest entry lands for the failed pdf slot',
    );
    assert.deepEqual(
      await declaredLedgerRows(`${testRealm}broken`),
      [],
      'a failed pdf slot persists no ledger row',
    );

    let errors = (row!.diagnostics as any)?.screenshotErrors as
      | { name: string; message: string }[]
      | undefined;
    let docError = errors?.find((e) => e.name === 'doc');
    assert.ok(docError, 'the failed pdf slot records a screenshot error');
    assert.ok(
      docError!.message.includes(
        'signaled data-screenshot-failed: fixture: document cannot render',
      ),
      `the error carries the component's stated cause (got: ${docError?.message})`,
    );
  });

  test('a card can embed its own declared capture on its first prerender pass', async function (assert) {
    await writeAndSettle(
      'self-promo-1.json',
      JSON.stringify({
        data: {
          attributes: { name: 'First' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'SelfPromo' },
          },
        },
      }),
    );

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}self-promo-1.json`,
    );
    assert.ok(row, 'the instance row exists');
    let manifest = row!.screenshots as ScreenshotManifest | null;
    assert.ok(manifest?.card, 'the capture landed in the same pass');
    assert.true(
      (row!.isolated_html ?? '').includes(
        `${testRealm}_screenshot/self-promo-1?name=card`,
      ),
      `the very first persisted isolated_html embeds the durable URL (render-context declaration-derived meta); got: ${row!.isolated_html}`,
    );
  });

  test('a useAsThumbnail capture feeds the default fitted tile with no template edits', async function (assert) {
    await writeAndSettle(
      'gallery-1.json',
      JSON.stringify({
        data: {
          attributes: { name: 'First' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'Gallery' },
          },
        },
      }),
    );

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}gallery-1.json`,
    );
    assert.ok(row, 'the instance row exists');
    let manifest = row!.screenshots as ScreenshotManifest | null;
    assert.ok(manifest?.tile, 'the thumbnail capture landed');
    assert.true(
      manifest!.tile.useAsThumbnail,
      'the manifest carries the thumbnail flag',
    );

    let fittedHtml = Object.values(
      (row!.fitted_html ?? {}) as Record<string, string>,
    ).join('\n');
    assert.true(
      fittedHtml.includes(`${testRealm}_screenshot/gallery-1?name=tile`),
      `the default fitted tile renders the capture through the cardThumbnailURL chain; got: ${fittedHtml.slice(0, 2000)}`,
    );
  });

  test('a card with no declarations writes a null manifest and no ledger rows', async function (assert) {
    await writeAndSettle(
      'nothing.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Still nothing' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'Plain' },
          },
        },
      }),
    );
    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}nothing.json`,
    );
    assert.ok(row, 'the instance row exists');
    let manifest = row!.screenshots ?? null;
    assert.strictEqual(manifest, null, 'no manifest');
    assert.deepEqual(
      await declaredLedgerRows(`${testRealm}nothing`),
      [],
      'no ledger rows',
    );
  });

  test('a data-screenshot-failed signal fails its slot immediately; sibling slots still capture', async function (assert) {
    // The fixture component swaps pending → failed as soon as it renders,
    // modeling content that is discovered undecodable (a corrupt or
    // password-protected document). Were the definitive-failure signal not
    // honored, every render of this instance — the initial pass plus the
    // full retry lane — would stall the engine's whole pending budget, and
    // this test would take minutes rather than seconds.
    await writeAndSettle(
      'doomed.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Doomed' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'Doomed' },
          },
        },
      }),
    );

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}doomed.json`,
    );
    assert.ok(row, 'the instance row still indexes');
    let manifest = row!.screenshots as ScreenshotManifest | null;
    assert.ok(
      manifest?.ok,
      'the sibling slot captures — a per-slot failure never fails the visit',
    );
    assert.notOk(
      manifest?.doomed,
      'no manifest entry lands for the failed slot',
    );

    let ledger = await declaredLedgerRows(`${testRealm}doomed`);
    assert.deepEqual(
      [...new Set(ledger.map((r) => r.capture_spec_hash))],
      [
        await declaredCaptureSpecHash('ok', {
          format: 'fitted',
          width: 170,
          height: 250,
        }),
      ],
      'only the sibling slot persisted a capture',
    );

    // The component's stated cause (the attribute's value) rides the slot's
    // failure diagnostics — an unreadable file must be distinguishable from
    // a hung component that timed out the pending wait. Every pass fails
    // this slot identically, so whichever pass's diagnostics survive on the
    // row carry this message.
    let errors = (row!.diagnostics as any)?.screenshotErrors as
      | { name: string; message: string }[]
      | undefined;
    let doomedError = errors?.find((e) => e.name === 'doomed');
    assert.ok(doomedError, 'the failed slot records a screenshot error');
    assert.ok(
      doomedError!.message.includes(
        'signaled data-screenshot-failed: fixture: content cannot decode',
      ),
      `the error carries the component's stated cause (got: ${doomedError?.message})`,
    );
  });

  test('a re-render captures at the new generation and supersedes the prior ledger row', async function (assert) {
    await writeAndSettle('widget.json', productDoc('Widget'));
    let firstRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}widget.json`,
    );
    let firstGeneration = firstRow!.generation;

    await writeAndSettle('widget.json', productDoc('Widget v2'));
    let secondRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}widget.json`,
    );
    assert.ok(
      secondRow!.generation > firstGeneration,
      'the write advanced the generation',
    );
    let manifest = secondRow!.screenshots as ScreenshotManifest;
    assert.deepEqual(Object.keys(manifest).sort(), ['card', 'hero']);

    let ledger = await declaredLedgerRows(`${testRealm}widget`);
    let generations = [...new Set(ledger.map((r) => r.source_generation))];
    assert.deepEqual(
      generations,
      [firstGeneration, secondRow!.generation],
      'both generations hold ledger rows (the older is GC-superseded, not overwritten)',
    );
  });

  test('a capture-only component’s linked-data loads land in the row’s deps and invalidate the screenshot', async function (assert) {
    await writeAndSettle(
      'maker.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Acme' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'Maker' },
          },
        },
      }),
    );
    await writeAndSettle(
      'gadget.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Gadget' },
          relationships: {
            maker: { links: { self: './maker' } },
          },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'Product' },
          },
        },
      }),
    );

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}gadget.json`,
    );
    assert.ok(row, 'the instance row exists');
    let deps = (row!.deps ?? []) as string[];
    assert.ok(
      deps.some(
        (dep) =>
          dep === `${testRealm}maker` || dep === `${testRealm}maker.json`,
      ),
      `the linked card only the capture-only component renders is a dep (deps: ${JSON.stringify(
        deps,
      )})`,
    );

    let firstGeneration = row!.generation;
    let heroBefore = (row!.screenshots as ScreenshotManifest).hero;

    // Control: an otherwise-identical card with no maker link. Its hero and
    // gadget's differing is what proves the capture-only render actually
    // painted the linked card before the shot — the invalidation assertions
    // below are meaningless for a capture the linked data never reaches
    // (deps record the load attempt, not the paint).
    await writeAndSettle(
      'control.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Gadget' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'Product' },
          },
        },
      }),
    );
    let controlRow = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}control.json`,
    );
    let controlHero = (controlRow!.screenshots as ScreenshotManifest).hero;
    assert.notStrictEqual(
      heroBefore.objectKey,
      controlHero.objectKey,
      'the capture-only render painted the linked card (its hero differs from the linkless control)',
    );

    // Editing the linked data must fan out to this row — the screenshot of
    // it is stale until re-captured.
    await writeAndSettle(
      'maker.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Acme Industries' },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'Maker' },
          },
        },
      }),
    );
    let after = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}gadget.json`,
    );
    assert.ok(
      after!.generation > firstGeneration,
      'editing the linked card re-rendered the screenshot’s row',
    );
    let heroAfter = (after!.screenshots as ScreenshotManifest).hero;
    assert.notStrictEqual(
      heroAfter.objectKey,
      heroBefore.objectKey,
      'the re-capture rendered the edited linked data (different pixels, different object)',
    );
    // The linked card must stay a dep across the re-render: a capture that
    // reads it from a warm store instead of loading it records no load, the
    // re-snapshot drops it from deps, and every later edit of the linked
    // card stops invalidating this screenshot.
    let depsAfter = (after!.deps ?? []) as string[];
    assert.ok(
      depsAfter.some(
        (dep) =>
          dep === `${testRealm}maker` || dep === `${testRealm}maker.json`,
      ),
      `the re-capture re-loaded the linked card, so it remains a dep (deps: ${JSON.stringify(
        depsAfter,
      )})`,
    );
  });

  test('a display-format render of linked data is fresh after the linked card is edited', async function (assert) {
    let makerDoc = (name: string) =>
      JSON.stringify({
        data: {
          attributes: { name },
          meta: {
            adoptsFrom: { module: rri('./product'), name: 'Maker' },
          },
        },
      });
    await writeAndSettle('maker2.json', makerDoc('Initech'));
    await writeAndSettle(
      'viewed.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Viewed' },
          relationships: {
            maker: { links: { self: './maker2' } },
          },
          meta: {
            adoptsFrom: {
              module: rri('./product'),
              name: 'ProductWithMakerView',
            },
          },
        },
      }),
    );

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}viewed.json`,
    );
    assert.ok(
      row!.isolated_html?.includes('Initech'),
      `the render shows the linked name (html: ${row!.isolated_html?.slice(
        0,
        500,
      )})`,
    );

    await writeAndSettle('maker2.json', makerDoc('Initrode'));
    let after = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}viewed.json`,
    );
    assert.ok(
      after!.generation > row!.generation,
      'editing the linked card re-rendered the consumer',
    );
    assert.ok(
      after!.isolated_html?.includes('Initrode'),
      `the re-render shows the edited linked name (html: ${after!.isolated_html?.slice(
        0,
        500,
      )})`,
    );
  });
});
