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
  module('null on a list', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        for (let [name, searchDoc] of [
          [
            'some-null',
            { tags: ['a'], contacts: [{ email: null }, { email: 'a@x.com' }] },
          ],
          ['only-null', { tags: ['a'], contacts: [{ email: null }] }],
          ['empty', { tags: [], contacts: [] }],
          ['with-value', { tags: ['a'], contacts: [{ email: 'b@x.com' }] }],
        ] as const) {
          await seedPolicy(dbAdapter, vn, {
            url: `${testRealmURL}Policy/${name}`,
            searchDoc: searchDoc as Record<string, unknown>,
          });
        }
        await syncSeededValueStore(dbAdapter, testRealmURL);
      },
    });

    async function names(filter: Record<string, unknown>) {
      let { cards } = await engine.searchCards(new URL(testRealmURL), {
        filter: { on: policyRef, ...filter },
      } as any);
      return cards.map((c: any) => c.id.split('/').pop()).sort();
    }

    // A list's value is missing when it holds no value: an empty list, or one
    // whose elements are all null. `main` instead matched a list of
    // compound values when any element's field was null, and matched no
    // empty list (docs/search.md, the answers that changed).
    test('eq null on a list field finds the empty list', async function (assert) {
      assert.deepEqual(await names({ eq: { tags: null } }), ['empty']);
    });

    test('eq null through a list of compound values finds the lists with no value there', async function (assert) {
      assert.deepEqual(await names({ eq: { 'contacts.email': null } }), [
        'empty',
        'only-null',
      ]);
    });
  });
});
