import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { rri } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

const testRealm = new URL('http://127.0.0.1:4452/test/');

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['target.gts'] = `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Target extends CardDef {
      @field name = contains(StringField);
      // cardTitle is the field the query-backed linksToMany below filters
      // on; it must be a real field on the target for the query to match.
      @field cardTitle = contains(StringField);
    }
  `;

  fs['consumer.gts'] = `
    import { contains, field, linksTo, linksToMany, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Target } from "./target";

    export class Consumer extends CardDef {
      @field name = contains(StringField);

      // Static linksTo (named reference).
      @field directLink = linksTo(() => Target);

      // Query-backed linksToMany — resolves to every Target with the matching cardTitle.
      @field queryLinks = linksToMany(() => Target, {
        query: {
          filter: {
            eq: { cardTitle: 'query-match' },
          },
          page: { size: 10, number: 0 },
        },
      });
    }
  `;

  for (let i = 0; i < 3; i++) {
    fs[`query-target-${i}.json`] = {
      data: {
        attributes: { name: `QT${i}`, cardTitle: 'query-match' },
        meta: {
          adoptsFrom: { module: rri('./target'), name: 'Target' },
        },
      },
    } as LooseSingleCardDocument;
  }

  fs['direct-target.json'] = {
    data: {
      attributes: { name: 'DT', cardTitle: 'direct' },
      meta: {
        adoptsFrom: { module: rri('./target'), name: 'Target' },
      },
    },
  } as LooseSingleCardDocument;

  fs['consumer-1.json'] = {
    data: {
      attributes: { name: 'C1' },
      relationships: {
        directLink: { links: { self: './direct-target' } },
      },
      meta: {
        adoptsFrom: { module: rri('./consumer'), name: 'Consumer' },
      },
    },
  } as LooseSingleCardDocument;

  return fs;
}

