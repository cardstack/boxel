import QUnit from 'qunit';
const { module, test } = QUnit;
import { appendFileSync } from 'fs';
import { basename } from 'path';

import type { IndexQueryEngine, Realm } from '@cardstack/runtime-common';
import {
  LegacyIndexQueryEngine,
  VirtualNetwork,
  rri,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  readVectors,
  VECTOR_FILES,
  type Vectors,
} from '@cardstack/query-verification/conformance';
import {
  definitionLookupFor,
  seededEngine,
} from '@cardstack/query-verification/engine-fixture';

import {
  setupDB,
  setupPermissionedRealmCached,
  testRealmURLFor,
} from './helpers/index.ts';
import {
  compareEngines,
  countLine,
  type Tally,
} from './helpers/engine-differential.ts';

// Main's engine (LegacyIndexQueryEngine) against the Query V2 engine
// (IndexQueryEngine), on the same database: the conformance cards seeded once,
// every case in the older spelling (the one main reads) run through both, as
// written and under `not`. Each case is
// - identical: both engines return the same cards, in the same order;
// - intentional: they differ, the case has one of the shapes whose answer
//   changed on purpose (docs/search.md, "answers that changed"), main returns
//   that shape's old answer and the new engine the model's;
// - skipped: the case has no older spelling, or main refuses it (the reason
//   is kept);
// - a failure: anything else.
// It runs at every switch row, and prints one count line
// (`DIFFERENTIAL_REPORT`, else the console) for the row's description.

// Cards main's own indexer writes, for the second data set below, and the
// queries compared over them.
const MAIN_WRITTEN = [
  {
    id: 'red',
    attributes: {
      tags: ['red', 'blue'],
      nums: [5, 15],
      day: '2000-01-01',
      at: '2000-01-01T00:00:00.000Z',
    },
  },
  {
    id: 'green',
    attributes: {
      tags: ['green'],
      nums: [7],
      day: '2001-02-03',
      at: '2001-02-03T04:05:06.000Z',
    },
  },
  { id: 'empty', attributes: { tags: [], nums: [] } },
];

const MAIN_WRITTEN_CASES: [string, Record<string, unknown>][] = [
  ['in on a string list', { on: '$Thing', in: { tags: ['red'] } }],
  ['in on a number list', { on: '$Thing', in: { nums: [5] } }],
  ['in with null on a list', { on: '$Thing', in: { tags: [null] } }],
  ['contains on a string list', { on: '$Thing', contains: { tags: 're' } }],
  ['eq on a string list', { on: '$Thing', eq: { tags: 'red' } }],
  ['eq null on a list', { on: '$Thing', eq: { tags: null } }],
  ['not over a list', { on: '$Thing', not: { eq: { tags: 'red' } } }],
  ['range on a number list', { on: '$Thing', range: { nums: { gt: 10 } } }],
  ['eq on a date', { on: '$Thing', eq: { day: '2000-01-01' } }],
  [
    'eq on a date with a date-time',
    { on: '$Thing', eq: { day: '2000-01-01T00:00:00Z' } },
  ],
  ['range on a date', { on: '$Thing', range: { day: { gte: '2000-06-01' } } }],
  ['eq on a date-time', { on: '$Thing', eq: { at: '2000-01-01T00:00:00Z' } }],
  [
    'range on a date-time',
    { on: '$Thing', range: { at: { gte: '2000-06-01T00:00:00Z' } } },
  ],
];

