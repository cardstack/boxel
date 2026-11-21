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
import { syncSeededValueStore } from './helpers/seed-index-rows.ts';
import { definitionLookupOf } from './helpers/definition-lookup.ts';

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
  return definitionLookupOf((codeRef) => {
    for (let def of [policyDef, customerDef, metadataDef, contactDef]) {
      if (refsEqual(codeRef, def.codeRef)) {
        return def;
      }
    }
    throw new Error(
      `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
    );
  });
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
    `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at) VALUES (`,
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
  module('an every of eqs on one field', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        for (let policy of policies) {
          await seedPolicy(dbAdapter, vn, policy);
        }
        // Lists that hold a number, and the same spelling as a string: an
        // `eq` of "5" on a list finds both.
        for (let [name, tags] of [
          ['n5', [5, 'x']],
          ['s5', ['5', 'x']],
          ['s5only', ['5']],
        ] as const) {
          await seedPolicy(dbAdapter, vn, {
            url: `${testRealmURL}Policy/${name}`,
            searchDoc: { tags: [...tags] },
          });
        }
        await syncSeededValueStore(dbAdapter, testRealmURL);
      },
    });

    async function search(filter: Record<string, unknown>) {
      let pg: any = (await import('pg')).default;
      let original = pg.Client.prototype.query;
      let largest = 0;
      pg.Client.prototype.query = function (this: unknown, ...args: any[]) {
        let text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
        if (typeof text === 'string') largest = Math.max(largest, text.length);
        return original.apply(this, args);
      };
      try {
        let { cards } = await engine.searchCards(new URL(testRealmURL), {
          filter: { on: policyRef, ...filter },
        } as any);
        return { ids: cards.map((c: any) => c.id).sort(), largest };
      } finally {
        pg.Client.prototype.query = original;
      }
    }

    // An `every` is the cards every member admits: the intersection of what
    // each member finds alone.
    async function intersection(members: Record<string, unknown>[]) {
      let sets = [];
      for (let member of members) {
        sets.push(new Set((await search(member)).ids));
      }
      return [...sets[0]].filter((id) => sets.every((s) => s.has(id))).sort();
    }

    let cases: [string, Record<string, unknown>[]][] = [
      [
        'a list field, two values',
        [{ eq: { tags: 'vip' } }, { eq: { tags: 'new' } }],
      ],
      ['a list field, one value', [{ eq: { tags: 'vip' } }]],
      [
        'a list field, a value repeated',
        [
          { eq: { tags: 'vip' } },
          { eq: { tags: 'new' } },
          { eq: { tags: 'vip' } },
        ],
      ],
      [
        'a list field, with a null member',
        [{ eq: { tags: 'vip' } }, { eq: { tags: null } }],
      ],
      [
        'a list field, with a value no card holds',
        [{ eq: { tags: 'vip' } }, { eq: { tags: 'gold' } }],
      ],
      [
        'a singular field, two values',
        [{ eq: { policyId: 'P1' } }, { eq: { policyId: 'P2' } }],
      ],
      ['a singular field, one value', [{ eq: { policyId: 'P1' } }]],
      [
        'a singular field, a value repeated',
        [{ eq: { policyId: 'P1' } }, { eq: { policyId: 'P1' } }],
      ],
      [
        'a list field, a number spelled as a string and a plain string',
        [{ eq: { tags: '5' } }, { eq: { tags: 'x' } }],
      ],
      [
        'a list field, numeric-looking strings',
        [{ eq: { tags: '5' } }, { eq: { tags: '7' } }],
      ],
      [
        'two fields',
        [
          { eq: { policyId: 'P1' } },
          { eq: { tags: 'vip' } },
          { eq: { tags: 'new' } },
        ],
      ],
    ];
    for (let [label, members] of cases) {
      test(`${label}: the cards every member finds`, async function (assert) {
        let expected = await intersection(members);
        let { ids } = await search({ every: members });
        assert.deepEqual(ids, expected);
      });
    }

    // Two filters on the same list path under one `every` are each a test of
    // the card, so the card tagged both is found (docs/search.md, the answers
    // that changed; ADR 034). Folded (two eqs) and per member (an eq beside an
    // `in`, which does not fold) answer alike.
    test('an every of two values on one string list finds the card that holds both', async function (assert) {
      assert.deepEqual(
        (
          await search({
            every: [{ eq: { tags: 'vip' } }, { eq: { tags: 'new' } }],
          })
        ).ids,
        [`${testRealmURL}Policy/p1`],
        'folded',
      );
      assert.deepEqual(
        (
          await search({
            every: [{ eq: { tags: 'vip' } }, { in: { tags: ['new'] } }],
          })
        ).ids,
        [`${testRealmURL}Policy/p1`],
        'per member',
      );
    });

    test('the statement does not grow with the number of numeric-looking values', async function (assert) {
      let members = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ eq: { tags: `${i}` } }));
      let thousand = await search({ every: members(1000) });
      let fiveThousand = await search({ every: members(5000) });
      assert.deepEqual(fiveThousand.ids, [], 'no card holds them all');
      assert.strictEqual(fiveThousand.largest, thousand.largest);
    });

    test('the statement does not grow with the number of distinct values', async function (assert) {
      let members = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ eq: { tags: `t${i}` } }));
      let thousand = await search({ every: members(1000) });
      let fiveThousand = await search({ every: members(5000) });
      assert.deepEqual(fiveThousand.ids, [], 'no card holds them all');
      assert.strictEqual(fiveThousand.largest, thousand.largest);
    });
  });
});
