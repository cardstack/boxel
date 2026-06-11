import { module, test } from 'qunit';
import { basename } from 'path';
import {
  baseRRI,
  parseSearchEntryQueryFromPayload,
  rri,
  type CardResource,
  type CssResource,
  type FileMetaResource,
  type HtmlResource,
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

function entryFor(
  doc: SearchEntryCollectionDocument,
  id: string,
): SearchEntryResource | undefined {
  return doc.data.find((entry) => entry.id === id);
}

module(basename(__filename), function () {
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

    test('default fieldset: html-backed entries with native render type', async function (assert) {
      let doc =
        await testRealm.realmIndexQueryEngine.searchEntries(personQuery());
      assert.strictEqual(doc.meta.page.total, 2);
      let htmlId = `${johnId}#fitted#${personKey}`;
      let entry = entryFor(doc, johnId)!;
      assert.deepEqual(entry.relationships.html, {
        data: { type: 'html', id: htmlId },
      });
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

    test('html.format selects the rendering format', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({ filterEq: { 'html.format': 'embedded' } }),
      );
      let htmlId = `${johnId}#embedded#${personKey}`;
      assert.deepEqual(entryFor(doc, johnId)!.relationships.html, {
        data: { type: 'html', id: htmlId },
      });
      assert.true(
        normalizedHtml(htmlIn(doc, htmlId)!).includes(
          'Embedded Card Person: John',
        ),
      );
    });

    test('fields[search-entry]=item: full serializations, no html', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        personQuery({ fields: { 'search-entry': ['item'] } }),
      );
      let entry = entryFor(doc, johnId)!;
      assert.strictEqual(entry.relationships.html, undefined);
      assert.deepEqual(entry.relationships.item, {
        data: { type: 'card', id: johnId },
      });
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
      assert.deepEqual(entry.relationships.html, {
        data: { type: 'html', id: htmlId },
      });
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

    test('mixed index: a row with no html falls back to a full item', async function (assert) {
      await dbAdapter.execute(
        `UPDATE boxel_index SET fitted_html = NULL WHERE url = '${janeId}.json'`,
      );
      let doc =
        await testRealm.realmIndexQueryEngine.searchEntries(personQuery());
      let john = entryFor(doc, johnId)!;
      assert.true(Boolean(john.relationships.html), 'john is html-backed');
      assert.strictEqual(john.relationships.item, undefined);
      let jane = entryFor(doc, janeId)!;
      assert.strictEqual(jane.relationships.html, undefined);
      assert.deepEqual(jane.relationships.item, {
        data: { type: 'card', id: janeId },
      });
      let item = itemIn(doc, janeId)!;
      assert.strictEqual(item.attributes?.firstName, 'Jane');
      assert.strictEqual(item.meta.sparseFields, undefined);
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

      // default fieldset: the file's rendering is its own (no renderType in
      // the composite id — files render natively)
      let defaultDoc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          filter: {
            'item.on': { module: baseRRI('card-api'), name: 'FileDef' },
            eq: { 'item.url': fileUrl },
          },
        }),
      );
      let defaultEntry = entryFor(defaultDoc, fileUrl)!;
      let htmlRel = defaultEntry.relationships.html;
      if (htmlRel) {
        assert.strictEqual(htmlRel.data.id, `${fileUrl}#fitted`);
        let html = htmlIn(defaultDoc, htmlRel.data.id)!;
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

    test('identical css dedupes to one resource shared across renderings', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          filter: {
            'item.on': { module: `${realmHref}person`, name: 'Person' },
            eq: { 'html.format': 'embedded' },
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

    test('explicit html.renderType renders a subclass as its ancestor', async function (assert) {
      let janeId = `${realmHref}jane`;
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          filter: {
            'item.on': {
              module: `${realmHref}fancy-person`,
              name: 'FancyPerson',
            },
            eq: {
              'html.format': 'embedded',
              'html.renderType': {
                module: `${realmHref}person`,
                name: 'Person',
              },
            },
          },
        }),
      );
      let htmlId = `${janeId}#embedded#${realmHref}person/Person`;
      assert.deepEqual(entryFor(doc, janeId)!.relationships.html, {
        data: { type: 'html', id: htmlId },
      });
      let html = htmlIn(doc, htmlId)!;
      assert.deepEqual(html.attributes.renderType, {
        module: `${realmHref}person`,
        name: 'Person',
      });
      assert.true(normalizedHtml(html).includes('Embedded Card Person: Jane'));
    });

    test('omitted html.renderType renders each result as its own native type', async function (assert) {
      let janeId = `${realmHref}jane`;
      let doc = await testRealm.realmIndexQueryEngine.searchEntries(
        parseSearchEntryQueryFromPayload({
          filter: {
            'item.on': {
              module: `${realmHref}fancy-person`,
              name: 'FancyPerson',
            },
            eq: { 'html.format': 'embedded' },
          },
        }),
      );
      let htmlId = `${janeId}#embedded#${realmHref}fancy-person/FancyPerson`;
      let html = htmlIn(doc, htmlId)!;
      assert.deepEqual(html.attributes.renderType, {
        module: `${realmHref}fancy-person`,
        name: 'FancyPerson',
      });
      assert.true(
        normalizedHtml(html).includes('Embedded Card FancyPerson: Jane'),
      );
    });
  });
});
