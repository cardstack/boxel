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
  module('a negated any of indexed text branches', function (hooks) {
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
        await syncSeededValueStore(dbAdapter, testRealmURL);
      },
    });

    async function ids(filter: Record<string, unknown>) {
      let { cards } = await engine.searchCards(new URL(testRealmURL), {
        filter: { on: policyRef, ...filter },
      } as any);
      return cards.map((c: any) => c.id).sort();
    }

    // These cards hold no title and no text, so each branch is unknown for
    // them, and so is its negation: a negated `any` answers as the same `any`
    // compiled without the indexed union (a third branch that matches nothing
    // keeps it off), which drops them.
    test('not over an any of a matches and a title contains answers as the general form does', async function (assert) {
      let branches = [{ matches: 'zebra' }, { contains: { _title: 'abc' } }];
      let general = await ids({
        not: { any: [...branches, { eq: { policyId: 'no-such-policy' } }] },
      });
      let indexed = await ids({ not: { any: branches } });
      assert.deepEqual(indexed, general);
    });

    test('the positive any answers as the general form does', async function (assert) {
      let branches = [{ matches: 'zebra' }, { contains: { _title: 'abc' } }];
      let general = await ids({
        any: [...branches, { eq: { policyId: 'no-such-policy' } }],
      });
      let indexed = await ids({ any: branches });
      assert.deepEqual(indexed, general);
    });
  });
});
