import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  internalKeyFor,
  param,
  query,
  VirtualNetwork,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';

// Build a resolved code ref; the cast brands the module URL as the
// RealmResourceIdentifier the CodeRef types expect.
function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

// Exercises the singular-path scalar `eq` -> `search_doc @>` containment
// rewrite against real Postgres. The engine emits a `@>` predicate (GIN
// servable) only for a positive-polarity, singular, string-valued leaf;
// numeric/boolean leaves, plural paths, and negated contexts keep the `->>`
// extraction form. We assert both the result set AND which SQL form was
// emitted (by capturing the executed SQL) so a correct result can't mask the
// rewrite silently not firing.

const testRealmURL = 'http://eq-containment-test/';

const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const booleanRef = ref('@cardstack/base/boolean', 'default');
const policyRef = ref(`${testRealmURL}policy`, 'Policy');
const customerRef = ref(`${testRealmURL}customer`, 'Customer');
const metadataRef = ref(`${testRealmURL}policy`, 'Metadata');
const contactRef = ref(`${testRealmURL}policy`, 'Contact');

// Customer (linked card): a string `id` leaf + a string `name`.
const customerDef: Definition = {
  type: 'card-def',
  codeRef: customerRef,
  displayName: 'Customer',
  fields: { id: 'f0', name: 'f1' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
    f1: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
  },
};

// Metadata (contains-composite field): a string `region` leaf.
const metadataDef: Definition = {
  type: 'field-def',
  codeRef: metadataRef,
  displayName: 'Metadata',
  fields: { region: 'f0' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
  },
};

// Contact (composite field reached through a PLURAL `contacts` field): a
// string `email` leaf. `contacts.email` crosses an array at an interior
// segment, so it must NOT use `@>`.
const contactDef: Definition = {
  type: 'field-def',
  codeRef: contactRef,
  displayName: 'Contact',
  fields: { email: 'f0' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
  },
};

const policyDef: Definition = {
  type: 'card-def',
  codeRef: policyRef,
  displayName: 'Policy',
  fields: {
    policyId: 'f0',
    count: 'f1',
    active: 'f2',
    customer: 'f3',
    tags: 'f4',
    metadata: 'f5',
    contacts: 'f6',
  },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
    f1: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: numberRef,
      serializerName: 'number',
    },
    f2: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: booleanRef,
      serializerName: 'boolean',
    },
    f3: {
      type: 'linksTo',
      isPrimitive: false,
      isComputed: false,
      fieldOrCard: customerRef,
    },
    f4: {
      type: 'containsMany',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
    f5: {
      type: 'contains',
      isPrimitive: false,
      isComputed: false,
      fieldOrCard: metadataRef,
    },
    f6: {
      type: 'containsMany',
      isPrimitive: false,
      isComputed: false,
      fieldOrCard: contactRef,
    },
  },
};

function refsEqual(a: CodeRef, b: CodeRef): boolean {
  return (
    'module' in a && 'module' in b && a.module === b.module && a.name === b.name
  );
}

