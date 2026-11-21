// How a refusal is asserted, and the indexed fixture the [run] refusals run
// against, shared by query-refusals-test.ts and the query-refusals-*-test.ts
// files. See query-refusals-test.ts for how a row is read.

import QUnit from 'qunit';
const { test } = QUnit;
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  InvalidQueryError,
  SEARCH_TEXT_KEY,
  SearchRequestError,
  VectorSerializer,
  VirtualNetwork,
  baseCardRef,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { assertQuery } from '@cardstack/runtime-common/query-v2/query-check';
import { setVectorSearchSettings } from '@cardstack/runtime-common/vector-store';
import type { Query } from '@cardstack/runtime-common/query-v2/query';
import {
  lowerQuery,
  usesNewSyntax,
} from '@cardstack/runtime-common/query-v2/query-syntax';
import { parseSearchEntryQueryFromPayload } from '@cardstack/runtime-common/query-v2/search-entry';
import { setupDB } from './index.ts';
import { definitionsLookup } from './definition-lookup.ts';
function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

export const realm = 'http://query-refusals/';
export const T = ref(`${realm}shop`, 'Listing');
export const noteRef = ref(`${realm}shop`, 'Note');

export type Q = Record<string, any>;

// How a call ended: not refused, refused as a query (with or without a
// code), or failed some other way.
export interface Outcome {
  refused: boolean;
  kind: string;
  code: string | undefined;
  message: string;
}

function outcome(run: () => unknown): Outcome {
  try {
    run();
  } catch (e) {
    return describeError(e);
  }
  return { refused: false, kind: 'accepted', code: undefined, message: '' };
}

export function describeError(e: unknown): Outcome {
  let message = String((e as Error | undefined)?.message ?? e);
  if (e instanceof InvalidQueryError) {
    return { refused: true, kind: 'InvalidQueryError', code: e.code, message };
  }
  if (e instanceof SearchRequestError) {
    return {
      refused: true,
      kind: 'SearchRequestError',
      code: e.queryCode,
      message,
    };
  }
  return {
    refused: false,
    kind: (e as Error | undefined)?.constructor?.name ?? typeof e,
    code: undefined,
    message,
  };
}

export const viaAssert = (query: unknown) =>
  outcome(() => assertQuery(query as any));
// A request body is JSON: what cannot be written in JSON never arrives.
export const viaWire = (payload: unknown) =>
  outcome(() =>
    parseSearchEntryQueryFromPayload(JSON.parse(JSON.stringify(payload))),
  );

export function isRefusedWith(
  assert: Assert,
  got: Outcome,
  code: string,
  door: string,
) {
  assert.true(
    got.refused,
    `${door}: refused as a query (was: ${got.kind}${got.message ? `, ${got.message.slice(0, 140)}` : ''})`,
  );
  assert.strictEqual(
    got.code,
    code,
    `${door}: the code (${got.message.slice(0, 140)})`,
  );
}

// One mistake: the query, the code, and whether the wire can carry it. Rows
// are in the newer spelling (a top-level `type`), which both doors read, so
// one object goes through both unless `wire` says otherwise.
export interface Mistake {
  name: string;
  query: unknown;
  code: string;
  // false: the member does not exist on the wire (or JSON cannot hold the
  // value). Otherwise the payload, when it differs from the query.
  wire?: unknown;
}

export const f = (filter: unknown, more: Q = {}): Q => ({
  type: T,
  filter,
  ...more,
});
export const s = (sort: unknown, more: Q = {}): Q => ({
  type: T,
  sort,
  ...more,
});
export const top = (more: Q): Q => ({ type: T, ...more });
export const kind = { eq: { kind: 'lamp' } };
export const binding = { from: { type: T, filter: kind }, select: 'kind' };
export const usingA = { in: { kind: '$a' } };

// ---- out of range, over a limit, in the wrong place -----------------------

export const many = <V>(n: number, make: (i: number) => V): V[] =>
  Array.from({ length: n }, (_, i) => make(i));

// ---- an unknown member, at every level ------------------------------------

// `newer` is refused (`unknown-key`), and its message names `nearest`, the
// real member the unknown one is closest to. `older` is the same unknown
// member in a query with `on` anchors and no newer spelling, and `olderIs`
// is what the docs say of it:
//   ignored  a filter, a field sort and a page could be saved before the
//            newer spellings existed, and "a query written before the newer
//            spellings is read as it always was … a member the grammar never
//            read is still ignored";
//   refused  the top level always refused an unknown member, so reading it
//            "as it always was" refuses it; and facets, collapse, rerank,
//            let and near sorts arrived with the strict grammar, so no saved
//            query ever had a member ignored there (of a near sort the docs
//            say so outright: "and so is a member a near sort entry does not
//            have").
export interface UnknownMember {
  level: string;
  newer: Q;
  unknown: string;
  nearest: string;
  older?: Q;
  olderIs?: 'ignored' | 'refused';
  wire?: unknown;
}