module(basename(import.meta.filename), function () {
  let total: Tally = {
    compared: 0,
    identical: 0,
    intentional: {},
    skipped: {},
    mainErrors: {},
    relativeDates: 0,
    failures: [],
  };

  for (let file of VECTOR_FILES) {
    module(`main's engine and Query V2's: ${file}`, function (hooks) {
      let vectors: Vectors;
      let next: IndexQueryEngine;
      let legacy: LegacyIndexQueryEngine;

      setupDB(hooks, {
        before: async (dbAdapter) => {
          vectors = await readVectors(file);
          next = await seededEngine(dbAdapter, vectors);
          legacy = new LegacyIndexQueryEngine(
            dbAdapter,
            definitionLookupFor(vectors),
            new VirtualNetwork(),
          );
        },
      });

      test('they agree, but where an answer changed on purpose', async function (assert) {
        await compareEngines(file, vectors, legacy, next, total);
        assert.ok(true, 'compared');
      });
    });
  }

  // The same comparison over search docs main's own indexer wrote (an empty
  // list as null, a date-time in the server's local time), not the model's
  // seed: a realm indexes these cards, and their docs are compared under the
  // same type, through both engines.
  module(
    "main's engine and Query V2's: rows main's indexer wrote",
    function (hooks) {
      let testRealm: Realm;
      let dbAdapter: PgAdapter;
      setupPermissionedRealmCached(hooks, {
        realmURL: testRealmURLFor('differential/'),
        permissions: { '*': ['read'] },
        fileSystem: {
          'thing.gts': `
          import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";
          import NumberField from "@cardstack/base/number";
          import DateField from "@cardstack/base/date";
          import DateTimeField from "@cardstack/base/datetime";
          export class Thing extends CardDef {
            @field tags = containsMany(StringField);
            @field nums = containsMany(NumberField);
            @field day = contains(DateField);
            @field at = contains(DateTimeField);
          }
        `,
          ...Object.fromEntries(
            MAIN_WRITTEN.map(({ id, attributes }) => [
              `${id}.json`,
              {
                data: {
                  attributes,
                  meta: {
                    adoptsFrom: { module: rri('./thing'), name: 'Thing' },
                  },
                },
              },
            ]),
          ),
        },
        onRealmSetup(args: { testRealm: Realm; dbAdapter: PgAdapter }) {
          testRealm = args.testRealm;
          dbAdapter = args.dbAdapter;
        },
      });

      test('they agree, but where an answer changed on purpose', async function (assert) {
        let realmHref = new URL(testRealm.url).href;
        let rows = (await dbAdapter.execute(
          `SELECT url, search_doc FROM boxel_index
         WHERE realm_url = $1 AND type = 'instance' ORDER BY url`,
          { bind: [realmHref] },
        )) as { url: string; search_doc: Record<string, unknown> }[];
        assert.strictEqual(
          rows.length,
          MAIN_WRITTEN.length,
          'main indexed them',
        );
        let vectors: Vectors = {
          types: { Thing: [] },
          fields: {
            tags: { type: 'containsMany', of: 'string' },
            nums: { type: 'containsMany', of: 'number' },
            day: { type: 'contains', of: 'date' },
            at: { type: 'contains', of: 'datetime' },
          },
          defs: {},
          cards: rows.map((row) => ({
            id: row.url.slice(realmHref.length).replace(/\.json$/, ''),
            type: 'Thing',
            doc: Object.fromEntries(
              ['tags', 'nums', 'day', 'at']
                .filter((k) => k in row.search_doc)
                .map((k) => [k, row.search_doc[k]]),
            ),
          })),
          cases: MAIN_WRITTEN_CASES.map(([name, older]) => ({
            name,
            newer: older,
            lowered: older,
            older,
            expect: 'answered',
          })),
        };
        let next = await seededEngine(dbAdapter, vectors);
        let legacy = new LegacyIndexQueryEngine(
          dbAdapter,
          definitionLookupFor(vectors),
          new VirtualNetwork(),
        );
        await compareEngines('main-written', vectors, legacy, next, total);
      });
    },
  );

  module('the count', function () {
    test('every difference is an intentional change', function (assert) {
      let line = countLine(total);
      if (process.env.DIFFERENTIAL_REPORT) {
        appendFileSync(
          process.env.DIFFERENTIAL_REPORT,
          `${line}\n${total.failures.join('\n')}\n`,
        );
      } else {
        console.log(line);
      }
      assert.deepEqual(total.failures, [], line);
    });
  });
});
