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
  type SearchEntryCollectionDocument,
  type SearchEntryResource,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { setupPermissionedRealmCached } from './helpers/index.ts';

function htmlIn(
  doc: SearchEntryCollectionDocument,
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
  doc: SearchEntryCollectionDocument,
  id: string,
): CardResource | FileMetaResource | undefined {
  return doc.included?.find(
    (resource): resource is CardResource | FileMetaResource =>
      (resource.type === 'card' || resource.type === 'file-meta') &&
      resource.id === id,
  );
}

function cssIn(doc: SearchEntryCollectionDocument): CssResource[] {
  return (doc.included ?? []).filter(
    (resource): resource is CssResource => resource.type === 'css',
  );
}

function iconsIn(doc: SearchEntryCollectionDocument): IconResource[] {
  return (doc.included ?? []).filter(
    (resource): resource is IconResource => resource.type === 'icon',
  );
}

function iconIdOf(entry: SearchEntryResource): string | undefined {
  return entry.relationships.icon?.data.id;
}

function entryFor(
  doc: SearchEntryCollectionDocument,
  id: string,
): SearchEntryResource | undefined {
  return doc.data.find((entry) => entry.id === id);
}

function htmlIdsOf(entry: SearchEntryResource): string[] | undefined {
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
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

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

    test('fields[search-entry]=item: full serializations, no html, htmlQuery inert', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({
          // an htmlQuery alongside an item-only fieldset is inert, not an
          // error
          filterEq: { htmlQuery: { eq: { format: 'embedded' } } },
          fields: { 'search-entry': ['item'] },
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

    test('fields[search-entry]=item.<field>: sparse items carry meta.sparseFields', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({ fields: { 'search-entry': ['item.firstName'] } }),
      );
      let item = itemIn(doc, johnId)!;
      assert.deepEqual(item.attributes, { firstName: 'John' });
      assert.deepEqual(item.meta.sparseFields, ['firstName']);
    });

    test('fields[search-entry]=html,item: both branches on every entry', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({ fields: { 'search-entry': ['html', 'item'] } }),
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
      await dbAdapter.execute(
        `UPDATE boxel_index SET fitted_html = NULL WHERE url = '${janeId}.json'`,
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
        personQuery({ fields: { 'search-entry': ['html'] } }),
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
        fields: { 'search-entry': ['item'] },
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
          import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

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
          import { contains, field, Component } from "https://cardstack.com/base/card-api";
          import StringField from "https://cardstack.com/base/string";

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