export const on = T;

// ---- names chosen to break a lookup ---------------------------------------

// Names every JavaScript object answers to, which a field lookup written as
// a plain property read would find.
export const INHERITED_NAMES = [
  'constructor',
  '__proto__',
  'toString',
  'hasOwnProperty',
];
// Paths that are not field paths: an empty segment, an index, brackets, a
// quote of each kind, a statement separator, a null byte, a space, nothing.
export const MALFORMED_PATHS = [
  'a..b',
  '.a',
  'a.',
  'a[0]',
  'a[]',
  "a'b",
  'a"b',
  'a;b',
  'a\u0000b',
  'a b',
  'a-b',
  '',
  "kind'; DROP TABLE boxel_index; --",
];

// With a key that is the literal text `__proto__`, as JSON gives it.
export const keyed = (key: string, value: unknown): Q =>
  JSON.parse(`{${JSON.stringify(key)}:${JSON.stringify(value)}}`);

export function table(group: string, mistakes: Mistake[]) {
  for (let { name, query, code, wire } of mistakes) {
    test(`[validation] ${group}: ${name} is ${code}`, function (assert) {
      isRefusedWith(assert, viaAssert(query), code, 'assertQuery');
      if (wire !== false) {
        isRefusedWith(assert, viaWire(wire ?? query), code, 'the wire');
      }
    });
  }
}

export function unknownMemberTests(rows: UnknownMember[]) {
  for (let row of rows) {
    test(`[validation] an unknown member of ${row.level} ("${row.unknown}") is unknown-key, naming "${row.nearest}"`, function (assert) {
      assert.true(usesNewSyntax(row.newer), 'the query is in a newer spelling');
      for (let [door, got] of [
        ['assertQuery', viaAssert(row.newer)],
        ['the wire', viaWire(row.wire ?? row.newer)],
      ] as [string, Outcome][]) {
        isRefusedWith(assert, got, 'unknown-key', door);
        assert.true(
          got.message.includes(row.unknown),
          `${door}: the message names the unknown member (${got.message.slice(0, 160)})`,
        );
        assert.true(
          new RegExp(`\\b${row.nearest}\\b`).test(got.message),
          `${door}: the message names the nearest real member, "${row.nearest}" (${got.message.slice(0, 160)})`,
        );
      }
    });
    if (row.older) {
      let older = row.older;
      // A member main's grammar never had (`facets`, `collapse`, `let`,
      // …) makes the whole query the newer spelling (ADR 022 §1.7), so
      // its `on` anchors no longer make it older.
      let v2 = ['facets', 'collapse', 'let', 'explain', 'timeZone'].some(
        (k) => k in older,
      );
      test(`[validation] the same unknown member of ${row.level} ${v2 ? 'beside on anchors is still the newer spelling, and' : 'in the older spelling is'} ${row.olderIs}`, function (assert) {
        assert.strictEqual(
          usesNewSyntax(older),
          v2,
          v2
            ? 'a V2 member makes the query the newer spelling'
            : 'the query is in the older spelling',
        );
        let got = viaAssert(older);
        if (row.olderIs === 'ignored') {
          assert.strictEqual(
            got.kind,
            'accepted',
            `read as it always was (${got.message.slice(0, 160)})`,
          );
        } else {
          isRefusedWith(assert, got, 'unknown-key', 'assertQuery');
        }
      });
    }
  }
}

export function acceptedTests(rows: [string, Q][]) {
  for (let [name, query] of rows) {
    test(`[validation] accepted: ${name}`, function (assert) {
      let asserted = viaAssert(query);
      assert.strictEqual(asserted.kind, 'accepted', asserted.message);
      let wired = viaWire(query);
      assert.strictEqual(wired.kind, 'accepted', wired.message);
    });
  }
}

