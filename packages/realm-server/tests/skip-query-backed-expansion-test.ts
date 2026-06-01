import { module, test } from 'qunit';
import { basename } from 'path';
import { rri } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import { setupPermissionedRealmCached } from './helpers';

const testRealm = new URL('http://127.0.0.1:4452/test/');

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['target.gts'] = `
    import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
    import StringField from "https://cardstack.com/base/string";

    export class Target extends CardDef {
      @field name = contains(StringField);
      // cardTitle is the field the query-backed linksToMany below filters
      // on; it must be a real field on the target for the query to match.
      @field cardTitle = contains(StringField);
    }
  `;

  fs['consumer.gts'] = `
    import { contains, field, linksTo, linksToMany, CardDef } from "https://cardstack.com/base/card-api";
    import StringField from "https://cardstack.com/base/string";
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

module(basename(__filename), function () {
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
      let doc = await realm.realmIndexQueryEngine.searchCards(
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

    test('searchCards with omitIncluded: no included[], but roots keep their query-backed seed', async function (assert) {
      let doc = await realm.realmIndexQueryEngine.searchCards(
        {
          filter: {
            type: { module: rri(`${testRealm}consumer`), name: 'Consumer' },
          },
        },
        { loadLinks: true, skipQueryBackedExpansion: true, omitIncluded: true },
      );

      assert.strictEqual(doc.data.length, 1, 'one consumer matched');
      assert.strictEqual(
        (doc.included ?? []).length,
        0,
        'included[] is omitted entirely — neither static nor query-backed targets are expanded',
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

      // The query-backed seed survives so the host can hydrate the listed
      // IDs by URL via card+source without firing a fresh live search.
      let queryLinks = relationships?.queryLinks;
      assert.strictEqual(
        Array.isArray(queryLinks?.data) ? queryLinks?.data.length : -1,
        3,
        'relationships.queryLinks.data still names the three matched IDs',
      );
      assert.ok(
        queryLinks?.links?.search,
        'relationships.queryLinks keeps its links.search seed',
      );

      // The per-item `queryLinks.N` sub-entries are stripped so they do not
      // deserialize to orphan links against the empty included[].
      let perItemKeys = Object.keys(relationships ?? {}).filter((k) =>
        /^queryLinks\.\d+$/.test(k),
      );
      assert.deepEqual(
        perItemKeys,
        [],
        'query-backed per-item sub-entries are stripped',
      );

      // The static linksTo keeps a resolvable reference (the host turns an
      // absent target into a not-loaded sentinel and lazy-loads it via
      // card+source) but its target is NOT in included[].
      let directLink = relationships?.directLink;
      let directRef =
        directLink?.links?.self ??
        (directLink?.data && !Array.isArray(directLink.data)
          ? directLink.data.id
          : undefined);
      assert.ok(
        directRef ? directRef.includes('direct-target') : false,
        'static linksTo keeps a reference to its target for lazy loading',
      );
      let includedIds = (doc.included ?? []).map((r) => r.id);
      assert.notOk(
        includedIds.some((id) => id?.endsWith('/direct-target')),
        'static linksTo target is NOT expanded into included',
      );
    });

    test('omitIncluded is prerender-scoped: default search still ships a compound included[]', async function (assert) {
      let doc = await realm.realmIndexQueryEngine.searchCards(
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
});
