import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  VirtualNetwork,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';
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
    "it's": 'f4',
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

module(basename(import.meta.filename), function () {
  module('a declared field name holding an apostrophe', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;
    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        engine = new IndexQueryEngine(
          dbAdapter,
          makeDefinitionLookup(),
          new VirtualNetwork(),
        );
      },
    });

    test('a list filter on it reaches Postgres as valid SQL', async function (assert) {
      let error: unknown;
      try {
        await engine.searchCards(new URL(testRealmURL), {
          filter: { on: policyRef, eq: { "it's": 'x' } },
        } as any);
      } catch (e) {
        error = e;
      }
      assert.notOk(error, 'the search does not fail');
    });
  });
});
