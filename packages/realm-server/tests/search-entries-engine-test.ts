import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  baseRRI,
  parseSearchEntryQueryFromPayload,
  rri,
  type CardResource,
  type CssResource,
  type FileMetaResource,
  type HtmlResource,
  type IconResource,
  type Realm,
  type EntryCollectionDocument,
  type EntryResource,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

function htmlIn(
  doc: EntryCollectionDocument,
  id: string,
): HtmlResource | undefined {
  return doc.included?.find(
    (resource): resource is HtmlResource =>
      resource.type === 'html' && resource.id === id,
  );
}

// Prerendered markup splits text across newlines/indentation, so content
// assertions match against a whitespace-collapsed form.
function normalizedHtml(resource: HtmlResource): string {
  return (resource.attributes.html ?? '').replace(/\s+/g, ' ');
}

function itemIn(
  doc: EntryCollectionDocument,
  id: string,
): CardResource | FileMetaResource | undefined {
  return doc.included?.find(
    (resource): resource is CardResource | FileMetaResource =>
      (resource.type === 'card' || resource.type === 'file-meta') &&
      resource.id === id,
  );
}

function cssIn(doc: EntryCollectionDocument): CssResource[] {
  return (doc.included ?? []).filter(
    (resource): resource is CssResource => resource.type === 'css',
  );
}

function iconsIn(doc: EntryCollectionDocument): IconResource[] {
  return (doc.included ?? []).filter(
    (resource): resource is IconResource => resource.type === 'icon',
  );
}

function iconIdOf(entry: EntryResource): string | undefined {
  return entry.relationships.icon?.data.id;
}

function entryFor(
  doc: EntryCollectionDocument,
  id: string,
): EntryResource | undefined {
  return doc.data.find((entry) => entry.id === id);
}

function htmlIdsOf(entry: EntryResource): string[] | undefined {
  return entry.relationships.html?.data.map((member) => member.id);
}

