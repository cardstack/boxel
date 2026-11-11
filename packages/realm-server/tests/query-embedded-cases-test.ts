import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  hasWarning,
  SupportedMimeType,
  VectorSerializer,
  normalizeQueryDefinition,
  resetSearchBoundsForTests,
  rri,
  setSearchBoundsForTests,
} from '@cardstack/runtime-common';
import type {
  FieldDefinition,
  LooseSingleCardDocument,
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  searchCardsForTest,
  setupDB,
  setupPermissionedRealmCached,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A query is also run where no one typed it: a query-backed field resolves by
// running its query for each card that declares it, and a realm policy runs a
// caller's query through its grants. This file checks both with the query
// language's newer abilities, each against an answer worked out here.
//
// The first module needs no index: it reads what a field's query becomes for
// one card. The second and third need real cards (a field resolves when its
// card is indexed and served, and a policy is a card), so they use the test
// host.

const vec = (components: number[]) => VectorSerializer.encodeVector(components);

// ---------------------------------------------------------------------------
// 1. What a field's query becomes for one card
// ---------------------------------------------------------------------------

const PLAIN_REALM = 'http://query-embedded-test/';
const Thing = { module: `${PLAIN_REALM}thing`, name: 'Thing' };

function fieldQuery(
  queryDefinition: Record<string, any>,
  attributes: Record<string, unknown>,
  type: 'linksTo' | 'linksToMany' = 'linksToMany',
) {
  // Values are read the way the indexer reads them: from the card's own
  // attributes, a path at a time; a path that is not there is undefined.
  let read = (path: string) =>
    path
      .split('.')
      .reduce<any>(
        (at, segment) => (at == null ? undefined : at[segment]),
        attributes,
      );
  return normalizeQueryDefinition({
    fieldDefinition: {
      type,
      isPrimitive: false,
      isComputed: false,
      fieldOrCard: Thing,
    } as unknown as FieldDefinition,
    queryDefinition: queryDefinition as any,
    realmURL: new URL(PLAIN_REALM),
    fieldName: 'picks',
    resolvePathValue: read,
    relativeTo: new URL(PLAIN_REALM),
  });
}

// Whether a filter still narrows the search: anything other than "every card
// of the type".
function narrows(filter: any): boolean {
  if (!filter || typeof filter !== 'object') {
    return false;
  }
  let members = Object.keys(filter).filter((k) => k !== 'on');
  return !(members.length === 0 || (members.length === 1 && 'type' in filter));
}

module(basename(import.meta.filename), function () {
  module("a query-backed field's query, for one card", function () {
    test('a field naming no page takes 500 rows and an exact total', function (assert) {
      let { query } = fieldQuery({ filter: { eq: { kind: 'lamp' } } }, {})!;
      assert.deepEqual(query.page, { size: 500, number: 0, total: 'exact' });
    });

    test('a field keeps the page size it names, and still counts exactly', function (assert) {
      let { query } = fieldQuery({ page: { size: 3 } }, {})!;
      assert.deepEqual(query.page, { size: 3, number: 0, total: 'exact' });
    });

    test('a linksTo field asks for one row', function (assert) {
      let { query } = fieldQuery({ page: { size: 30 } }, {}, 'linksTo')!;
      assert.strictEqual(query.page?.size, 1);
      assert.strictEqual(query.page?.number, 0);
    });

    for (let [what, value] of [
      ['a number', 7],
      ['zero', 0],
      ['an empty string', ''],
      ['false', false],
      ['a list', ['lamp', 'vase']],
      ['an id', `${PLAIN_REALM}Thing/1`],
    ] as [string, unknown][]) {
      test(`$this reading ${what} puts that value in the filter`, function (assert) {
        let op = Array.isArray(value) ? 'in' : 'eq';
        let { query } = fieldQuery(
          { filter: { [op]: { kind: '$this.want' } } },
          { want: value },
        )!;
        assert.deepEqual((query.filter as any)[op], { kind: value });
        assert.deepEqual(
          (query.filter as any).on,
          Thing,
          'anchored on the type',
        );
      });
    }

    for (let op of ['eq', 'in', 'contains', 'range']) {
      test(`$this reading nothing, under ${op}: the field resolves to no cards`, function (assert) {
        let filter =
          op === 'range'
            ? { range: { score: { gte: '$this.want' } } }
            : { [op]: { kind: '$this.want' } };
        assert.strictEqual(fieldQuery({ filter }, {}), null);
      });
    }

    test('$this reading nothing under `not`: the field resolves to no cards, not to every card', function (assert) {
      assert.strictEqual(
        fieldQuery({ filter: { not: { eq: { kind: '$this.want' } } } }, {}),
        null,
      );
    });

    test('$this reading nothing in one path of an eq: the field resolves to no cards, not to the other paths alone', function (assert) {
      assert.strictEqual(
        fieldQuery(
          { filter: { eq: { kind: '$this.want', color: 'red' } } },
          {},
        ),
        null,
      );
    });

    test('$this reading nothing in one entry of an in list: the field resolves to no cards, not to the other entries', function (assert) {
      assert.strictEqual(
        fieldQuery({ filter: { in: { kind: ['$this.want', 'lamp'] } } }, {}),
        null,
      );
    });

    test('$this reading a value in every path of an eq keeps every path', function (assert) {
      let { query } = fieldQuery(
        { filter: { eq: { kind: '$this.want', color: 'red' } } },
        { want: 'lamp' },
      )!;
      assert.deepEqual((query.filter as any).eq, {
        kind: 'lamp',
        color: 'red',
      });
    });

    test('$this reading an empty list under `in` asks for one of no values, which no card is', function (assert) {
      let { query } = fieldQuery(
        { filter: { in: { kind: '$this.want' } } },
        { want: [] },
      )!;
      assert.deepEqual((query.filter as any).in, { kind: [] });
    });

    test('$this reading null under eq asks for the cards with no value there', function (assert) {
      // pins current behavior; rule not yet decided: a null is kept as a
      // null, and `eq: null` finds the cards with no value (docs/search.md
      // says so for a one-card binding). It is not "every card".
      let { query } = fieldQuery(
        { filter: { eq: { kind: '$this.want' } } },
        { want: null },
      )!;
      assert.deepEqual((query.filter as any).eq, { kind: null });
    });

    for (let [what, filter] of [
      ['matches', { matches: '$this.want' }],
      [
        'type-ahead (prefix, title scope)',
        { prefix: true, scope: 'title', matches: '$this.want' },
      ],
      ['pattern', { pattern: { code: '$this.want' } }],
    ] as [string, Record<string, any>][]) {
      test(`$this reading nothing, under ${what}: the field does not turn into every card of its type`, function (assert) {
        let normalized = fieldQuery({ filter }, {});
        let everyCard = normalized ? !narrows(normalized.query.filter) : false;
        assert.false(
          everyCard,
          `the filter that remains: ${JSON.stringify(normalized?.query.filter)}`,
        );
      });
    }

    test('a near sort on a card with no vector resolves to no cards', function (assert) {
      assert.strictEqual(
        fieldQuery(
          { sort: [{ by: 'embedding', near: '$this.embedding' }] },
          {},
        ),
        null,
      );
    });

    test("a near sort reads the card's own vector", function (assert) {
      let embedding = vec([1, 0, 0]);
      let { query } = fieldQuery(
        { sort: [{ by: 'embedding', near: '$this.embedding' }] },
        { embedding },
      )!;
      assert.deepEqual((query.sort as any)[0].near, embedding);
    });

    test('$this inside a boost is read', function (assert) {
      let { query } = fieldQuery(
        {
          sort: [
            {
              blend: [
                { by: 'score' },
                { boost: { eq: { kind: '$this.want' } }, weight: 2 },
              ],
            },
          ],
        },
        { want: 'vase' },
      )!;
      assert.deepEqual((query.sort as any)[0].blend[1].boost, {
        eq: { kind: 'vase' },
      });
    });

    test("$this inside a binding's query is read", function (assert) {
      let { query } = fieldQuery(
        {
          let: {
            $mine: {
              from: { type: Thing, filter: { eq: { kind: '$this.want' } } },
              select: 'tags',
            },
          },
          filter: { in: { tags: '$mine' } },
        },
        { want: 'vase' },
      )!;
      assert.deepEqual((query as any).let.$mine.from.filter, {
        eq: { kind: 'vase' },
      });
    });

    for (let [key, sort, where] of [
      ['_blend', [{ by: '_blend', of: [{ by: 'score' }] }], 'sort[0]/by'],
      ['_expr', [{ by: '_expr', expr: 'score' }], 'sort[0]/by'],
      ['_relevance', [{ by: '_relevance' }], 'sort[0]/by'],
      [
        '_when',
        [{ blend: [{ by: '_when', when: { eq: { kind: 'x' } } }] }],
        'sort[0]/blend[0]/by',
      ],
    ] as [string, unknown[], string][]) {
      test(`a field sorting by the internal key ${key} is refused (unknown-key), naming the key and where it is`, function (assert) {
        assert.throws(
          () => fieldQuery({ sort }, {}),
          (e: any) =>
            e.code === 'unknown-key' &&
            e.message.includes(`"${key}"`) &&
            e.message.includes(where),
        );
      });
    }

    test('a field query naming rerank, in either spelling, is refused (unknown-key) with the sort entry to write', function (assert) {
      for (let queryDefinition of [
        // older spelling: no type, an anchored filter
        {
          filter: { on: Thing, eq: { kind: 'lamp' } },
          rerank: { expression: 'price' },
        },
        // newer spelling
        { type: Thing, rerank: { expression: 'price', top: 5 } },
      ]) {
        assert.throws(
          () => fieldQuery(queryDefinition, {}),
          (e: any) =>
            e.code === 'unknown-key' &&
            /rerank/.test(e.message) &&
            /sort/.test(e.message) &&
            /top/.test(e.message),
        );
      }
    });

    test('a field query with a window (an expression sort entry with top) is read', function (assert) {
      let { query } = fieldQuery(
        {
          type: Thing,
          sort: [{ expression: 'price', top: 5 }, { by: 'price' }],
        },
        {},
      )!;
      let { expression, top } = (query.sort as any)[0];
      assert.deepEqual({ expression, top }, { expression: 'price', top: 5 });
    });

    test('a field sorting by _matchRelevance, as older saved fields do, is read', function (assert) {
      let { query } = fieldQuery(
        { filter: { matches: 'lamp' }, sort: [{ by: '_matchRelevance' }] },
        {},
      )!;
      assert.strictEqual((query.sort as any)[0].by, '_matchRelevance');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Query-backed fields on real cards
  // -------------------------------------------------------------------------

  // Needs the test host: a field resolves when its card is served, from the
  // card's indexed attributes, so the cards have to be real.
  module('query-backed fields using the newer abilities', function (hooks) {
    const testRealm = new URL('http://127.0.0.1:4463/test/');
    const itemRef = { module: `${testRealm}things`, name: 'Item' };
    const specialRef = { module: `${testRealm}things`, name: 'SpecialItem' };
    const lit = (value: unknown) => JSON.stringify(value);

    interface Item {
      id: string;
      special?: true;
      kind?: string;
      tags: string[];
      score?: number;
    }
    // A member left out is a card with no value there.
    // prettier-ignore
    const ITEMS: Item[] = [
      { id: 'i1', special: true, kind: 'lamp', tags: ['red', 'blue'], score: 10 },
      { id: 'i2', special: true, kind: 'lamp', tags: ['red'], score: 40 },
      { id: 'i3', kind: 'lamp', tags: [], score: 70 },
      { id: 'i4', kind: 'kettle', tags: ['blue'], score: 20 },
      { id: 'i5', special: true, kind: 'kettle', tags: ['green'], score: 90 },
      { id: 'i6', kind: 'vase', tags: ['green', 'red'], score: 30 },
      { id: 'i7', tags: ['blue'], score: 60 },
      { id: 'i8', kind: 'vase', tags: [] },
    ];
    const SWATCHES: Record<string, number[] | undefined> = {
      s1: [1, 0, 0],
      s2: [0.8, 0.6, 0],
      s3: [0.6, 0, 0.8],
      s4: [0, 1, 0],
      s5: [-1, 0, 0],
      s6: undefined,
    };

    // One owner type per ability, so each field is resolved on its own.
    const OWNER_FIELDS: Record<string, string> = {
      OwnerType: `{ type: ${lit(specialRef)}, filter: { eq: { kind: 'lamp' } } }`,
      OwnerIn: `{ filter: { in: { kind: '$this.wants' } } }`,
      OwnerNot: `{ filter: { not: { eq: { kind: '$this.want' } } } }`,
      OwnerTag: `{ filter: { eq: { tags: '$this.want' } } }`,
      OwnerNoTag: `{ filter: { not: { eq: { tags: '$this.want' } } } }`,
      OwnerSort: `{ sort: [{ by: 'kind' }, { by: 'score', direction: 'desc' }] }`,
      OwnerBlend: `{ sort: [{ blend: [{ by: 'score' }, { boost: { eq: { kind: '$this.want' } }, weight: 5 }] }] }`,
      OwnerCollapse: `{ sort: [{ by: 'score', direction: 'desc' }], collapse: { by: 'kind' } }`,
      OwnerLet: `{ let: { $top: { from: { type: ${lit(itemRef)}, filter: { range: { score: { gte: 60 } } } }, select: 'kind' } }, filter: { in: { kind: '$top' } } }`,
      OwnerLetThis: `{ let: { $mine: { from: { type: ${lit(itemRef)}, filter: { eq: { kind: '$this.want' } } }, select: 'tags' } }, filter: { in: { tags: '$mine' } } }`,
      OwnerPage: `{ sort: [{ by: 'score' }], page: { size: 3 } }`,
      OwnerDefault: `{ sort: [{ by: 'name' }] }`,
      OwnerEq: `{ filter: { eq: { kind: '$this.want' } } }`,
      OwnerNumber: `{ filter: { range: { score: { gte: '$this.limit' } } } }`,
      OwnerMatches: `{ filter: { matches: '$this.want' } }`,
      OwnerLink: `{ filter: { eq: { id: '$this.pin.id' } } }`,
      OwnerRelevance: `{ filter: { matches: 'lamp' }, sort: [{ by: '_matchRelevance' }] }`,
      OwnerUnknown: `{ type: ${lit(itemRef)}, filter: { eq: { kind: 'lamp' } }, sortBy: [{ by: 'score' }] }`,
    };

    function fileSystem(): Record<string, string | LooseSingleCardDocument> {
      let fs: Record<string, string | LooseSingleCardDocument> = {};
      fs['things.gts'] = `
        import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";
        import NumberField from "@cardstack/base/number";

        export class Item extends CardDef {
          @field name = contains(StringField);
          @field kind = contains(StringField);
          @field tags = containsMany(StringField);
          @field score = contains(NumberField);
          @field cardTitle = contains(StringField, {
            computeVia: function (this: Item) {
              return this.name;
            },
          });
        }
        export class SpecialItem extends Item {}
      `;
      fs['owners.gts'] = `
        import { contains, containsMany, field, linksTo, linksToMany, CardDef } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";
        import NumberField from "@cardstack/base/number";
        import { Item } from "./things";

        export class Owner extends CardDef {
          @field want = contains(StringField);
          @field wants = containsMany(StringField);
          @field limit = contains(NumberField);
          @field pin = linksTo(() => Item);
        }
        ${Object.entries(OWNER_FIELDS)
          .map(
            ([name, query]) => `
        export class ${name} extends Owner {
          @field picks = linksToMany(() => Item, { query: ${query} });
        }`,
          )
          .join('\n')}
      `;
      // Kept in a module of its own, so a realm that cannot index a vector
      // field fails these cards only.
      fs['swatches.gts'] = `
        import { contains, field, linksToMany, CardDef } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";
        import VectorField from "@cardstack/base/vector";

        export class Tiny extends VectorField {
          static dimensions = 3;
        }
        export class Swatch extends CardDef {
          @field name = contains(StringField);
          @field embedding = contains(Tiny);
          @field alike = linksToMany(() => Swatch, {
            query: {
              filter: { not: { eq: { id: '$this.id' } } },
              sort: [{ by: 'embedding', near: '$this.embedding' }],
              page: { size: 2 },
            },
          });
        }
      `;
      for (let item of ITEMS) {
        let { id, special, ...attributes } = item;
        fs[`${id}.json`] = {
          data: {
            // the title says the kind, so a text search for a kind finds it
            attributes: {
              ...attributes,
              name: `${item.kind ?? 'plain'} ${id}`,
            },
            meta: {
              adoptsFrom: {
                module: rri('./things'),
                name: special ? 'SpecialItem' : 'Item',
              },
            },
          },
        } as LooseSingleCardDocument;
      }
      for (let [id, components] of Object.entries(SWATCHES)) {
        fs[`${id}.json`] = {
          data: {
            attributes: {
              name: id,
              ...(components ? { embedding: vec(components) } : {}),
            },
            meta: { adoptsFrom: { module: rri('./swatches'), name: 'Swatch' } },
          },
        } as LooseSingleCardDocument;
      }
      let owner = (
        file: string,
        name: string,
        attributes: Record<string, unknown> = {},
        relationships?: Record<string, unknown>,
      ) => {
        fs[`${file}.json`] = {
          data: {
            attributes,
            ...(relationships ? { relationships } : {}),
            meta: { adoptsFrom: { module: rri('./owners'), name } },
          },
        } as LooseSingleCardDocument;
      };
      owner('o-type', 'OwnerType');
      owner('o-in', 'OwnerIn', { wants: ['lamp', 'vase'] });
      owner('o-not', 'OwnerNot', { want: 'lamp' });
      owner('o-tag', 'OwnerTag', { want: 'red' });
      owner('o-no-tag', 'OwnerNoTag', { want: 'red' });
      owner('o-sort', 'OwnerSort');
      owner('o-blend', 'OwnerBlend', { want: 'vase' });
      owner('o-collapse', 'OwnerCollapse');
      owner('o-let', 'OwnerLet');
      owner('o-let-this', 'OwnerLetThis', { want: 'vase' });
      owner('o-page', 'OwnerPage');
      owner('o-default', 'OwnerDefault');
      owner('o-eq-null', 'OwnerEq', { want: null });
      owner('o-eq-empty', 'OwnerEq', { want: '' });
      owner('o-eq-kettle', 'OwnerEq', { want: 'kettle' });
      owner('o-number', 'OwnerNumber', { limit: 40 });
      owner('o-number-zero', 'OwnerNumber', { limit: 0 });
      owner('o-number-null', 'OwnerNumber', { limit: null });
      owner('o-matches-null', 'OwnerMatches', { want: null });
      owner('o-matches', 'OwnerMatches', { want: 'kettle' });
      owner('o-link', 'OwnerLink', {}, { pin: { links: { self: './i4' } } });
      owner('o-link-none', 'OwnerLink', {}, { pin: { links: { self: null } } });
      owner('o-relevance', 'OwnerRelevance');
      owner('o-unknown', 'OwnerUnknown');
      return fs;
    }

    let realm: Realm;
    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: testRealm,
      permissions: { '*': ['read'] },
      fileSystem: fileSystem(),
      onRealmSetup({ testRealm: r }) {
        realm = r;
      },
    });

    interface Resolved {
      ids: string[];
      total: unknown;
      errors: unknown[];
      resolved: boolean;
    }
    // A field as the server serves it on its card: the linked cards in order,
    // the count it reports and any errors.
    async function fieldOf(
      module: string,
      type: string,
      file: string,
      fieldName: string,
    ): Promise<Resolved> {
      let { data } = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        {
          filter: {
            type: { module: rri(`${testRealm}${module}`), name: type },
          },
          page: { size: 50, number: 0 },
        },
        { loadLinks: true },
      );
      let card = data.find((r) => r.id === `${testRealm}${file}`);
      if (!card) {
        throw new Error(
          `${file} is not in the index (found: ${data.map((r) => r.id).join(', ')})`,
        );
      }
      let relationship = ((card as any).relationships ?? {})[fieldName] as
        | {
            links?: { search?: string | null };
            data?: { id?: string }[];
            meta?: { total?: unknown; errors?: unknown[] };
          }
        | undefined;
      return {
        ids: (relationship?.data ?? []).map((member) =>
          String(member.id).replace(testRealm.href, ''),
        ),
        total: relationship?.meta?.total,
        errors: relationship?.meta?.errors ?? [],
        resolved: Boolean(relationship),
      };
    }
    const picks = (file: string) => fieldOf('owners', 'Owner', file, 'picks');
    const idsWhere = (keep: (item: Item) => boolean) =>
      ITEMS.filter(keep).map((item) => item.id);

    // Each field's cards equal a plain evaluation of its query over ITEMS,
    // and the count it reports is the number of matches.
    async function assertSet(assert: Assert, file: string, expected: string[]) {
      let field = await picks(file);
      assert.deepEqual(field.errors, [], 'no errors');
      assert.deepEqual([...field.ids].sort(), [...expected].sort(), 'cards');
      assert.strictEqual(field.total, expected.length, 'the count');
    }

    test('a top-level type narrows the field to that type', async function (assert) {
      await assertSet(
        assert,
        'o-type',
        idsWhere((i) => Boolean(i.special) && i.kind === 'lamp'),
      );
    });

    test('in, reading a list from the card', async function (assert) {
      await assertSet(
        assert,
        'o-in',
        idsWhere((i) => i.kind === 'lamp' || i.kind === 'vase'),
      );
    });

    test('not: the cards with another value, and not the ones with none', async function (assert) {
      await assertSet(
        assert,
        'o-not',
        idsWhere((i) => i.kind !== undefined && i.kind !== 'lamp'),
      );
    });

    test('eq on a list field: the cards with some element equal', async function (assert) {
      await assertSet(
        assert,
        'o-tag',
        idsWhere((i) => i.tags.includes('red')),
      );
    });

    test('not eq on a list field: the cards with no such element, empty lists included', async function (assert) {
      await assertSet(
        assert,
        'o-no-tag',
        idsWhere((i) => !i.tags.includes('red')),
      );
    });

    test('a two-key sort orders the linked cards, cards with no value last', async function (assert) {
      let missingLast = (
        a: string | number | undefined,
        b: string | number | undefined,
        order: number,
      ) =>
        a === undefined || b === undefined
          ? Number(a === undefined) - Number(b === undefined)
          : a < b
            ? -order
            : a > b
              ? order
              : 0;
      let expected = [...ITEMS]
        .sort(
          (a, b) =>
            missingLast(a.kind, b.kind, 1) ||
            missingLast(a.score, b.score, -1) ||
            (a.id < b.id ? -1 : 1),
        )
        .map((i) => i.id);
      let field = await picks('o-sort');
      assert.deepEqual(field.ids, expected);
      assert.strictEqual(field.total, ITEMS.length);
    });

    test('a blend with a boost orders the linked cards by reciprocal rank fusion', async function (assert) {
      // docs/search.md: each card scores sum(weight / (k + rank)), k = 60.
      // The score signal ranks highest first; a card with no score gets
      // nothing from it. Every card the boost admits ties for first in it.
      let scored = ITEMS.filter((i) => i.score !== undefined).sort(
        (a, b) => b.score! - a.score!,
      );
      let fused = (item: Item) =>
        (scored.includes(item) ? 1 / (60 + scored.indexOf(item) + 1) : 0) +
        (item.kind === 'vase' ? 5 / (60 + 1) : 0);
      let expected = [...ITEMS]
        .sort((a, b) => fused(b) - fused(a))
        .map((i) => i.id);
      let field = await picks('o-blend');
      assert.deepEqual(field.errors, []);
      assert.deepEqual(field.ids, expected);
      assert.strictEqual(field.total, ITEMS.length);
    });

    test('collapse keeps the best card of each group, and the count is what remains', async function (assert) {
      // Best by score of each kind; the card with no kind is a group of its
      // own. The card with no score is never the best of its kind.
      let best = new Map<string, Item>();
      for (let item of ITEMS) {
        let key = item.kind ?? `none:${item.id}`;
        let held = best.get(key);
        if (!held || (item.score ?? -Infinity) > (held.score ?? -Infinity)) {
          best.set(key, item);
        }
      }
      let expected = [...best.values()]
        .sort((a, b) => b.score! - a.score!)
        .map((i) => i.id);
      let field = await picks('o-collapse');
      assert.deepEqual(field.errors, []);
      assert.deepEqual(field.ids, expected);
      assert.strictEqual(field.total, expected.length);
    });

    test('let: a list computed first is read by the filter', async function (assert) {
      let kinds = new Set(
        ITEMS.filter((i) => (i.score ?? -1) >= 60 && i.kind).map((i) => i.kind),
      );
      await assertSet(
        assert,
        'o-let',
        idsWhere((i) => kinds.has(i.kind)),
      );
    });

    test("let: a binding's query reads the card's own value", async function (assert) {
      // The tags of the cards of the owner's kind (vase), then every card
      // holding one of them.
      let tags = new Set(
        ITEMS.filter((i) => i.kind === 'vase').flatMap((i) => i.tags),
      );
      await assertSet(
        assert,
        'o-let-this',
        idsWhere((i) => i.tags.some((t) => tags.has(t))),
      );
    });

    test('a page size smaller than the matches: that many cards, and the count of all', async function (assert) {
      let expected = ITEMS.filter((i) => i.score !== undefined)
        .sort((a, b) => a.score! - b.score!)
        .slice(0, 3)
        .map((i) => i.id);
      let field = await picks('o-page');
      assert.deepEqual(field.ids, expected);
      assert.strictEqual(field.total, ITEMS.length, 'every match is counted');
    });

    test('a field naming no page links every match', async function (assert) {
      let field = await picks('o-default');
      assert.deepEqual(
        field.ids,
        // by name: "<kind or plain> <id>"
        [...ITEMS]
          .sort((a, b) =>
            `${a.kind ?? 'plain'} ${a.id}` < `${b.kind ?? 'plain'} ${b.id}`
              ? -1
              : 1,
          )
          .map((i) => i.id),
      );
      assert.strictEqual(field.total, ITEMS.length);
    });

    test('$this reading a string', async function (assert) {
      await assertSet(
        assert,
        'o-eq-kettle',
        idsWhere((i) => i.kind === 'kettle'),
      );
    });

    test('$this reading null under eq: the cards with no value, never every card', async function (assert) {
      // pins current behavior; rule not yet decided (see the first module).
      let field = await picks('o-eq-null');
      assert.true(field.ids.length < ITEMS.length, 'not every card');
      assert.deepEqual(
        field.ids,
        idsWhere((i) => i.kind === undefined),
      );
    });

    test('$this reading an empty string under eq: no card has that value', async function (assert) {
      let field = await picks('o-eq-empty');
      assert.deepEqual(field.ids, []);
    });

    test('$this reading a number', async function (assert) {
      await assertSet(
        assert,
        'o-number',
        idsWhere((i) => (i.score ?? -1) >= 40),
      );
    });

    test('$this reading zero is a value, not nothing', async function (assert) {
      await assertSet(
        assert,
        'o-number-zero',
        idsWhere((i) => i.score !== undefined),
      );
    });

    test('$this reading null as a range bound matches nothing', async function (assert) {
      let field = await picks('o-number-null');
      assert.deepEqual(field.ids, []);
    });

    test('$this reading text for matches', async function (assert) {
      let field = await picks('o-matches');
      assert.deepEqual(
        [...field.ids].sort(),
        idsWhere((i) => i.kind === 'kettle'),
      );
    });

    test('$this reading null for matches links no card, never every card', async function (assert) {
      let field = await picks('o-matches-null');
      assert.deepEqual(field.ids, []);
    });

    test("$this reading a link's id finds the linked card", async function (assert) {
      let field = await picks('o-link');
      assert.deepEqual(field.ids, ['i4']);
    });

    test('$this reading the id of an empty link links no card', async function (assert) {
      let field = await picks('o-link-none');
      assert.deepEqual(field.ids, []);
    });

    test('a field sorting by _matchRelevance still resolves', async function (assert) {
      let field = await picks('o-relevance');
      assert.deepEqual(field.errors, []);
      assert.deepEqual(
        [...field.ids].sort(),
        idsWhere((i) => i.kind === 'lamp'),
      );
    });

    test('a field whose query has a member the grammar lacks is refused, not read without it', async function (assert) {
      // docs/search.md: in the newer spelling (a top-level type), an unknown
      // member is refused rather than ignored.
      let field = await picks('o-unknown');
      assert.deepEqual(field.ids, [], 'no cards from a refused query');
      assert.notStrictEqual(field.errors.length, 0, 'and the field says why');
    });

    test("near: a field ranks by the card's own vector", async function (assert) {
      // s1 is [1, 0, 0]; by cosine similarity the others are s2 0.8, s3 0.6,
      // s4 0, s5 -1, and s6 has no vector.
      let field = await fieldOf('swatches', 'Swatch', 's1', 'alike');
      assert.deepEqual(field.errors, []);
      assert.deepEqual(field.ids, ['s2', 's3']);
      assert.strictEqual(field.total, 5, 'every other swatch is a match');
    });

    test('near: a card with no vector links no cards', async function (assert) {
      let field = await fieldOf('swatches', 'Swatch', 's6', 'alike');
      assert.deepEqual(field.ids, []);
    });
  });

  // -------------------------------------------------------------------------
  // 3. A policy-scoped search
  // -------------------------------------------------------------------------

  // Needs the test host: a policy is a card, and its grants are compiled from
  // it. Two realms hold the same cards a member may read; LIBRARY also holds
  // cards the member's grants hide. Whatever the member asks LIBRARY must be
  // answered as TWIN answers it.
  module('a policy-scoped search with the newer abilities', function (hooks) {
    const LIBRARY = 'http://127.0.0.1:4444/library/';
    const TWIN = 'http://127.0.0.1:4444/twin/';
    const ORG = 'http://127.0.0.1:4444/org/';
    const OWNER = '@owner:localhost';
    const MEMBER = '@member:localhost';
    const REALM_POLICY = {
      module: rri('@cardstack/catalog/realm-policy/realm-policy'),
      name: 'RealmPolicy',
    };

    const LIBRARY_MODULE = `
      import { contains, containsMany, field, linksTo, linksToMany, CardDef } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import NumberField from "@cardstack/base/number";
      export class Shelf extends CardDef {
        @field name = contains(StringField);
        @field audience = contains(StringField);
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Shelf) {
            return this.name;
          },
        });
      }
      export class Doc extends CardDef {
        @field title = contains(StringField, { search: { role: 'title' } });
        @field body = contains(StringField, { search: { typos: true } });
        @field audience = contains(StringField);
        @field kind = contains(StringField, { search: { facet: true } });
        @field score = contains(NumberField, { search: { facet: true } });
        @field tags = containsMany(StringField, { search: { facet: true } });
        @field shelf = linksTo(() => Shelf, {
          searchable: true,
          search: { facet: true },
        });
        @field related = linksToMany(() => Doc, { searchable: true });
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Doc) {
            return this.title;
          },
        });
      }
    `;
    // In a module of its own, so a realm that cannot index a vector field
    // fails the near cases only.
    const SHAPES_MODULE = `
      import { contains, field, CardDef } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import NumberField from "@cardstack/base/number";
      import VectorField from "@cardstack/base/vector";
      export class Tiny extends VectorField {
        static dimensions = 3;
      }
      export class Shape extends CardDef {
        @field name = contains(StringField);
        @field audience = contains(StringField);
        @field size = contains(NumberField);
        @field embedding = contains(Tiny);
      }
    `;

    function card(
      module: string,
      name: string,
      attributes: Record<string, unknown>,
      relationships: Record<string, unknown> = {},
    ) {
      return JSON.stringify({
        data: {
          type: 'card',
          attributes,
          relationships,
          meta: { adoptsFrom: { module: `../${module}`, name } },
        },
      });
    }
    const link = (path: string) => ({ links: { self: path } });

    // The cards a member reads, in both realms.
    function visible(): Record<string, string> {
      return {
        'library.gts': LIBRARY_MODULE,
        'shapes.gts': SHAPES_MODULE,
        'shelves/front.json': card('library', 'Shelf', {
          name: 'Front',
          audience: 'open',
        }),
        // a shelf the member may not read, which a visible doc sits on
        'shelves/vault.json': card('library', 'Shelf', {
          name: 'Vault',
          audience: 'closed',
        }),
        'docs/a.json': card(
          'library',
          'Doc',
          {
            title: 'Amber lantern',
            body: 'a brass lantern for the hall',
            audience: 'open',
            kind: 'lamp',
            score: 10,
            tags: ['red', 'blue'],
          },
          { shelf: link('../shelves/front'), 'related.0': link('./b') },
        ),
        'docs/b.json': card(
          'library',
          'Doc',
          {
            title: 'Brass lantern',
            body: 'a lantern with a brass shade',
            audience: 'open',
            kind: 'lamp',
            score: 20,
            tags: ['red'],
          },
          { shelf: link('../shelves/front') },
        ),
        'docs/c.json': card(
          'library',
          'Doc',
          {
            title: 'Copper kettle',
            body: 'a kettle for the stove',
            audience: 'open',
            kind: 'kettle',
            tags: [],
          },
          { shelf: link('../shelves/vault') },
        ),
        'shapes/sa.json': card('shapes', 'Shape', {
          name: 'sa',
          audience: 'open',
          size: 1,
          embedding: vec([0.8, 0.6, 0]),
        }),
        'shapes/sb.json': card('shapes', 'Shape', {
          name: 'sb',
          audience: 'open',
          size: 2,
          embedding: vec([0, 1, 0]),
        }),
        'shapes/sc.json': card('shapes', 'Shape', {
          name: 'sc',
          audience: 'open',
          size: 3,
          embedding: vec([0.6, 0, 0.8]),
        }),
      };
    }
    // The cards the grants hide. Each would move a count, a rank, a label or
    // a score it reached: the highest scores, the nearest vector, the words
    // only they hold, a link to a visible card.
    function hidden(): Record<string, string> {
      return {
        'docs/x.json': card(
          'library',
          'Doc',
          {
            title: 'Amber lantern pizzazz',
            body: 'lantern lantern lantern brass zanzibar lantirn',
            audience: 'closed',
            kind: 'lamp',
            score: 9731,
            tags: ['red', 'hush'],
          },
          { shelf: link('../shelves/vault'), 'related.0': link('./a') },
        ),
        'docs/y.json': card('library', 'Doc', {
          title: 'Zanzibar jazz kettle',
          body: 'zanzibar kettle',
          audience: 'closed',
          kind: 'sealed',
          score: 8642,
          tags: ['hush'],
        }),
        'shapes/sx.json': card('shapes', 'Shape', {
          name: 'sx',
          audience: 'closed',
          size: 9731,
          embedding: vec([1, 0, 0]),
        }),
        'shapes/sy.json': card('shapes', 'Shape', {
          name: 'sy',
          audience: 'closed',
          size: 8642,
          embedding: vec([0.9, 0.1, 0]),
        }),
      };
    }
    // What only a hidden card holds. None of it may appear in anything the
    // member is sent. (The vault shelf is not here: a visible doc sits on it,
    // so its id is the member's to see, in both realms.)
    const HIDDEN_MARKS = [
      'pizzazz',
      'zanzibar',
      'jazz',
      'lantirn',
      'hush',
      'sealed',
      '9731',
      '8642',
      'docs/x',
      'docs/y',
      'shapes/sx',
      'shapes/sy',
    ];

    function policyCard(realmURL: string) {
      let open = [{ operation: 'query', where: '.audience == "open"' }];
      return JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            rules: ['library/Doc', 'library/Shelf', 'shapes/Shape'].map(
              (target) => ({
                targetType: {
                  module: `${realmURL}${target.split('/')[0]}`,
                  name: target.split('/')[1],
                },
                grants: open,
              }),
            ),
          },
          meta: { adoptsFrom: REALM_POLICY },
        },
      });
    }

    let realms: Record<string, Realm> = {};
    let request: SuperTest<Test>;
    let server: Server;

    setupCatalogTestSubset(hooks);

    async function start({
      dbAdapter,
      publisher,
      runner,
    }: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
    }) {
      let permissions = {
        [OWNER]: ['read', 'write', 'realm-owner'],
      } satisfies RealmPermissions as RealmPermissions;
      let result = await runTestRealmServerWithRealms({
        virtualNetwork: createVirtualNetwork(),
        realmsRootPath: join(dirSync().name, 'realm_server_1'),
        realms: [
          {
            realmURL: new URL(LIBRARY),
            fileSystem: {
              'realm.json': realmConfigCardJSON({
                name: 'Library',
                policy: `${ORG}policies/library`,
              }),
              ...visible(),
              ...hidden(),
            },
            permissions,
          },
          {
            realmURL: new URL(TWIN),
            fileSystem: {
              'realm.json': realmConfigCardJSON({
                name: 'Twin',
                policy: `${ORG}policies/twin`,
              }),
              ...visible(),
            },
            permissions,
          },
          {
            realmURL: new URL(ORG),
            fileSystem: {
              'realm.json': realmConfigCardJSON({ name: 'Org' }),
              'policies/library.json': policyCard(LIBRARY),
              'policies/twin.json': policyCard(TWIN),
            },
            permissions,
          },
        ],
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      });
      server = result.testRealmHttpServer;
      request = supertest(server);
      for (let url of [LIBRARY, TWIN, ORG]) {
        realms[url] = result.realms.find((candidate) => candidate.url === url)!;
      }
    }

    async function stop() {
      for (let realm of Object.values(realms)) {
        realm.__testOnlyClearCaches();
        realm.unsubscribe();
      }
      await closeServer(server);
      resetCatalogRealms();
    }

    let templateDatabase = setupTestDatabaseTemplate(hooks, {
      key: import.meta.filename,
      build: async (args) => {
        await start(args);
        return stop;
      },
    });

    setupDB(hooks, {
      templateDatabase,
      beforeEach: async (dbAdapter, publisher, runner) => {
        await start({ dbAdapter, publisher, runner });
      },
      afterEach: async () => {
        await stop();
      },
    });
    hooks.afterEach(function () {
      resetSearchBoundsForTests();
    });

    type Body = Record<string, unknown>;
    type Ask = (realmURL: string) => Body;
    const doc = (realmURL: string) => ({
      module: `${realmURL}library`,
      name: 'Doc',
    });
    const shape = (realmURL: string) => ({
      module: `${realmURL}shapes`,
      name: 'Shape',
    });
    // A query about docs, or about shapes, written once for either realm.
    const docs =
      (rest: Body): Ask =>
      (realmURL) => ({
        type: doc(realmURL),
        fields: { entry: ['item.title'] },
        ...rest,
      });
    const shapes =
      (rest: Body): Ask =>
      (realmURL) => ({
        type: shape(realmURL),
        fields: { entry: ['item.name'] },
        ...rest,
      });

    // The same query with its type written as an anchor on each clause
    // (`item.on`) instead of once at the top, the spelling queries saved
    // before the top-level type use. Under a policy only this spelling
    // reaches the grants (see the test below), so every other test here
    // sends it.
    const FIELD_OPS = ['eq', 'in', 'range', 'contains', 'near', 'pattern'];
    const item = (path: string) =>
      path.startsWith('item.') ? path : `item.${path}`;
    function anchorFilter(node: any, on: unknown): any {
      if (!node || typeof node !== 'object') return node;
      let out: any = { ...node };
      for (let op of FIELD_OPS) {
        if (out[op] && typeof out[op] === 'object') {
          out[op] = Object.fromEntries(
            Object.entries(out[op]).map(([k, v]) => [item(k), v]),
          );
          out['item.on'] = on;
        }
      }
      for (let op of ['every', 'any']) {
        if (Array.isArray(out[op])) {
          out[op] = out[op].map((n: any) => anchorFilter(n, on));
        }
      }
      if (out.not) {
        out.not = anchorFilter(out.not, on);
        out['item.on'] = on;
      }
      return out;
    }
    function anchorSort(entry: any, on: unknown): any {
      // a blend takes no anchor of its own; its signals do
      let out: any = Array.isArray(entry.blend)
        ? { ...entry }
        : { ...entry, 'item.on': on };
      if (typeof out.by === 'string') out.by = item(out.by);
      if (Array.isArray(out.blend)) {
        out.blend = out.blend.map((e: any) =>
          e.boost
            ? { ...e, boost: anchorFilter(e.boost, on) }
            : anchorSort(e, on),
        );
      }
      return out;
    }
    function anchored(body: Body): Body {
      let { type: on, ...rest } = body as any;
      if (!on) return body;
      let out: any = { ...rest };
      out.filter = rest.filter
        ? { every: [{ 'item.on': on }, anchorFilter(rest.filter, on)] }
        : { 'item.on': on };
      if (rest.sort) out.sort = rest.sort.map((e: any) => anchorSort(e, on));
      if (rest.facets) {
        out.facets = rest.facets.map((f: any) => ({ ...f, by: item(f.by) }));
      }
      if (rest.collapse) {
        out.collapse = { ...rest.collapse, by: item(rest.collapse.by) };
      }
      if (rest.let) {
        out.let = Object.fromEntries(
          Object.entries(rest.let).map(([name, b]: [string, any]) => [
            name,
            {
              ...b,
              from: anchored(b.from),
              ...(b.select ? { select: item(b.select) } : {}),
            },
          ]),
        );
      }
      return out;
    }

    interface Answer {
      status: number;
      // the body as sent, with the realm's own URL taken out
      text: string;
      // what a caller reads from it
      read: unknown;
    }
    async function ask(
      realmURL: string,
      caller: string,
      written: Body,
      { asWritten = false }: { asWritten?: boolean } = {},
    ): Promise<Answer> {
      let body = asWritten ? written : anchored(written);
      let response = await request
        .post(`${new URL(realmURL).pathname}_search`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set(
          'Authorization',
          `Bearer ${createJWT(realms[realmURL], caller, caller === OWNER ? ['read', 'write', 'realm-owner'] : [])}`,
        )
        .buffer(true)
        .parse((res, cb) => {
          let text = '';
          res.on('data', (c: Buffer) => (text += c.toString()));
          res.on('end', () => cb(null, text));
        })
        .send(body);
      let text = (response.body as string).split(realmURL).join('REALM/');
      let parsed = JSON.parse(text);
      let read: unknown;
      if (response.status !== 200) {
        read = {
          status: response.status,
          errors: (parsed.errors ?? []).map((e: any) => ({
            code: e.code,
            title: e.title,
            message: e.message,
          })),
        };
      } else if (parsed.columns) {
        read = {
          columns: parsed.columns,
          rows: parsed.rows,
          page: parsed.meta?.page,
        };
      } else {
        let { page, facets, facetStats, lets, warnings, near, rerank } =
          parsed.meta ?? {};
        read = {
          rows: (parsed.data ?? []).map((entry: any) => [
            entry.id,
            Object.fromEntries(
              Object.entries(entry.meta ?? {}).filter(([k]) =>
                k.startsWith('_'),
              ),
            ),
          ]),
          page,
          facets,
          facetStats,
          lets,
          warnings,
          near,
          rerank,
        };
      }
      return { status: response.status, text, read };
    }
    const ids = (answer: Answer) =>
      ((answer.read as any).rows as [string, unknown][]).map(([id]) => id);

    // The rule of this module: the member's answer from the realm with hidden
    // cards is the member's answer from the realm without them, and holds
    // nothing only a hidden card holds.
    async function assertScoped(
      assert: Assert,
      query: Ask,
      opts: { asked?: string[]; ownerSeesMore?: boolean } = {},
    ) {
      let scoped = await ask(LIBRARY, MEMBER, query(LIBRARY));
      let twin = await ask(TWIN, MEMBER, query(TWIN));
      assert.deepEqual(
        scoped.read,
        twin.read,
        'the answer a realm holding only the visible cards gives',
      );
      let lower = scoped.text.toLowerCase();
      let leaked = HIDDEN_MARKS.filter(
        (mark) => !(opts.asked ?? []).includes(mark) && lower.includes(mark),
      );
      assert.deepEqual(leaked, [], 'nothing of a hidden card is in the body');
      if (opts.ownerSeesMore !== false) {
        // The hidden cards do bear on this query: the owner, who reads them,
        // is answered differently.
        let owner = await ask(LIBRARY, OWNER, query(LIBRARY));
        assert.notDeepEqual(
          owner.read,
          scoped.read,
          'the owner, who reads the hidden cards, gets another answer',
        );
      }
      return scoped;
    }

    test('a query naming its type once, at the top, answers a member what the same query with anchors does', async function (assert) {
      // docs/search.md: the top-level type is the same query as an `on` in
      // every clause. The member reads a, b and c.
      for (let realmURL of [LIBRARY, TWIN]) {
        let query = docs({ sort: [{ by: 'title' }] })(realmURL);
        let typed = await ask(realmURL, MEMBER, query, { asWritten: true });
        let anchoredAnswer = await ask(realmURL, MEMBER, query);
        assert.deepEqual(
          ids(anchoredAnswer),
          ['REALM/docs/a', 'REALM/docs/b', 'REALM/docs/c'],
          `${realmURL}: anchored`,
        );
        assert.deepEqual(
          ids(typed),
          ids(anchoredAnswer),
          `${realmURL}: the top-level type`,
        );
      }
    });

    for (let total of ['capped', 'exact', 'none']) {
      test(`total: '${total}' and hasMore count only what the member may read`, async function (assert) {
        let scoped = await assertScoped(
          assert,
          docs({ sort: [{ by: 'title' }], page: { size: 2, total } }),
        );
        assert.deepEqual(ids(scoped), ['REALM/docs/a', 'REALM/docs/b']);
        let page = (scoped.read as any).page;
        assert.true(page.hasMore, 'c follows');
        if (total !== 'none') {
          assert.strictEqual(page.total, 3, 'a, b and c');
        }
      });
    }

    test('the last page of what the member may read has no next page', async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({ sort: [{ by: 'title' }], page: { size: 2, number: 1 } }),
      );
      assert.deepEqual(ids(scoped), ['REALM/docs/c']);
      assert.false((scoped.read as any).page.hasMore);
      assert.strictEqual((scoped.read as any).page.total, 3);
    });

    test('plain facets count only what the member may read', async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({ facets: [{ by: 'kind' }, { by: 'tags' }] }),
      );
      let counts = (by: string) =>
        Object.fromEntries(
          (scoped.read as any).facets[by].map((f: any) => [f.value, f.count]),
        );
      assert.deepEqual(counts('kind'), { lamp: 2, kettle: 1 });
      assert.deepEqual(counts('tags'), { red: 2, blue: 1 });
    });

    test("a facet with own: 'ignore' drops the member's selection, not the grants", async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({
          filter: { eq: { kind: 'kettle' } },
          facets: [{ by: 'kind', own: 'ignore' }],
        }),
      );
      assert.deepEqual(
        Object.fromEntries(
          (scoped.read as any).facets.kind.map((f: any) => [f.value, f.count]),
        ),
        { lamp: 2, kettle: 1 },
      );
    });

    test('range buckets count only what the member may read', async function (assert) {
      await assertScoped(
        assert,
        docs({
          facets: [{ by: 'score', ranges: [{ to: 100 }, { from: 100 }] }],
        }),
      );
    });

    test('facet statistics describe only what the member may read', async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({ facets: [{ by: 'score', stats: true }] }),
      );
      let stats = (scoped.read as any).facetStats.score;
      // a 10 and b 20; c has no score
      assert.strictEqual(Number(stats.max), 20);
      assert.strictEqual(Number(stats.sum), 30);
    });

    test("a facet's missing count covers only what the member may read", async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({
          filter: { eq: { kind: 'kettle' } },
          facets: [{ by: 'score', missing: true, own: 'ignore' }],
        }),
        { ownerSeesMore: false },
      );
      assert.strictEqual(
        Number((scoped.read as any).facetStats.score.missing),
        1,
        'c, the one kettle the member reads, has no score',
      );
    });

    test('a link facet never labels a value with a card the member may not read', async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({ facets: [{ by: 'shelf' }] }),
      );
      assert.deepEqual(
        Object.fromEntries(
          (scoped.read as any).facets.shelf.map((f: any) => [
            f.value,
            [f.count, f.label ?? null],
          ]),
        ),
        {
          'REALM/shelves/front': [2, 'Front'],
          // c sits on the vault shelf: counted, never named
          'REALM/shelves/vault': [1, null],
        },
      );
    });

    test('collapse groups, and their sizes, hold only what the member may read', async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({
          sort: [{ by: 'score', direction: 'desc' }],
          collapse: { by: 'kind' },
        }),
      );
      // The best lamp the member reads is b; the group is a and b.
      assert.deepEqual((scoped.read as any).rows, [
        ['REALM/docs/b', { _collapseSize: 2 }],
        ['REALM/docs/c', { _collapseSize: 1 }],
      ]);
      assert.strictEqual((scoped.read as any).page.total, 2);
    });

    test('select returns only rows and values the member may read', async function (assert) {
      let scoped = await assertScoped(assert, (realmURL) => ({
        type: doc(realmURL),
        sort: [{ by: 'title' }],
        select: ['title', 'score', { shelf: 'shelf.name' }],
      }));
      assert.deepEqual((scoped.read as any).rows, [
        ['REALM/docs/a', 'Amber lantern', 10, 'Front'],
        ['REALM/docs/b', 'Brass lantern', 20, 'Front'],
        ['REALM/docs/c', 'Copper kettle', null, null],
      ]);
    });

    test('a list binding never reads a hidden card into the filter', async function (assert) {
      // The kinds of the docs scoring 100 or more: only hidden docs do, so
      // for the member the list is empty and nothing matches.
      let scoped = await assertScoped(assert, (realmURL) => ({
        ...docs({})(realmURL),
        let: {
          $top: {
            from: {
              type: doc(realmURL),
              filter: { range: { score: { gte: 100 } } },
            },
            select: 'kind',
          },
        },
        filter: { in: { kind: '$top' } },
      }));
      assert.deepEqual(ids(scoped), []);
    });

    test('a one-card binding is never a hidden card', async function (assert) {
      // The docs scoring less than the highest-scoring doc. For the member
      // the highest is b (20), so a (10).
      let scoped = await assertScoped(assert, (realmURL) => ({
        ...docs({})(realmURL),
        let: {
          $best: {
            from: {
              type: doc(realmURL),
              sort: [{ by: 'score', direction: 'desc' }],
            },
            one: true,
          },
        },
        filter: { range: { score: { lt: '$best.score' } } },
      }));
      assert.deepEqual(ids(scoped), ['REALM/docs/a']);
    });

    test('linkedFrom a hidden card finds nothing', async function (assert) {
      // The hidden x links to a.
      let scoped = await assertScoped(
        assert,
        (realmURL) =>
          docs({
            filter: {
              linkedFrom: { card: `${realmURL}docs/x.json`, field: 'related' },
            },
          })(realmURL),
        { asked: ['docs/x'] },
      );
      assert.deepEqual(ids(scoped), []);
    });

    test('asking for a hidden card by its id finds nothing', async function (assert) {
      let scoped = await assertScoped(
        assert,
        (realmURL) =>
          docs({ filter: { eq: { id: `${realmURL}docs/x` } } })(realmURL),
        { asked: ['docs/x'] },
      );
      assert.deepEqual(ids(scoped), []);
    });

    test('a near sort ranks only what the member may read', async function (assert) {
      // By similarity to [1, 0, 0]: sa 0.8, sc 0.6, sb 0. The hidden sx and
      // sy are nearer than any of them.
      let scoped = await assertScoped(
        assert,
        shapes({ sort: [{ by: 'embedding', near: [1, 0, 0] }] }),
      );
      assert.deepEqual(ids(scoped), [
        'REALM/shapes/sa',
        'REALM/shapes/sc',
        'REALM/shapes/sb',
      ]);
    });

    test('a near filter keeps only what the member may read', async function (assert) {
      let scoped = await assertScoped(
        assert,
        shapes({
          filter: {
            near: { embedding: { to: [1, 0, 0], minSimilarity: 0.5 } },
          },
          sort: [{ by: 'name' }],
        }),
      );
      assert.deepEqual(ids(scoped), ['REALM/shapes/sa', 'REALM/shapes/sc']);
    });

    test('a blend with a near signal: hidden cards take no rank', async function (assert) {
      // Reciprocal rank fusion, k = 60, over the three shapes the member
      // reads. Nearness to [1, 0, 0] ranks sa, sc, sb; size ranks sc, sb, sa.
      let fused = (near: number, size: number) =>
        1 / (60 + near) + 1 / (60 + size);
      let expected: [string, number][] = [
        ['REALM/shapes/sc', fused(2, 1)],
        ['REALM/shapes/sa', fused(1, 3)],
        ['REALM/shapes/sb', fused(3, 2)],
      ];
      let scoped = await assertScoped(
        assert,
        shapes({
          sort: [
            {
              blend: [{ by: 'embedding', near: [1, 0, 0] }, { by: 'size' }],
            },
          ],
        }),
      );
      assert.deepEqual(
        ids(scoped),
        expected.map(([id]) => id),
      );
      ((scoped.read as any).rows as [string, any][]).forEach(([id, m], i) => {
        assert.true(
          Math.abs(m._blendScore - expected[i][1]) < 1e-9,
          `${id} scores ${expected[i][1]} (got ${m._blendScore})`,
        );
      });
    });

    test('a blend with a boost: hidden cards take no rank', async function (assert) {
      // Score ranks b then a (c has none); the boost lifts both lamps.
      let expected: [string, number][] = [
        ['REALM/docs/b', 1 / 61 + 2 / 61],
        ['REALM/docs/a', 1 / 62 + 2 / 61],
        ['REALM/docs/c', 0],
      ];
      let scoped = await assertScoped(
        assert,
        docs({
          sort: [
            {
              blend: [
                { by: 'score' },
                { boost: { eq: { kind: 'lamp' } }, weight: 2 },
              ],
            },
          ],
        }),
      );
      assert.deepEqual(
        ids(scoped),
        expected.map(([id]) => id),
      );
      ((scoped.read as any).rows as [string, any][]).forEach(([id, m], i) => {
        assert.true(
          Math.abs((m._blendScore ?? 0) - expected[i][1]) < 1e-9,
          `${id} scores ${expected[i][1]} (got ${m._blendScore})`,
        );
      });
    });

    test('text relevance scores do not move with hidden cards', async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({
          filter: { matches: 'lantern' },
          sort: [{ by: 'textRelevance' }],
        }),
      );
      assert.deepEqual(ids(scoped).sort(), ['REALM/docs/a', 'REALM/docs/b']);
    });

    test('a relevance sort does not move with hidden cards', async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({
          filter: { matches: 'brass lantern' },
          sort: [{ relevance: true }],
        }),
      );
      assert.deepEqual(ids(scoped).sort(), ['REALM/docs/a', 'REALM/docs/b']);
    });

    test('a typo is never corrected to a word only hidden cards hold', async function (assert) {
      // "lantirm" is one letter from "lantirn", a word of the hidden x, and
      // two from "lantern".
      await assertScoped(
        assert,
        docs({ filter: { matches: 'lantirm', typos: true } }),
        { ownerSeesMore: false },
      );
    });

    test('explain reports ranks counted only over what the member may read', async function (assert) {
      await assertScoped(
        assert,
        docs({
          explain: true,
          sort: [
            {
              blend: [
                { by: 'score' },
                { boost: { eq: { kind: 'lamp' } }, weight: 2 },
              ],
            },
          ],
        }),
      );
    });

    test('type-ahead suggests only titles the member may read', async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({ filter: { prefix: true, scope: 'title', matches: 'amb' } }),
      );
      assert.deepEqual(ids(scoped), ['REALM/docs/a']);
    });

    test('type-ahead for a word only hidden titles hold suggests nothing', async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({ filter: { prefix: true, scope: 'title', matches: 'zanz' } }),
      );
      assert.deepEqual(ids(scoped), []);
    });

    test('a prefix search finds only what the member may read', async function (assert) {
      let scoped = await assertScoped(
        assert,
        docs({ filter: { matches: 'zanzib', prefix: true } }),
      );
      assert.deepEqual(ids(scoped), []);
    });

    test('a refusal names nothing of a hidden card', async function (assert) {
      for (let [what, rest] of [
        ['an unknown field', { filter: { eq: { scroe: 9731 } } }],
        ['an unknown member', { fliter: { eq: { kind: 'sealed' } } }],
        // `shelf` is searchable, so its own fields are carried; a related
        // doc's shelf is only its id.
        ['a column the index lacks', { select: ['related.shelf.audience'] }],
      ] as [string, Body][]) {
        let query: Ask = (realmURL) => ({ type: doc(realmURL), ...rest });
        let scoped = await ask(LIBRARY, MEMBER, query(LIBRARY));
        let twin = await ask(TWIN, MEMBER, query(TWIN));
        assert.strictEqual(scoped.status, 400, `${what}: refused`);
        assert.deepEqual(scoped.read, twin.read, `${what}: the same refusal`);
        let lower = scoped.text.toLowerCase();
        assert.deepEqual(
          HIDDEN_MARKS.filter(
            (mark) =>
              !JSON.stringify(rest).toLowerCase().includes(mark) &&
              lower.includes(mark),
          ),
          [],
          `${what}: nothing of a hidden card in the message`,
        );
      }
    });

    test('a word only hidden cards hold is never reported as a broad term', async function (assert) {
      // With a candidate cap of 1, a term two cards hold is broad. Both
      // cards holding "zanzibar" are hidden, so the member's answer must be
      // the empty, exact one a realm without them gives.
      setSearchBoundsForTests({ matchCandidateCap: 1 });
      let scoped = await assertScoped(
        assert,
        docs({ filter: { matches: 'zanzibar' } }),
        { asked: ['zanzibar'] },
      );
      assert.deepEqual(ids(scoped), []);
      assert.notOk(
        hasWarning(scoped.read as any, 'total-estimated'),
        'an empty answer is not flagged as cut',
      );
    });

    test('a title substring only hidden cards hold is never reported as broad', async function (assert) {
      // Both hidden titles hold "zz".
      setSearchBoundsForTests({ matchCandidateCap: 1 });
      let scoped = await assertScoped(
        assert,
        docs({ filter: { contains: { _title: 'zz' } } }),
      );
      assert.deepEqual(ids(scoped), []);
      assert.notOk(
        hasWarning(scoped.read as any, 'total-estimated'),
        'an empty answer is not flagged as cut',
      );
    });

    test('hidden cards holding a title substring do not use up the cap of what the member may read', async function (assert) {
      // "mb" is in "Amber lantern" (a) and in the hidden "Amber lantern
      // pizzazz" (x). One card the member reads holds it, which is within a
      // cap of 1.
      setSearchBoundsForTests({ matchCandidateCap: 1 });
      let scoped = await assertScoped(
        assert,
        docs({ filter: { contains: { _title: 'mb' } } }),
      );
      assert.deepEqual(ids(scoped), ['REALM/docs/a']);
    });
  });
});
