import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  VirtualNetwork,
  type CodeRef,
  type Definition,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';
import { definitionLookupOf } from './helpers/definition-lookup.ts';
import { seedIndexRows } from './helpers/seed-index-rows.ts';

// A search looks up the definitions its query names before it opens its read
// snapshot, so no connection waits on a module prerender. The lookups that
// succeeded answer the same lookups inside the snapshot; one that failed is
// tried again there, and the search's own lookup decides.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const testRealmURL = 'http://search-definitions-once-test/';
const stringRef = ref('@cardstack/base/string', 'default');
const noteRef = ref(`${testRealmURL}note`, 'Note');
const cardDefRef = ref('@cardstack/base/card-api', 'CardDef');

const noteDef: Definition = {
  type: 'card-def',
  codeRef: noteRef,
  displayName: 'Note',
  fields: { title: 'f0' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
  },
};
const cardDef: Definition = {
  type: 'card-def',
  codeRef: cardDefRef,
  displayName: 'Card',
  fields: {},
  fieldDefs: {},
};

function sameRef(a: CodeRef, b: ResolvedCodeRef): boolean {
  return 'module' in a && a.module === b.module && a.name === b.name;
}

module(basename(import.meta.filename), function () {
  module('a search reads each definition once (Postgres)', function (hooks) {
    let dbAdapter: PgAdapter;
    let vn: VirtualNetwork;
    let noteLookups: number;
    let failNoteLookups: number;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        vn = new VirtualNetwork();
        noteLookups = 0;
        failNoteLookups = 0;
        await seedIndexRows(
          dbAdapter,
          vn,
          testRealmURL,
          [1, 2, 3].map((n) => ({
            url: `${testRealmURL}Note/n${n}`,
            searchDoc: { title: `Note ${n}` },
            types: [noteRef],
            lastModified: 1_000 * n,
          })),
        );
      },
    });

    function engine() {
      return new IndexQueryEngine(
        dbAdapter,
        definitionLookupOf((codeRef) => {
          if (sameRef(codeRef, noteRef)) {
            noteLookups++;
            if (failNoteLookups > 0) {
              failNoteLookups--;
              throw new Error('the module is not ready yet');
            }
            return noteDef;
          }
          if (sameRef(codeRef, cardDefRef)) {
            return cardDef;
          }
          throw new Error(
            `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
          );
        }),
        vn,
      );
    }

    test('the definition a query names is looked up once for the search', async function (assert) {
      let { cards } = await engine().searchCards(new URL(testRealmURL), {
        filter: { type: noteRef },
        sort: [{ by: 'lastModified', direction: 'desc' }],
        page: { size: 10, total: 'none' },
      });
      assert.deepEqual(
        cards.map((c) => String(c.id)),
        [3, 2, 1].map((n) => `${testRealmURL}Note/n${n}`),
      );
      assert.strictEqual(
        noteLookups,
        1,
        'looked up before the snapshot, and not again inside it',
      );
    });

    test('a lookup that failed before the snapshot is tried again inside it', async function (assert) {
      failNoteLookups = 1;
      let { cards } = await engine().searchCards(new URL(testRealmURL), {
        filter: { type: noteRef },
        sort: [{ by: 'lastModified', direction: 'desc' }],
        page: { size: 10, total: 'none' },
      });
      assert.strictEqual(cards.length, 3, 'the search answers');
      assert.strictEqual(
        noteLookups,
        2,
        'the failed warm-up is not handed on: the search looked again',
      );
    });

    test('each search looks the definition up for itself', async function (assert) {
      let e = engine();
      let q = {
        filter: { type: noteRef },
        sort: [{ by: 'lastModified', direction: 'desc' as const }],
        page: { size: 10, total: 'none' as const },
      };
      await e.searchCards(new URL(testRealmURL), q);
      await e.searchCards(new URL(testRealmURL), q);
      assert.strictEqual(
        noteLookups,
        2,
        'nothing a search looked up outlives it',
      );
    });
  });
});