module(basename(import.meta.filename), function () {
  module('skipQueryBackedExpansion', function (hooks) {
    let realm: Realm;

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: testRealm,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      onRealmSetup({ testRealm: r }) {
        realm = r;
      },
    });

    test('default cardDocument expands both static linksTo and query-backed linksToMany into included[]', async function (assert) {
      let result = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}consumer-1`),
        { loadLinks: true },
      );
      assert.strictEqual(result?.type, 'doc', 'doc returned');
      let doc = result?.type === 'doc' ? result.doc : undefined;
      let includedIds = (doc?.included ?? []).map((r) => r.id);
      assert.ok(
        includedIds.some((id) => id?.endsWith('/direct-target')),
        'static linksTo target is in included',
      );
      assert.strictEqual(
        includedIds.filter((id) => id?.includes('/query-target-')).length,
        3,
        'all three query-backed linksToMany matches are in included',
      );
    });

    test('with skipQueryBackedExpansion: static linksTo still in included, query-backed matches are not', async function (assert) {
      let result = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}consumer-1`),
        { loadLinks: true, skipQueryBackedExpansion: true },
      );
      assert.strictEqual(result?.type, 'doc', 'doc returned');
      let doc = result?.type === 'doc' ? result.doc : undefined;
      let includedIds = (doc?.included ?? []).map((r) => r.id);
      assert.ok(
        includedIds.some((id) => id?.endsWith('/direct-target')),
        'static linksTo target is still in included',
      );
      assert.strictEqual(
        includedIds.filter((id) => id?.includes('/query-target-')).length,
        0,
        'no query-backed linksToMany matches expanded into included',
      );

      let queryLinks = (
        doc?.data.relationships as
          | Record<string, { data?: Array<{ id: string }> }>
          | undefined
      )?.queryLinks;
      assert.strictEqual(
        queryLinks?.data?.length,
        3,
        'relationships.queryLinks.data still names the matched IDs',
      );
    });

    test('searchCards respects skipQueryBackedExpansion', async function (assert) {
      let doc = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        {
          filter: {
            type: { module: rri(`${testRealm}consumer`), name: 'Consumer' },
          },
        },
        { loadLinks: true, skipQueryBackedExpansion: true },
      );

      assert.strictEqual(doc.data.length, 1, 'one consumer matched');
      let includedIds = (doc.included ?? []).map((r) => r.id);
      assert.ok(
        includedIds.some((id) => id?.endsWith('/direct-target')),
        'static linksTo target still expanded',
      );
      assert.strictEqual(
        includedIds.filter((id) => id?.includes('/query-target-')).length,
        0,
        'no query-backed linksToMany matches in included',
      );
    });
  });

  module('omitIncluded', function (hooks) {
    let realm: Realm;

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: testRealm,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      onRealmSetup({ testRealm: r }) {
        realm = r;
      },
    });

    test('searchCards with omitIncluded skips loadLinks: pristine rows, no query-field umbrella, no included[]', async function (assert) {
      let doc = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        {
          filter: {
            type: { module: rri(`${testRealm}consumer`), name: 'Consumer' },
          },
        },
        { loadLinks: true, omitIncluded: true },
      );

      assert.strictEqual(doc.data.length, 1, 'one consumer matched');
      assert.ok(
        doc.data[0].id?.endsWith('/consumer-1'),
        'the matching result identifier is returned',
      );
      assert.strictEqual(
        (doc.included ?? []).length,
        0,
        'included[] is omitted entirely',
      );

      let relationships = doc.data[0].relationships as
        | Record<
            string,
            {
              links?: { self?: string | null; search?: string | null };
              data?: { id: string } | Array<{ id: string }> | null;
            }
          >
        | undefined;

      // loadLinks / populateQueryFields never ran, so the query-backed field
      // carries no assembled umbrella: no `links.search`, and it does not name
      // any matched targets. The host re-resolves the field from card+source.
      let queryLinks = relationships?.queryLinks;
      assert.notOk(
        queryLinks?.links?.search,
        'query-backed field has no links.search (umbrella never assembled)',
      );
      assert.strictEqual(
        Array.isArray(queryLinks?.data) ? queryLinks!.data.length : 0,
        0,
        'query-backed field does not name any matched targets',
      );

      // No per-item `queryLinks.N` sub-entries leaked onto the wire.
      let perItemKeys = Object.keys(relationships ?? {}).filter((k) =>
        /^queryLinks\.\d+$/.test(k),
      );
      assert.deepEqual(perItemKeys, [], 'no query-backed per-item sub-entries');
    });

    test('omitIncluded is prerender-scoped: default search still ships a compound included[]', async function (assert) {
      let doc = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        {
          filter: {
            type: { module: rri(`${testRealm}consumer`), name: 'Consumer' },
          },
        },
        { loadLinks: true },
      );

      let includedIds = (doc.included ?? []).map((r) => r.id);
      assert.ok(
        includedIds.some((id) => id?.endsWith('/direct-target')),
        'static linksTo target is in included for non-prerender callers',
      );
      assert.strictEqual(
        includedIds.filter((id) => id?.includes('/query-target-')).length,
        3,
        'query-backed matches are in included for non-prerender callers',
      );
    });
  });

  // The third position on how much of a card's link graph a response carries.
  // `omitIncluded` above skips the relationship pass outright; the default
  // assembles the whole closure; this one answers the relationships and
  // side-loads nothing, so a consumer learns which cards a field names and
  // fetches the ones it displays.
  module('resolveLinksOnly', function (hooks) {
    let realm: Realm;

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: testRealm,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      onRealmSetup({ testRealm: r }) {
        realm = r;
      },
    });

    test('cardDocument answers both link kinds and side-loads neither', async function (assert) {
      let result = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}consumer-1`),
        { loadLinks: true, resolveLinksOnly: true },
      );
      assert.strictEqual(result?.type, 'doc', 'doc returned');
      let doc = result?.type === 'doc' ? result.doc : undefined;
      assert.strictEqual(
        (doc?.included ?? []).length,
        0,
        'nothing is side-loaded',
      );

      // The document is a function of a query this realm ran, so it must say
      // so: that is what keeps it out of a response cache under a validator a
      // write to the matching cards would not move. The signal survives only
      // because the relationships are answered before the walk is left.
      assert.true(
        result?.type === 'doc' && result.queryBacked,
        'the document reports that a query resolved a field',
      );

      let relationships = doc?.data.relationships as
        | Record<
            string,
            {
              links?: { self?: string | null; search?: string | null };
              data?: { id: string } | Array<{ id: string }> | null;
            }
          >
        | undefined;

      // The static link is left the way the pristine row carries it: a target
      // named by `links.self` and no resource to go with it, which is what the
      // consumer reads as a link it has not loaded yet.
      assert.ok(
        relationships?.directLink?.links?.self,
        'the static link still names its target',
      );

      // The query-backed field keeps the answer a consumer cannot cheaply
      // recompute — which cards the query matched — without the cards.
      let queryLinks = relationships?.queryLinks;
      assert.ok(
        queryLinks?.links?.search,
        'the query-backed field carries its search link',
      );
      assert.strictEqual(
        Array.isArray(queryLinks?.data) ? queryLinks!.data.length : 0,
        3,
        'the query-backed field names all three matches',
      );

      // Per-item sub-entries would each be read as a followable link whose
      // target is expected in included[], so they come off the wire with it.
      let perItemKeys = Object.keys(relationships ?? {}).filter((k) =>
        /^queryLinks\.\d+$/.test(k),
      );
      assert.deepEqual(perItemKeys, [], 'no query-backed per-item sub-entries');
    });

    test('searchCards answers the results relationships and side-loads nothing', async function (assert) {
      let doc = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        {
          filter: {
            type: { module: rri(`${testRealm}consumer`), name: 'Consumer' },
          },
        },
        { loadLinks: true, resolveLinksOnly: true },
      );

      assert.strictEqual(doc.data.length, 1, 'one consumer matched');
      assert.strictEqual(
        (doc.included ?? []).length,
        0,
        'nothing is side-loaded',
      );

      let relationships = doc.data[0].relationships as
        | Record<
            string,
            {
              links?: { self?: string | null; search?: string | null };
              data?: { id: string } | Array<{ id: string }> | null;
            }
          >
        | undefined;
      assert.ok(
        relationships?.directLink?.links?.self,
        'the static link still names its target',
      );
      assert.strictEqual(
        Array.isArray(relationships?.queryLinks?.data)
          ? (relationships!.queryLinks!.data as Array<{ id: string }>).length
          : 0,
        3,
        'the query-backed field names all three matches',
      );
    });
  });
});
