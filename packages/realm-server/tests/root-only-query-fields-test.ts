import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { rri } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

const testRealm = new URL('http://127.0.0.1:4462/test/');

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['target.gts'] = `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Target extends CardDef {
      @field name = contains(StringField);
      // The field both query-backed fields below filter on.
      @field cardTitle = contains(StringField);
    }
  `;

  // Reached only as a side-loaded resource: nothing queries for it, and the
  // parent links to it by name.
  fs['child.gts'] = `
    import { contains, field, linksToMany, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Target } from "./target";

    export class Child extends CardDef {
      @field name = contains(StringField);
      @field childMatches = linksToMany(() => Target, {
        query: {
          filter: { eq: { cardTitle: 'child-match' } },
          page: { size: 10, number: 0 },
        },
      });
    }
  `;

  fs['parent.gts'] = `
    import { contains, field, linksTo, linksToMany, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Child } from "./child";
    import { Target } from "./target";

    export class Parent extends CardDef {
      @field name = contains(StringField);
      @field child = linksTo(() => Child);
      @field parentMatches = linksToMany(() => Target, {
        query: {
          filter: { eq: { cardTitle: 'parent-match' } },
          page: { size: 10, number: 0 },
        },
      });
    }
  `;

  // The two result sets are disjoint, so which of them a document carries says
  // which card's query ran.
  for (let i = 0; i < 2; i++) {
    fs[`parent-target-${i}.json`] = {
      data: {
        attributes: { name: `PT${i}`, cardTitle: 'parent-match' },
        meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
      },
    } as LooseSingleCardDocument;
    fs[`child-target-${i}.json`] = {
      data: {
        attributes: { name: `CT${i}`, cardTitle: 'child-match' },
        meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
      },
    } as LooseSingleCardDocument;
  }

  fs['child-1.json'] = {
    data: {
      attributes: { name: 'C1' },
      meta: { adoptsFrom: { module: rri('./child'), name: 'Child' } },
    },
  } as LooseSingleCardDocument;

  fs['parent-1.json'] = {
    data: {
      attributes: { name: 'P1' },
      relationships: { child: { links: { self: './child-1' } } },
      meta: { adoptsFrom: { module: rri('./parent'), name: 'Parent' } },
    },
  } as LooseSingleCardDocument;

  return fs;
}

type Relationships = Record<
  string,
  {
    links?: { self?: string | null; search?: string | null };
    data?: { id: string } | Array<{ id: string }> | null;
  }
>;

function relationshipsOf(
  resource: { relationships?: unknown } | undefined,
): Relationships {
  return (resource?.relationships ?? {}) as Relationships;
}

