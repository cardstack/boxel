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

function makeFileSystem() {
  return {
    'product.gts': `
      import { contains, field, linksTo, CardDef, Component, type ScreenshotSpec } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

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
