import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { rri } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

const testRealm = new URL('http://127.0.0.1:4463/test/');

const HOLDER_COUNT = 50;

// `Holder` carries two query-backed fields over two different target types.
// `sameName` interpolates the row's own `name`, so its query differs from row
// to row; `everyNote` is the same query on every row. Before a query field
// searches the local realm it asks whether its query targets file meta rather
// than cards — two realm-wide existence checks per type the filter names. The
// answer depends on the types alone, never on the row, so a search should ask
// it once per distinct question and not once per field per result.
function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['target.gts'] = `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Target extends CardDef {
      @field cardTitle = contains(StringField);
    }
  `;

  fs['note.gts'] = `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Note extends CardDef {
      @field body = contains(StringField);
    }
  `;

  fs['holder.gts'] = `
    import { contains, field, linksToMany, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Target } from "./target";
    import { Note } from "./note";

    export class Holder extends CardDef {
      @field name = contains(StringField);
      @field sameName = linksToMany(() => Target, {
        query: {
          filter: { eq: { cardTitle: '$this.name' } },
          page: { size: 10, number: 0 },
        },
      });
      @field everyNote = linksToMany(() => Note, {
        query: {
          page: { size: 10, number: 0 },
        },
      });
    }
  `;

  fs['note-1.json'] = {
    data: {
      attributes: { body: 'only note' },
      meta: { adoptsFrom: { module: rri('./note'), name: 'Note' } },
    },
  } as LooseSingleCardDocument;

  for (let i = 0; i < HOLDER_COUNT; i++) {
    fs[`target-${i}.json`] = {
      data: {
        attributes: { cardTitle: `H${i}` },
        meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
      },
    } as LooseSingleCardDocument;
    fs[`holder-${i}.json`] = {
      data: {
        attributes: { name: `H${i}` },
        meta: { adoptsFrom: { module: rri('./holder'), name: 'Holder' } },
      },
    } as LooseSingleCardDocument;
  }

  return fs;
}

type Relationships = Record<
  string,
  { links?: { search?: string | null }; data?: { id?: string }[] }
>;

// The existence check `hasFileType` / `hasInstanceType` issue: a bare
// `SELECT 1 ... LIMIT 1` over the realm's index rows. No other statement on
// the search path has that shape.
function isTypeExistenceCheck(sql: string) {
  return /^\s*SELECT 1\s+FROM\s+\S+\s+AS i\s+WHERE[\s\S]*LIMIT 1\s*$/.test(sql);
}

module(basename(import.meta.filename), function () {
  module(
    'a query field asks whether it targets file meta once per search',
    function (hooks) {
      let realm: Realm;
      let dbAdapter: PgAdapter;

      setupPermissionedRealmCached(hooks, {
        mode: 'before',
        realmURL: testRealm,
        permissions: { '*': ['read'] },
        fileSystem: buildFileSystem(),
        onRealmSetup({ testRealm: r, dbAdapter: d }) {
          realm = r;
          dbAdapter = d;
        },
      });

      async function searchHolders(pageSize: number) {
        let typeChecks = 0;
        let originalExecute = dbAdapter.execute;
        dbAdapter.execute = ((
          sql: string,
          opts?: Parameters<typeof originalExecute>[1],
        ) => {
          if (isTypeExistenceCheck(sql)) {
            typeChecks++;
          }
          return originalExecute.call(dbAdapter, sql, opts);
        }) as typeof dbAdapter.execute;
        try {
          let { data } = await searchCardsForTest(
            realm.realmIndexQueryEngine,
            {
              filter: {
                type: { module: rri(`${testRealm}holder`), name: 'Holder' },
              },
              page: { size: pageSize, number: 0 },
            },
            { loadLinks: true },
          );
          return { data, typeChecks };
        } finally {
          dbAdapter.execute = originalExecute;
        }
      }

      test('the type check does not grow with the number of results', async function (assert) {
        let one = await searchHolders(1);
        let many = await searchHolders(HOLDER_COUNT);

        assert.strictEqual(one.data.length, 1, 'the one-row page has one row');
        assert.strictEqual(
          many.data.length,
          HOLDER_COUNT,
          'the full page has every row',
        );
        // The control: a search that never asked would also "not grow".
        assert.ok(
          one.typeChecks > 0,
          `a one-row search asks the type question (${one.typeChecks})`,
        );
        assert.strictEqual(
          many.typeChecks,
          one.typeChecks,
          `${HOLDER_COUNT} rows with two query fields ask it as often as 1 row (${many.typeChecks} vs ${one.typeChecks})`,
        );
      });

      // Sharing the answer across rows is only sound if each row still runs
      // its own query: `sameName` resolves against the row's own name.
      test('every row still resolves both fields against itself', async function (assert) {
        let { data } = await searchHolders(HOLDER_COUNT);
        for (let resource of data) {
          let index = resource.id?.match(/\/holder-(\d+)$/)?.[1];
          assert.ok(index, `${resource.id} is a Holder row`);
          let relationships = (resource.relationships ?? {}) as Relationships;
          assert.deepEqual(
            (relationships.sameName?.data ?? []).map((m) => m.id),
            [`${testRealm}target-${index}`],
            `${resource.id} matched the target named by its own name`,
          );
          assert.deepEqual(
            (relationships.everyNote?.data ?? []).map((m) => m.id),
            [`${testRealm}note-1`],
            `${resource.id} matched the note`,
          );
        }
      });
    },
  );
});