export function setupRefusalIndex(hooks: NestedHooks) {
  const stringRef = ref('@cardstack/base/string', 'default');
  const numberRef = ref('@cardstack/base/number', 'default');
  const vectorRef = ref('@cardstack/base/vector', 'default');
  // Every text and number field here is a facet: these cases test what
  // is refused when a query runs, not which fields declare one.
  const text = (search?: Q) => ({
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard: stringRef,
    search: { ...(search ?? {}), facet: true },
  });
  const listingDef = {
    type: 'card-def',
    codeRef: T,
    displayName: 'Listing',
    fields: {
      title: 'title',
      kind: 'kind',
      memo: 'memo',
      sku: 'sku',
      price: 'price',
      embedding: 'embedding',
    },
    fieldDefs: {
      title: text({ role: 'title' }),
      kind: text(),
      // plain text: not searched by pattern
      memo: text(),
      sku: text({ role: 'identifier', patterns: true }),
      price: {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: numberRef,
        serializerName: 'number',
        search: { facet: true },
      },
      // a vector with no neighbor index declared
      embedding: {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        fieldOrCard: vectorRef,
        serializerName: 'vector',
      },
    },
  } as unknown as Definition;
  // a type with no vector field at all
  const noteDef = {
    type: 'card-def',
    codeRef: noteRef,
    displayName: 'Note',
    fields: { title: 'title' },
    fieldDefs: { title: text({ role: 'title' }) },
  } as unknown as Definition;
  const cardDef = {
    type: 'card-def',
    codeRef: baseCardRef,
    displayName: 'Card',
    fields: {},
    fieldDefs: {},
  } as unknown as Definition;

  function makeDefinitionLookup(): DefinitionLookup {
    return definitionsLookup([listingDef, noteDef, cardDef]);
  }

  const vec = (components: number[]) =>
    VectorSerializer.queryableValue(VectorSerializer.encodeVector(components));

  const ROWS: Record<string, Q> = {
    one: {
      title: 'Brass lamp',
      kind: 'lamp',
      memo: 'LMP-1 on the shelf',
      sku: 'LMP-1',
      price: 60,
      embedding: vec([1, 0, 0]),
    },
    two: {
      title: 'Glass lamp',
      kind: 'lamp',
      memo: 'plain',
      sku: 'LMP-2',
      price: 40,
      embedding: vec([1, 1, 0]),
    },
    three: {
      title: 'Oak bench',
      kind: 'bench',
      memo: 'plain',
      sku: 'BNC-1',
      price: 120,
      embedding: vec([0, 1, 0]),
    },
    four: {
      title: 'Teak bench',
      kind: 'bench',
      memo: 'plain',
      sku: 'BNC-2',
      price: 150,
      embedding: vec([0, 0, 1]),
    },
  };

  let adapter: PgAdapter;
  let engine: IndexQueryEngine;
  let vn: VirtualNetwork;
  const realmURL = new URL(realm);

  setupDB(hooks, {
    before: async (dbAdapter) => {
      adapter = dbAdapter;
      vn = new VirtualNetwork();
      engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
      let batch = await new IndexWriter(dbAdapter).createBatch(
        realmURL,
        vn,
        undefined,
        { splitPrerenderHtml: false },
      );
      for (let [name, row] of Object.entries(ROWS)) {
        let cardURL = new URL(`${realm}Listing/${name}.json`);
        await batch.updateEntry(cardURL, {
          type: 'instance',
          resource: {
            id: rri(cardURL.href),
            type: 'card',
            attributes: {},
            meta: { adoptsFrom: { module: rri(T.module), name: T.name } },
          },
          lastModified: Date.now(),
          resourceCreatedAt: Date.now(),
          searchData: {
            ...row,
            [SEARCH_TEXT_KEY]: {
              A: row.title,
              patterns: row.sku,
            },
            _typeahead: row.title,
          },
          markdown: `# ${row.title}`,
          deps: new Set(),
          displayNames: ['Listing'],
          types: [internalKeyFor(T, undefined, vn)],
          isolatedHtml: `<div>${name}</div>`,
        });
      }
      await batch.done();
    },
  });

  hooks.afterEach(function () {
    setVectorSearchSettings();
  });

  async function run(
    query: Q,
    using: IndexQueryEngine = engine,
  ): Promise<Outcome & { names?: string[]; meta?: any }> {
    try {
      // the engine's own search takes the lowered form of a newer spelling
      let asked = usesNewSyntax(query) ? lowerQuery(query).query : query;
      let { cards, meta } = await using.searchCards(realmURL, asked as Query);
      return {
        refused: false,
        kind: 'ran',
        code: undefined,
        message: '',
        names: cards
          .map((c) =>
            String(c.id)
              .split('/')
              .pop()!
              .replace(/\.json$/, ''),
          )
          .sort(),
        meta,
      };
    } catch (e) {
      return describeError(e);
    }
  }

  // Every statement the index is sent while `fn` runs.
  async function statements(fn: () => Promise<unknown>): Promise<string[]> {
    let seen: string[] = [];
    let real = adapter.execute;
    (adapter as any).execute = function (sql: string, ...rest: unknown[]) {
      seen.push(sql);
      return (real as any).call(adapter, sql, ...rest);
    };
    try {
      await fn();
    } finally {
      (adapter as any).execute = real;
    }
    return seen;
  }
  return {
    get adapter() {
      return adapter;
    },
    get engine() {
      return engine;
    },
    get vn() {
      return vn;
    },
    stringRef,
    numberRef,
    vectorRef,
    text,
    listingDef,
    noteDef,
    cardDef,
    makeDefinitionLookup,
    vec,
    ROWS,
    realmURL,
    run,
    statements,
  };
}
