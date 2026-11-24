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
import type { Query } from '@cardstack/runtime-common/query';
import { assertQuery } from '@cardstack/runtime-common/query-v2/query-check';

import { setupDB } from './helpers/index.ts';
import { definitionLookupOf } from './helpers/definition-lookup.ts';
import { seedIndexRows } from './helpers/seed-index-rows.ts';

// The two pages the engine answers without a size to read up to: `size: 0`
// (count only) and no page at all. The realm applies its default page before
// the engine sees a query, so the engine itself returns every match for a
// query naming no page; its count and its caps come from the query-v2 bounds.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const testRealmURL = 'http://page-defaults-test/';
const stringRef = ref('@cardstack/base/string', 'default');
const noteRef = ref(`${testRealmURL}note`, 'Note');

const noteDef: Definition = {
  type: 'card-def',
  codeRef: noteRef,
  displayName: 'Note',
  fields: { title: 'f0', tags: 'f1' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
    f1: {
      type: 'containsMany',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
  },
};

const cardDefRef = ref('@cardstack/base/card-api', 'CardDef');
const cardDef: Definition = {
  type: 'card-def',
  codeRef: cardDefRef,
  displayName: 'Card',
  fields: {},
  fieldDefs: {},
};

function refsEqual(a: CodeRef, b: CodeRef): boolean {
  return (
    'module' in a && 'module' in b && a.module === b.module && a.name === b.name
  );
}

function makeDefinitionLookup(): DefinitionLookup {
  return definitionLookupOf((codeRef) => {
    if (refsEqual(codeRef, noteRef)) {
      return noteDef;
    }
    if (refsEqual(codeRef, cardDefRef)) {
      return cardDef;
    }
    throw new Error(
      `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
    );
  });
}

// Five notes, n1 oldest to n5 newest.
const notes = [1, 2, 3, 4, 5].map((n) => ({
  url: `${testRealmURL}Note/n${n}`,
  lastModified: 1_000 * n,
  searchDoc: { title: `Note ${n}`, tags: n % 2 ? ['odd'] : ['even'] },
}));

async function seedNote(
  dbAdapter: PgAdapter,
  vn: VirtualNetwork,
  note: (typeof notes)[number],
) {
  await seedIndexRows(dbAdapter, vn, testRealmURL, [
    {
      url: note.url,
      searchDoc: note.searchDoc,
      types: [noteRef],
      lastModified: note.lastModified,
    },
  ]);
}

module(basename(import.meta.filename), function () {
  module(
    'the page an engine search reads (Postgres integration)',
    function (hooks) {
      let engine: IndexQueryEngine;

      setupDB(hooks, {
        beforeEach: async (dbAdapter) => {
          let vn = new VirtualNetwork();
          engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
          for (let note of notes) {
            await seedNote(dbAdapter, vn, note);
          }
        },
      });

      async function search(q: Query) {
        assertQuery(q);
        return await engine.searchCards(new URL(testRealmURL), q);
      }

      test('size 0 reads no cards and counts every match', async function (assert) {
        let { cards, meta } = await search({
          filter: { type: noteRef },
          page: { size: 0 },
        });
        assert.deepEqual(cards, [], 'no cards');
        assert.strictEqual(meta.page.total, 5, 'every match is counted');
      });

      test('a query naming no page gets every match, counted', async function (assert) {
        let { cards, meta } = await search({
          filter: { type: noteRef },
          sort: [{ by: 'lastModified', direction: 'desc' }],
        });
        assert.deepEqual(
          cards.map((c) => String(c.id)),
          [5, 4, 3, 2, 1].map((n) => `${testRealmURL}Note/n${n}`),
          'every note, newest first',
        );
        assert.strictEqual(meta.page.total, 5, 'every match is counted');
        assert.strictEqual(
          meta.page.hasMore,
          undefined,
          'with no page there is no next page to report',
        );
      });
    },
  );
});