function makeDefinitionLookup(): DefinitionLookup {
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      for (let def of [policyDef, customerDef, metadataDef, contactDef]) {
        if (refsEqual(codeRef, def.codeRef)) {
          return def;
        }
      }
      throw new Error(
        `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
      );
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    async invalidate() {
      return [];
    },
    async clearRealmDefinitions() {},
    async clearAllDefinitions() {},
    registerRealm() {},
    async getCachedDefinitions() {
      return undefined;
    },
    async populateDefinitionCacheEntry() {
      return undefined;
    },
    async getCachedDefinitionsBatch() {
      return {};
    },
    forRealm() {
      return lookup;
    },
  };
  return lookup;
}

interface SeededPolicy {
  url: string;
  searchDoc: Record<string, unknown>;
}

const c1 = `${testRealmURL}Customer/c1`;
const c2 = `${testRealmURL}Customer/c2`;

const policies: SeededPolicy[] = [
  {
    url: `${testRealmURL}Policy/p1`,
    searchDoc: {
      policyId: 'P1',
      count: 5,
      active: true,
      customer: { id: c1, name: 'Acme' },
      tags: ['vip', 'new'],
      metadata: { region: 'EU' },
      contacts: [{ email: 'p1@x.com' }, { email: 'shared@x.com' }],
    },
  },
  {
    url: `${testRealmURL}Policy/p2`,
    searchDoc: {
      policyId: 'P2',
      count: 10,
      active: false,
      customer: { id: c2, name: 'Beta' },
      tags: ['new'],
      metadata: { region: 'US' },
      contacts: [{ email: 'p2@x.com' }],
    },
  },
  {
    url: `${testRealmURL}Policy/p3`,
    searchDoc: {
      policyId: 'P3',
      count: 5,
      active: true,
      customer: { id: c1, name: 'Acme' },
      tags: ['vip'],
      metadata: { region: 'EU' },
      contacts: [{ email: 'shared@x.com' }],
    },
  },
  {
    // No policyId at all: exercises the absent-path NULL semantics that `@>`
    // cannot reproduce under negation.
    url: `${testRealmURL}Policy/p4`,
    searchDoc: {
      count: 5,
      active: true,
      customer: { id: c2, name: 'Beta' },
      tags: [],
      metadata: { region: 'US' },
      contacts: [],
    },
  },
];

async function seedPolicy(
  dbAdapter: PgAdapter,
  vn: VirtualNetwork,
  { url, searchDoc }: SeededPolicy,
) {
  let typeKey = internalKeyFor(policyRef, undefined, vn);
  await query(dbAdapter, [
    `INSERT INTO boxel_index (url, file_alias, realm_url, realm_version, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at) VALUES (`,
    param(url),
    `,`,
    param(url),
    `,`,
    param(testRealmURL),
    `,`,
    param(1),
    `,`,
    param('instance'),
    `,`,
    param(JSON.stringify({ id: url, type: 'card' })),
    `::jsonb,`,
    param(JSON.stringify(searchDoc)),
    `::jsonb,`,
    `'[]'::jsonb,`,
    param(JSON.stringify([typeKey])),
    `::jsonb,`,
    param(false),
    `,`,
    param(false),
    `,`,
    param(Date.now()),
    `)`,
  ]);
}

module(basename(import.meta.filename), function () {
  module('eq containment (Postgres integration)', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;
    let executedSql: string[];

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        executedSql = [];
        // Capture every SQL string the engine executes so each test can assert
        // which predicate form (`@>` vs `->>`) was emitted.
        let originalExecute = dbAdapter.execute.bind(dbAdapter);
        (dbAdapter as any).execute = (sql: string, opts: any) => {
          executedSql.push(sql);
          return originalExecute(sql, opts);
        };

        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        for (let policy of policies) {
          await seedPolicy(dbAdapter, vn, policy);
        }
      },
    });

    function ids(cards: { id?: string }[]): string[] {
      return cards.map((c) => c.id!).sort();
    }

    // Only the search queries matter for asserting the predicate form; the
    // per-test seeding INSERTs are captured too, so exclude them.
    function lastFilterSql(): string {
      return executedSql.filter((sql) => !/^\s*INSERT\b/i.test(sql)).join('\n');
    }

    test('singular string eq is served by `@>` containment', async function (assert) {
      let { cards, meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { on: policyRef, eq: { policyId: 'P1' } },
      });
      assert.strictEqual(meta.page.total, 1, 'one row matches');
      assert.deepEqual(ids(cards), [`${testRealmURL}Policy/p1`]);
      assert.ok(
        lastFilterSql().includes('@>'),
        'a `@>` containment predicate was emitted',
      );
    });

    test('singular linksTo `.id` eq is served by `@>` containment', async function (assert) {
      let { cards, meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { on: policyRef, eq: { 'customer.id': c1 } },
      });
      assert.strictEqual(meta.page.total, 2, 'two policies link to c1');
      assert.deepEqual(ids(cards), [
        `${testRealmURL}Policy/p1`,
        `${testRealmURL}Policy/p3`,
      ]);
      assert.ok(
        lastFilterSql().includes('@>'),
        'the linksTo `.id` path uses `@>` from the root',
      );
    });

    test('nested contains-composite eq is served by `@>` containment', async function (assert) {
      let { cards, meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { on: policyRef, eq: { 'metadata.region': 'EU' } },
      });
      assert.strictEqual(meta.page.total, 2);
      assert.deepEqual(ids(cards), [
        `${testRealmURL}Policy/p1`,
        `${testRealmURL}Policy/p3`,
      ]);
      assert.ok(lastFilterSql().includes('@>'), 'nested object path uses `@>`');
    });

    test('numeric eq keeps the `->>` extraction form', async function (assert) {
      let { cards, meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { on: policyRef, eq: { count: 5 } },
      });
      assert.strictEqual(meta.page.total, 3, 'three rows have count=5');
      assert.deepEqual(ids(cards), [
        `${testRealmURL}Policy/p1`,
        `${testRealmURL}Policy/p3`,
        `${testRealmURL}Policy/p4`,
      ]);
      assert.notOk(
        lastFilterSql().includes('@>'),
        'numeric leaf is excluded from containment',
      );
    });

    test('boolean eq keeps the `->>` extraction form', async function (assert) {
      let { cards, meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { on: policyRef, eq: { active: true } },
      });
      assert.strictEqual(meta.page.total, 3);
      assert.notOk(
        lastFilterSql().includes('@>'),
        'boolean leaf is excluded from containment',
      );
      assert.deepEqual(ids(cards), [
        `${testRealmURL}Policy/p1`,
        `${testRealmURL}Policy/p3`,
        `${testRealmURL}Policy/p4`,
      ]);
    });

    test('plural-field eq keeps the json_tree machinery (no `@>`)', async function (assert) {
      let { cards, meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { on: policyRef, eq: { tags: 'vip' } },
      });
      assert.strictEqual(meta.page.total, 2, 'two policies are tagged vip');
      assert.deepEqual(ids(cards), [
        `${testRealmURL}Policy/p1`,
        `${testRealmURL}Policy/p3`,
      ]);
      assert.notOk(
        lastFilterSql().includes('@>'),
        'plural path stays on json_tree, never `@>`',
      );
    });

    test('nested eq through an INTERIOR plural field stays on json_tree (no `@>`)', async function (assert) {
      // `contacts` is plural, so `contacts.email` crosses an array at an
      // interior segment. `@>` with a nested object would lose the
      // per-element positional binding, so the walk must divert to json_tree.
      let { cards, meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { on: policyRef, eq: { 'contacts.email': 'shared@x.com' } },
      });
      assert.strictEqual(
        meta.page.total,
        2,
        'two policies have a shared contact',
      );
      assert.deepEqual(ids(cards), [
        `${testRealmURL}Policy/p1`,
        `${testRealmURL}Policy/p3`,
      ]);
      assert.notOk(
        lastFilterSql().includes('@>'),
        'an interior plural segment forces json_tree, never `@>`',
      );
      assert.ok(
        lastFilterSql().includes('fullkey'),
        'the json_tree `fullkey LIKE` path-anchor is used instead',
      );
    });

    test('negated eq keeps `->>` and preserves NULL-on-absent-path semantics', async function (assert) {
      let { cards, meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { not: { on: policyRef, eq: { policyId: 'P1' } } },
      });
      // p2/p3 have a different policyId (kept); p1 matches (excluded); p4 has no
      // policyId so `->>` yields NULL and `NOT NULL` drops it — `@>` would have
      // wrongly kept p4.
      assert.deepEqual(ids(cards), [
        `${testRealmURL}Policy/p2`,
        `${testRealmURL}Policy/p3`,
      ]);
      assert.strictEqual(meta.page.total, 2);
      assert.notOk(
        lastFilterSql().includes('@>'),
        'negated eq must not use `@>` (FALSE vs NULL diverges under NOT)',
      );
    });

    test('double-negated eq returns to positive polarity and uses `@>`', async function (assert) {
      let { cards, meta } = await engine.searchCards(new URL(testRealmURL), {
        filter: { not: { not: { on: policyRef, eq: { policyId: 'P1' } } } },
      });
      assert.strictEqual(meta.page.total, 1);
      assert.deepEqual(ids(cards), [`${testRealmURL}Policy/p1`]);
      assert.ok(
        lastFilterSql().includes('@>'),
        'two NOTs cancel: positive polarity uses `@>`',
      );
    });
  });
});