module(basename(import.meta.filename), function () {
  module('searchEntries projection engine', function (hooks) {
    let testRealm: Realm;
    let dbAdapter: PgAdapter;
    let realmHref: string;
    let personKey: string;
    let johnId: string;
    let janeId: string;

    function onRealmSetup(args: { testRealm: Realm; dbAdapter: PgAdapter }) {
      testRealm = args.testRealm;
      dbAdapter = args.dbAdapter;
      realmHref = new URL(testRealm.url).href;
      personKey = `${realmHref}person/Person`;
      johnId = `${realmHref}john`;
      janeId = `${realmHref}jane`;
    }

    setupPermissionedRealmCached(hooks, {
      realmURL: new URL('http://127.0.0.1:4444/test/'),
      permissions: { '*': ['read'] },
      fileSystem: {
        'person.gts': `
          import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringField);
            static isolated = class Isolated extends Component<typeof this> {
              <template>
                <h1><@fields.firstName/></h1>
              </template>
            }
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card Person: <@fields.firstName/>
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                Fitted Card Person: <@fields.firstName/>
              </template>
            }
          }
        `,
        'john.json': {
          data: {
            attributes: { firstName: 'John' },
            meta: {
              adoptsFrom: { module: rri('./person'), name: 'Person' },
            },
          },
        },
        'jane.json': {
          data: {
            attributes: { firstName: 'Jane' },
            meta: {
              adoptsFrom: { module: rri('./person'), name: 'Person' },
            },
          },
        },
        'webpage.gts': `
          import { contains, field, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class WebPage extends CardDef {
            @field url = contains(StringField);
          }
        `,
        'home.json': {
          data: {
            attributes: { url: 'https://example.com' },
            meta: {
              adoptsFrom: { module: rri('./webpage'), name: 'WebPage' },
            },
          },
        },
        // Over-match guard: stores the trailing-slash (toURL-normalized) form of
        // home's url, so a `url` filter for the no-slash value must NOT match it.
        'home-slash.json': {
          data: {
            attributes: { url: 'https://example.com/' },
            meta: {
              adoptsFrom: { module: rri('./webpage'), name: 'WebPage' },
            },
          },
        },
        'hello.md': '# Hello from FileDef content',
      },
      onRealmSetup,
    });

    function personQuery(extra: Record<string, unknown> = {}) {
      return parseSearchEntryQueryFromPayload({
        filter: {
          'item.on': { module: `${realmHref}person`, name: 'Person' },
          ...(extra.filterEq ? { eq: extra.filterEq } : {}),
        },
        ...(extra.fields ? { fields: extra.fields } : {}),
        ...(extra.sort ? { sort: extra.sort } : {}),
        ...(extra.page ? { page: extra.page } : {}),
      });
    }

    test('default fieldset: html-backed entries with the default htmlQuery (fitted × native)', async function (assert) {
      let doc =
        await testRealm.realmIndexQueryEngine.searchEntries(personQuery());
      assert.strictEqual(doc.meta.page.total, 2);
      assert.deepEqual(
        doc.meta.htmlQuery,
        { eq: { format: 'fitted' } },
        'the applied default htmlQuery is echoed once at the document level',
      );
      let htmlId = `${johnId}#fitted#${personKey}`;
      let entry = entryFor(doc, johnId)!;
      assert.deepEqual(htmlIdsOf(entry), [htmlId]);
      assert.strictEqual(
        entry.relationships.item,
        undefined,
        'no item branch on an html-backed row',
      );
      let html = htmlIn(doc, htmlId)!;
      assert.strictEqual(html.attributes.format, 'fitted');
      assert.deepEqual(html.attributes.renderType, {
        module: `${realmHref}person`,
        name: 'Person',
      });
      assert.true(normalizedHtml(html).includes('Fitted Card Person: John'));
      assert.strictEqual(html.attributes.cardType, 'Person');
    });

    test('entries and html renderings carry meta.generation from their own channels', async function (assert) {
      let doc =
        await testRealm.realmIndexQueryEngine.searchEntries(personQuery());
      let entry = entryFor(doc, johnId)!;
      let entryGeneration = entry.meta?.generation;
      assert.strictEqual(
        typeof entryGeneration,
        'number',
        'entry carries its index-data generation',
      );
      assert.ok(entryGeneration! > 0, `entry generation is positive`);
      let html = htmlIn(doc, `${johnId}#fitted#${personKey}`)!;
      let htmlGeneration = html.meta?.generation;
      assert.strictEqual(
        typeof htmlGeneration,
        'number',
        'html rendering carries its own generation',
      );
      assert.ok(htmlGeneration! > 0, 'html generation is positive');
      // The index visit and the prerender-html visit still run fused, so a
      // freshly-indexed row's two channels sit at the same generation — but
      // they are threaded from separate columns (boxel_index.generation vs.
      // prerendered_html.generation), ready to diverge once the split lands.
      assert.strictEqual(
        htmlGeneration,
        entryGeneration,
        'fused indexing leaves both channels at the same generation',
      );
    });

    test('an id filter in canonical-RRI (prefix) form matches the card indexed under its URL-form id', async function (assert) {
      // The realm has no registered prefix by default; register one so a
      // canonical-RRI value resolves, and remove it afterward so the cached
      // realm is left as we found it.
      testRealm.virtualNetwork.addRealmMapping('@test-prefix/', realmHref);
      try {
        let prefixJohnId = `@test-prefix/${johnId.slice(realmHref.length)}`;

        let { data: byPrefix } = await searchCardsForTest(
          testRealm.realmIndexQueryEngine,
          {
            // Match rich-markdown's `linkedCards` query shape: a bare id filter
            // with no type anchor (the primary `id` is not a definition field).
            filter: { in: { id: [rri(prefixJohnId)] } },
          },
        );
        assert.deepEqual(
          byPrefix.map((r) => r.id),
          [rri(johnId)],
          'prefix-form id value matches the card indexed under its URL-form id',
        );

        // The URL-form value still matches (it is one of its own equivalent
        // forms) — existing callers are unaffected.
        let { data: byUrl } = await searchCardsForTest(
          testRealm.realmIndexQueryEngine,
          {
            filter: { in: { id: [rri(johnId)] } },
          },
        );
        assert.deepEqual(
          byUrl.map((r) => r.id),
          [rri(johnId)],
          'URL-form id value still matches',
        );
      } finally {
        testRealm.virtualNetwork.removeRealmMapping('@test-prefix/');
      }
    });

    test('an exact `in` filter on an ordinary `url` field matches exactly and does not over-match', async function (assert) {
      // `url` here is an ordinary StringField, not a reference, and a URL-form
      // value is not a registered prefix — so it is matched exactly as given,
      // neither dropped (no normalized substitution) nor broadened. The `home`
      // and `home-slash` fixtures differ only by a trailing slash, so a filter
      // for the no-slash value must match `home` only.
      let { data } = await searchCardsForTest(testRealm.realmIndexQueryEngine, {
        filter: {
          on: { module: rri(`${realmHref}webpage`), name: 'WebPage' },
          in: { url: ['https://example.com'] },
        },
      });
      assert.deepEqual(
        data.map((r) => r.id),
        [rri(`${realmHref}home`)],
        'matches only the exact raw value; the trailing-slash card is not over-matched',
      );
    });

    test('the type icon rides as a deduped icon resource on the entry', async function (assert) {
      let doc =
        await testRealm.realmIndexQueryEngine.searchEntries(personQuery());
      // both same-type results point at the one shared icon resource, keyed
      // by the native-type internal key
      assert.strictEqual(iconIdOf(entryFor(doc, johnId)!), personKey);
      assert.strictEqual(iconIdOf(entryFor(doc, janeId)!), personKey);
      let icons = iconsIn(doc);
      assert.strictEqual(
        icons.length,
        1,
        'the shared type icon is included exactly once',
      );
      assert.strictEqual(icons[0].id, personKey);
      assert.ok(
        icons[0].attributes.iconHtml.length > 0,
        'the icon resource carries the icon markup',
      );
      // the deduped resource carries the full type descriptor
      assert.strictEqual(
        icons[0].attributes.displayName,
        'Person',
        'the type descriptor carries the card def display name',
      );
      assert.deepEqual(
        icons[0].attributes.codeRef,
        { module: `${realmHref}person`, name: 'Person' },
        'the type descriptor carries the card def code ref',
      );
      // the icon no longer rides on each html rendering
      let html = htmlIn(doc, `${johnId}#fitted#${personKey}`)!;
      assert.false(
        'iconHtml' in html.attributes,
        'the icon moved off the html resource',
      );
    });

    test('an explicit htmlQuery selects the rendering format', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({
          filterEq: { htmlQuery: { eq: { format: 'embedded' } } },
        }),
      );
      assert.deepEqual(doc.meta.htmlQuery, { eq: { format: 'embedded' } });
      let htmlId = `${johnId}#embedded#${personKey}`;
      assert.deepEqual(htmlIdsOf(entryFor(doc, johnId)!), [htmlId]);
      assert.true(
        normalizedHtml(htmlIn(doc, htmlId)!).includes(
          'Embedded Card Person: John',
        ),
      );
    });

    test('html.format: head selects the document head rendering', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({
          filterEq: { htmlQuery: { eq: { format: 'head' } } },
          fields: { entry: ['html'] },
        }),
      );
      assert.deepEqual(doc.meta.htmlQuery, { eq: { format: 'head' } });
      // `head` is a scalar column rendered at the row's own native type, so its
      // composite id carries the native key like the keyed formats do.
      let htmlId = `${johnId}#head#${personKey}`;
      assert.deepEqual(htmlIdsOf(entryFor(doc, johnId)!), [htmlId]);
      let html = htmlIn(doc, htmlId)!;
      assert.strictEqual(html.attributes.format, 'head');
      assert.true(
        normalizedHtml(html).includes('data-test-card-head-title'),
        `head rendering carries the card head <title>: ${html.attributes.html}`,
      );
    });

    test('html.format: head scoped to a single card URL returns only that card head markup', async function (assert) {
      // Mirrors the host-mode published-view head prefetch: an html-only query
      // at html.format: head, scoped to the single card by cardUrls. `scope:
      // 'cards'` pins the instance row, dropping the card `.json`'s dual-indexed
      // file row that shares the `cardUrls` URL.
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          cardUrls: [`${johnId}.json`],
          scope: 'cards',
          filter: {
            eq: {
              htmlQuery: { eq: { format: 'head' } },
            },
          },
          fields: { entry: ['html'] },
        }),
      );
      assert.strictEqual(
        doc.data.length,
        1,
        'only the scoped card is returned',
      );
      let entry = entryFor(doc, johnId)!;
      let htmlId = `${johnId}#head#${personKey}`;
      assert.deepEqual(htmlIdsOf(entry), [htmlId]);
      assert.strictEqual(
        entry.relationships.item,
        undefined,
        'the html-only fieldset carries no item branch',
      );
      let html = htmlIn(doc, htmlId)!;
      assert.strictEqual(html.attributes.format, 'head');
      assert.true(
        normalizedHtml(html).includes('data-test-card-head-title'),
        `head rendering carries the card head <title>: ${html.attributes.html}`,
      );
    });

    test('a disjunctive htmlQuery selects several renderings per entry', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({
          filterEq: {
            htmlQuery: {
              any: [
                { eq: { format: 'fitted' } },
                { eq: { format: 'embedded' } },
              ],
            },
          },
        }),
      );
      let fittedId = `${johnId}#fitted#${personKey}`;
      let embeddedId = `${johnId}#embedded#${personKey}`;
      let ids = htmlIdsOf(entryFor(doc, johnId)!)!;
      assert.deepEqual([...ids].sort(), [embeddedId, fittedId].sort());
      assert.true(
        normalizedHtml(htmlIn(doc, fittedId)!).includes(
          'Fitted Card Person: John',
        ),
      );
      assert.true(
        normalizedHtml(htmlIn(doc, embeddedId)!).includes(
          'Embedded Card Person: John',
        ),
      );
    });

    test('involution at the engine: not(not(q)) selects the same renderings as q', async function (assert) {
      let q = { eq: { format: 'embedded' } };
      let direct = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({ filterEq: { htmlQuery: q } }),
      );
      let doubled = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({ filterEq: { htmlQuery: { not: { not: q } } } }),
      );
      assert.deepEqual(
        doubled.data.map((entry) => htmlIdsOf(entry)),
        direct.data.map((entry) => htmlIdsOf(entry)),
      );
    });

    test('fields[entry]=item: full serializations, no html, htmlQuery inert', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({
          // an htmlQuery alongside an item-only fieldset is inert, not an
          // error
          filterEq: { htmlQuery: { eq: { format: 'embedded' } } },
          fields: { entry: ['item'] },
        }),
      );
      let entry = entryFor(doc, johnId)!;
      assert.strictEqual(entry.relationships.html, undefined);
      assert.deepEqual(entry.relationships.item, {
        data: { type: 'card', id: johnId },
      });
      assert.strictEqual(
        doc.meta.htmlQuery,
        undefined,
        'no echo when the html branch is not in play',
      );
      let item = itemIn(doc, johnId)!;
      assert.strictEqual(item.attributes?.firstName, 'John');
      assert.strictEqual(
        item.meta.sparseFields,
        undefined,
        'a full item carries no sparse marker',
      );
      assert.strictEqual(item.links?.self, johnId);
      assert.strictEqual(
        item.meta.realmInfo?.name,
        'Unnamed Workspace',
        'an item carries meta.realmInfo exactly as the live search path serializes it',
      );
      assert.strictEqual(
        (doc.included ?? []).filter((r) => r.type === 'html').length,
        0,
      );
    });

    test('fields[entry]=item.<field>: sparse items carry meta.sparseFields', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({ fields: { entry: ['item.firstName'] } }),
      );
      let item = itemIn(doc, johnId)!;
      assert.deepEqual(item.attributes, { firstName: 'John' });
      assert.deepEqual(item.meta.sparseFields, ['firstName']);
    });

    test('fields[entry]=html,item: both branches on every entry', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({ fields: { entry: ['html', 'item'] } }),
      );
      let entry = entryFor(doc, johnId)!;
      let htmlId = `${johnId}#fitted#${personKey}`;
      assert.deepEqual(htmlIdsOf(entry), [htmlId]);
      assert.deepEqual(entry.relationships.item, {
        data: { type: 'card', id: johnId },
      });
      assert.true(Boolean(htmlIn(doc, htmlId)));
      assert.strictEqual(itemIn(doc, johnId)!.attributes?.firstName, 'John');
    });

    test('sort and page ride the item query', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({
          sort: [{ by: 'item.firstName', direction: 'asc' }],
          page: { size: 1 },
        }),
      );
      assert.strictEqual(doc.meta.page.total, 2);
      assert.deepEqual(
        doc.data.map((entry) => entry.id),
        [janeId],
      );
    });

    test('mixed index: a row with no matching rendering falls back per the fieldset', async function (assert) {
      // Clear the rendering from both channels: the engine dual-reads HTML from
      // prerendered_html, falling back to boxel_index, so a rendering is absent
      // only when neither carries it.
      await dbAdapter.execute(
        `UPDATE boxel_index SET fitted_html = NULL WHERE url = '${janeId}.json'`,
      );
      await dbAdapter.execute(
        `UPDATE prerendered_html SET fitted_html = NULL WHERE url = '${janeId}.json'`,
      );
      // default mode: the fallback row carries item and omits the html
      // relationship entirely
      let doc =
        await testRealm.realmIndexQueryEngine.searchEntries(personQuery());
      let john = entryFor(doc, johnId)!;
      assert.deepEqual(htmlIdsOf(john), [`${johnId}#fitted#${personKey}`]);
      assert.strictEqual(john.relationships.item, undefined);
      let jane = entryFor(doc, janeId)!;
      assert.strictEqual(
        jane.relationships.html,
        undefined,
        'a default-mode fallback row omits the html relationship',
      );
      assert.deepEqual(jane.relationships.item, {
        data: { type: 'card', id: janeId },
      });
      // The motivating case: a no-HTML fallback row still resolves its type
      // icon (entry-level, deduped) — a consumer can paint a placeholder icon
      // without loading the live instance.
      assert.strictEqual(
        iconIdOf(jane),
        personKey,
        'a fallback row carries the icon relationship',
      );
      assert.ok(
        iconsIn(doc).some((icon) => icon.id === personKey),
        'the icon resource is included for the fallback row',
      );
      let item = itemIn(doc, janeId)!;
      assert.strictEqual(item.attributes?.firstName, 'Jane');
      assert.strictEqual(item.meta.sparseFields, undefined);

      // a pinned html branch keeps membership visible with an empty array
      let pinned = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({ fields: { entry: ['html'] } }),
      );
      let pinnedJane = entryFor(pinned, janeId)!;
      assert.deepEqual(
        pinnedJane.relationships.html,
        { data: [] },
        'matched, no rendering yet',
      );
      assert.strictEqual(pinnedJane.relationships.item, undefined);
    });

    test('an error row with nothing renderable surfaces a markupless error rendering', async function (assert) {
      // a first indexing attempt that failed: error flagged, no last-known-good
      // renderings, no serialization to fall back to. The indexer ran and
      // failed, so the rendering surfaces in its failed state — isError, no
      // html — at the format the htmlQuery names and the row's own type.
      await dbAdapter.execute(
        `UPDATE boxel_index SET has_error = TRUE, pristine_doc = NULL, fitted_html = NULL, embedded_html = NULL, atom_html = NULL, head_html = NULL WHERE url = '${janeId}.json'`,
      );
      // The renderings the engine reads live on prerendered_html; clear them
      // there too so nothing renderable remains for the error row.
      await dbAdapter.execute(
        `UPDATE prerendered_html SET fitted_html = NULL, embedded_html = NULL, atom_html = NULL, head_html = NULL WHERE url = '${janeId}.json'`,
      );
      let doc =
        await testRealm.realmIndexQueryEngine.searchEntries(personQuery());
      let jane = entryFor(doc, janeId)!;
      let htmlId = `${janeId}#fitted#${personKey}`;
      assert.deepEqual(htmlIdsOf(jane), [htmlId]);
      assert.strictEqual(jane.relationships.item, undefined);
      let html = htmlIn(doc, htmlId)!;
      assert.true(html.attributes.isError);
      assert.false('html' in html.attributes, 'no last-known-good markup');
      assert.strictEqual(html.attributes.format, 'fitted');
      assert.deepEqual(html.attributes.renderType, {
        module: `${realmHref}person`,
        name: 'Person',
      });
      assert.strictEqual(html.attributes.cardType, 'Person');
    });

    test('file results flow through the same fieldset semantics', async function (assert) {
      let fileUrl = `${realmHref}hello.md`;
      let query = parseSearchEntryQueryFromPayload({
        filter: {
          'item.on': { module: baseRRI('card-api'), name: 'FileDef' },
          eq: { 'item.url': fileUrl },
        },
        fields: { entry: ['item'] },
      });
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(query);
      let entry = entryFor(doc, fileUrl)!;
      assert.deepEqual(entry.relationships.item, {
        data: { type: 'file-meta', id: fileUrl },
      });
      let item = itemIn(doc, fileUrl)!;
      assert.strictEqual(item.type, 'file-meta');
      assert.strictEqual(item.attributes?.name, 'hello.md');

      // default fieldset: a file's rendering is its own (no renderType in
      // the composite id — files render natively)
      let defaultDoc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          filter: {
            'item.on': { module: baseRRI('card-api'), name: 'FileDef' },
            eq: { 'item.url': fileUrl },
          },
        }),
      );
      assert.deepEqual(defaultDoc.meta.htmlQuery, {
        eq: { format: 'fitted' },
      });
      let defaultEntry = entryFor(defaultDoc, fileUrl)!;
      let ids = htmlIdsOf(defaultEntry);
      if (ids) {
        assert.deepEqual(ids, [`${fileUrl}#fitted`]);
        let html = htmlIn(defaultDoc, ids[0])!;
        assert.strictEqual(html.attributes.renderType, undefined);
        assert.strictEqual(html.attributes.format, 'fitted');
      } else {
        assert.deepEqual(
          defaultEntry.relationships.item,
          { data: { type: 'file-meta', id: fileUrl } },
          'a file with no fitted rendering falls back to its item',
        );
      }
    });

    test('mixed default: an anchorless entry query returns both card instances and files', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({ fields: { entry: ['item'] } }),
      );

      assert.ok(
        entryFor(doc, johnId),
        'the card instance surfaces as an entry',
      );
      assert.strictEqual(
        itemIn(doc, johnId)?.type,
        'card',
        'a card instance carries a card item',
      );

      let helloUrl = `${realmHref}hello.md`;
      assert.ok(entryFor(doc, helloUrl), 'a plain file surfaces as an entry');
      assert.strictEqual(
        itemIn(doc, helloUrl)?.type,
        'file-meta',
        'a plain file carries a file-meta item',
      );

      // By default nothing is deduped: a card `.json` surfaces both as its
      // instance entry (`.../john`) and its dual-indexed file entry
      // (`.../john.json`), kept distinct by the `(url, type)` grouping.
      assert.ok(
        entryFor(doc, `${johnId}.json`),
        'the card-instance `.json` file row also surfaces by default',
      );
      assert.strictEqual(
        itemIn(doc, `${johnId}.json`)?.type,
        'file-meta',
        'the card-instance `.json` row carries a file-meta item',
      );
    });

    test('eq item._isCardInstanceFile false dedups a dual-indexed card .json file row', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          // `_isCardInstanceFile` is stamped only on a card `.json`'s file row,
          // so `eq: false` (absent-as-false) keeps cards + plain files and drops
          // that row — the explicit mixed-scope dedup.
          filter: { eq: { 'item._isCardInstanceFile': false } },
          fields: { entry: ['item'] },
        }),
      );

      assert.ok(entryFor(doc, johnId), 'the card instance is kept');
      assert.ok(
        entryFor(doc, `${realmHref}hello.md`),
        'a plain file is kept (no `_isCardInstanceFile` key)',
      );
      assert.notOk(
        entryFor(doc, `${johnId}.json`),
        'the card-instance `.json` file row is dropped',
      );
    });

    test("scope: 'all' returns both rows of a dual-indexed card .json", async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          scope: 'all',
          fields: { entry: ['item'] },
        }),
      );
      assert.ok(entryFor(doc, johnId), 'the card instance row is present');
      assert.ok(
        entryFor(doc, `${johnId}.json`),
        'the dual-indexed .json file row is ALSO present (dedup is explicit)',
      );
      assert.ok(entryFor(doc, `${realmHref}hello.md`), 'a plain file too');
    });

    test("scope: 'cards' pins card-instance rows (no file rows at all)", async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          scope: 'cards',
          fields: { entry: ['item'] },
        }),
      );
      assert.ok(entryFor(doc, johnId), 'the card instance is kept');
      assert.notOk(
        entryFor(doc, `${johnId}.json`),
        'the card .json file row is excluded by the card scope',
      );
      assert.notOk(
        entryFor(doc, `${realmHref}hello.md`),
        'a plain file is excluded by the card scope',
      );
    });

    test("scope: 'files' pins file rows (no card-instance rows)", async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          scope: 'files',
          fields: { entry: ['item'] },
        }),
      );
      assert.ok(
        entryFor(doc, `${realmHref}hello.md`),
        'a plain file row is present',
      );
      assert.ok(
        entryFor(doc, `${johnId}.json`),
        'a card .json file row is present',
      );
      assert.notOk(
        entryFor(doc, johnId),
        'the card-instance row is excluded by the file scope',
      );
    });

    test('eq item._isCardInstanceFile true selects only the dual-indexed card .json file rows', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          filter: { eq: { 'item._isCardInstanceFile': true } },
          fields: { entry: ['item'] },
        }),
      );
      assert.ok(
        entryFor(doc, `${johnId}.json`),
        'the card .json file row is selected',
      );
      assert.notOk(entryFor(doc, johnId), 'the card-instance row is not');
      assert.notOk(
        entryFor(doc, `${realmHref}hello.md`),
        'a plain file (no key) is not',
      );
    });

    test('a positive card-type anchor keeps a mixed-default query cards-only', async function (assert) {
      // The entry wire grammar expresses a card-type anchor as `item.on`.
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          filter: {
            'item.on': { module: `${realmHref}person`, name: 'Person' },
          },
          fields: { entry: ['item'] },
        }),
      );

      assert.strictEqual(
        doc.meta.page.total,
        2,
        'only the two Person instances match',
      );
      assert.ok(entryFor(doc, johnId));
      assert.ok(entryFor(doc, janeId));
      let fileItems = (doc.included ?? []).filter(
        (resource) => resource.type === 'file-meta',
      );
      assert.strictEqual(fileItems.length, 0, 'no file rows leak in');
    });

    test('A-Z `_title` sort gives file rows real sort values (not a NULL that sinks them)', async function (assert) {
      // Regression guard for the mixed-search A-Z sort. A file row carries the
      // synthetic `_title` but not `cardTitle`, so sorting on `cardTitle`
      // leaves every file's sort value NULL — under NULLS LAST they collapse to
      // the `url` tiebreaker (always ascending), so their order is invariant to
      // `direction`. Sorting on `_title` gives files distinct, real sort values,
      // so their relative order reverses between asc and desc. The sort anchors
      // on a card type only to resolve the synthetic key; it does not filter,
      // so the mixed set (here undeduped, guaranteeing several file rows) keeps
      // its files.
      let titleSort = (direction: 'asc' | 'desc') =>
        parseSearchEntryQueryFromPayload({
          sort: [
            {
              by: 'item._title',
              'item.on': { module: `${realmHref}person`, name: 'Person' },
              direction,
            },
          ],
          page: { size: 100 },
          fields: { entry: ['item'] },
        });
      let fileOrder = (doc: EntryCollectionDocument) =>
        doc.data
          .map((entry) => entry.id)
          .filter((id) => itemIn(doc, id)?.type === 'file-meta');

      let ascDoc = await testRealm.realmIndexQueryEngine.searchEntries(
        titleSort('asc'),
      );
      let descDoc = await testRealm.realmIndexQueryEngine.searchEntries(
        titleSort('desc'),
      );
      let asc = fileOrder(ascDoc);
      let desc = fileOrder(descDoc);

      assert.true(
        asc.length >= 2,
        'the mixed set carries at least two file rows to order',
      );
      assert.deepEqual(
        desc,
        [...asc].reverse(),
        'file rows reverse with sort direction — they carry a real `_title` sort value, not a NULL pinned to the url tiebreaker',
      );
    });
  });

  module('searchEntries css + render-type', function (hooks) {
    let testRealm: Realm;
    let realmHref: string;

    function onRealmSetup(args: { testRealm: Realm }) {
      testRealm = args.testRealm;
      realmHref = new URL(testRealm.url).href;
    }

    setupPermissionedRealmCached(hooks, {
      realmURL: new URL('http://127.0.0.1:4444/test/'),
      permissions: { '*': ['read'] },
      fileSystem: {
        'person.gts': `
          import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringField);
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card Person: <@fields.firstName/>

                <style scoped>
                  .border {
                    border: 1px solid red;
                  }
                </style>
              </template>
            }
          }
        `,
        'fancy-person.gts': `
          import { Person } from './person';
          import { contains, field, Component } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class FancyPerson extends Person {
            @field favoriteColor = contains(StringField);

            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card FancyPerson: <@fields.firstName/>

                <style scoped>
                  .fancy-border {
                    border: 1px solid pink;
                  }
                </style>
              </template>
            }
          }
        `,
        'aaron.json': {
          data: {
            attributes: { firstName: 'Aaron' },
            meta: {
              adoptsFrom: { module: rri('./person'), name: 'Person' },
            },
          },
        },
        'craig.json': {
          data: {
            attributes: { firstName: 'Craig' },
            meta: {
              adoptsFrom: { module: rri('./person'), name: 'Person' },
            },
          },
        },
        'jane.json': {
          data: {
            attributes: { firstName: 'Jane', favoriteColor: 'pink' },
            meta: {
              adoptsFrom: {
                module: rri('./fancy-person'),
                name: 'FancyPerson',
              },
            },
          },
        },
      },
      onRealmSetup,
    });

    function fancyQuery(htmlQuery: unknown) {
      return parseSearchEntryQueryFromPayload({
        filter: {
          'item.on': {
            module: `${realmHref}fancy-person`,
            name: 'FancyPerson',
          },
          eq: { htmlQuery },
        },
      });
    }

    test('identical css dedupes to one resource shared across renderings', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          filter: {
            'item.on': { module: `${realmHref}person`, name: 'Person' },
            eq: { htmlQuery: { eq: { format: 'embedded' } } },
          },
        }),
      );
      assert.strictEqual(doc.meta.page.total, 3);
      let aaronHtml = htmlIn(
        doc,
        `${realmHref}aaron#embedded#${realmHref}person/Person`,
      )!;
      let craigHtml = htmlIn(
        doc,
        `${realmHref}craig#embedded#${realmHref}person/Person`,
      )!;
      assert.deepEqual(
        aaronHtml.relationships.styles.data,
        craigHtml.relationships.styles.data,
        'two instances of the same type reference the same stylesheets',
      );
      assert.true(aaronHtml.relationships.styles.data.length > 0);
      let css = cssIn(doc);
      let ids = css.map((resource) => resource.id);
      assert.deepEqual(
        ids,
        [...new Set(ids)],
        'each stylesheet travels exactly once',
      );
      for (let { id } of aaronHtml.relationships.styles.data) {
        assert.true(
          ids.includes(id),
          `referenced stylesheet ${id} is in included`,
        );
      }
    });

    test('a renderType predicate renders a subclass as its ancestor', async function (assert) {
      let janeId = `${realmHref}jane`;
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        fancyQuery({
          every: [
            { eq: { format: 'embedded' } },
            {
              eq: {
                renderType: { module: `${realmHref}person`, name: 'Person' },
              },
            },
          ],
        }),
      );
      let htmlId = `${janeId}#embedded#${realmHref}person/Person`;
      assert.deepEqual(htmlIdsOf(entryFor(doc, janeId)!), [htmlId]);
      let html = htmlIn(doc, htmlId)!;
      assert.deepEqual(html.attributes.renderType, {
        module: `${realmHref}person`,
        name: 'Person',
      });
      assert.true(normalizedHtml(html).includes('Embedded Card Person: Jane'));
    });

    test('no renderType predicate → only the native rendering is in play', async function (assert) {
      let janeId = `${realmHref}jane`;
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        fancyQuery({ eq: { format: 'embedded' } }),
      );
      let nativeId = `${janeId}#embedded#${realmHref}fancy-person/FancyPerson`;
      assert.deepEqual(htmlIdsOf(entryFor(doc, janeId)!), [nativeId]);
      let html = htmlIn(doc, nativeId)!;
      assert.deepEqual(html.attributes.renderType, {
        module: `${realmHref}fancy-person`,
        name: 'FancyPerson',
      });
      assert.true(
        normalizedHtml(html).includes('Embedded Card FancyPerson: Jane'),
      );
    });

    test('a negated renderType predicate opens the chain and excludes the negated type', async function (assert) {
      let janeId = `${realmHref}jane`;
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        fancyQuery({
          every: [
            { eq: { format: 'embedded' } },
            {
              not: {
                eq: {
                  renderType: {
                    module: `${realmHref}person`,
                    name: 'Person',
                  },
                },
              },
            },
          ],
        }),
      );
      let ids = htmlIdsOf(entryFor(doc, janeId)!)!;
      assert.true(
        ids.includes(`${janeId}#embedded#${realmHref}fancy-person/FancyPerson`),
        'the native rendering matches',
      );
      assert.false(
        ids.includes(`${janeId}#embedded#${realmHref}person/Person`),
        'the negated ancestor rendering is excluded',
      );
    });
  });
});