// A query-backed field stores no target, so serving one costs a search rather
// than a read. `loadLinks` resolves those fields for the roots it was handed
// and not for the closure it side-loads, where the same pass would run a card's
// whole field tree and a search per query field it found, for a card present
// only as context for rendering a link. It holds for every caller, including
// the ones that narrow what a resolved field expands.
module(basename(import.meta.filename), function () {
  module('query fields are resolved for the walk roots only', function (hooks) {
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

    test('expanding a card runs its own query fields and none of the side-loaded ones', async function (assert) {
      let applied = 0;
      let result = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}parent-1`),
        { loadLinks: true, onQueryFieldApplied: () => applied++ },
      );
      assert.strictEqual(result?.type, 'doc', 'doc returned');
      let doc = result?.type === 'doc' ? result.doc : undefined;

      assert.strictEqual(
        applied,
        1,
        'one query field was resolved: the one on the requested card',
      );

      let includedIds = (doc?.included ?? []).map((r) => r.id);
      assert.ok(
        includedIds.some((id) => id?.endsWith('/child-1')),
        'the statically linked child is side-loaded',
      );
      assert.strictEqual(
        includedIds.filter((id) => id?.includes('/parent-target-')).length,
        2,
        "the requested card's query matches are expanded",
      );
      assert.strictEqual(
        includedIds.filter((id) => id?.includes('/child-target-')).length,
        0,
        "the side-loaded card's query matches are not",
      );
    });

    test("a side-loaded card's query-backed field arrives unresolved rather than as an empty answer", async function (assert) {
      let result = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}parent-1`),
        { loadLinks: true },
      );
      let doc = result?.type === 'doc' ? result.doc : undefined;
      let child = (doc?.included ?? []).find((r) => r.id?.endsWith('/child-1'));
      assert.ok(child, 'the child resource is on the wire');
      let relationships = relationshipsOf(child);

      // `applyQueryResults` is the only writer of `links.search`, and the
      // consumer reads its absence as "nobody answered this field" — which is
      // what sends it to its own query. An umbrella naming an empty result set
      // would instead be an authoritative answer of none.
      assert.notOk(
        relationships.childMatches?.links?.search,
        'no links.search, so the field is not presented as resolved',
      );
      // Absence, not an empty array: an umbrella naming an empty set is an
      // authoritative answer of none, which is the state this has to avoid.
      assert.strictEqual(
        relationships.childMatches,
        undefined,
        'the field carries no relationship entry at all',
      );
      assert.deepEqual(
        Object.keys(relationships).filter((key) =>
          /^childMatches\.\d+$/.test(key),
        ),
        [],
        'no per-member sub-entries either',
      );

      // The card that was asked for is unaffected.
      let parentRelationships = relationshipsOf(doc?.data);
      assert.ok(
        parentRelationships.parentMatches?.links?.search,
        "the requested card's own query-backed field still carries its search",
      );
      assert.strictEqual(
        Array.isArray(parentRelationships.parentMatches?.data)
          ? (parentRelationships.parentMatches!.data as Array<{ id: string }>)
              .length
          : 0,
        2,
        'and still names both of its matches',
      );
    });

    test('skipQueryBackedExpansion narrows what a resolved field expands, not which cards resolve one', async function (assert) {
      let applied = 0;
      let result = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}parent-1`),
        {
          loadLinks: true,
          skipQueryBackedExpansion: true,
          onQueryFieldApplied: () => applied++,
        },
      );
      let doc = result?.type === 'doc' ? result.doc : undefined;

      assert.strictEqual(
        applied,
        1,
        'the requested card resolves its query field and the side-loaded one does not',
      );

      // What this flag governs: the requested card's field is resolved and
      // names its matches, but those matches are left out of `included[]` for
      // the caller to fetch per URL.
      let parentMatches = relationshipsOf(doc?.data).parentMatches;
      assert.ok(
        parentMatches?.links?.search,
        "the requested card's field is resolved",
      );
      assert.strictEqual(
        Array.isArray(parentMatches?.data)
          ? (parentMatches!.data as Array<{ id: string }>).length
          : 0,
        2,
        'and names both of its matches',
      );
      let includedIds = (doc?.included ?? []).map((r) => r.id);
      assert.strictEqual(
        includedIds.filter((id) => id?.includes('/parent-target-')).length,
        0,
        'while none of them are expanded into the document',
      );

      let child = (doc?.included ?? []).find((r) => r.id?.endsWith('/child-1'));
      assert.strictEqual(
        relationshipsOf(child).childMatches,
        undefined,
        "the side-loaded card's field is unresolved here too",
      );
    });

    test('search results are roots: each resolves its own query fields, their closures do not', async function (assert) {
      let applied = 0;
      let doc = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        {
          filter: {
            type: { module: rri(`${testRealm}parent`), name: 'Parent' },
          },
        },
        { loadLinks: true, onQueryFieldApplied: () => applied++ },
      );

      assert.strictEqual(doc.data.length, 1, 'one parent matched');
      assert.strictEqual(
        applied,
        1,
        "only the result card's query field was resolved",
      );
      let includedIds = doc.included.map((r) => r.id);
      assert.strictEqual(
        includedIds.filter((id) => id?.includes('/parent-target-')).length,
        2,
        "the result card's query matches are expanded",
      );
      assert.strictEqual(
        includedIds.filter((id) => id?.includes('/child-target-')).length,
        0,
        "the side-loaded child's are not",
      );
    });
  });
});
