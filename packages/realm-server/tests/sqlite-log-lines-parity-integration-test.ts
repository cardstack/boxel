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
  type DBAdapter,
  type Definition,
  type Expression,
} from '@cardstack/runtime-common';
import { syncLogFile } from '@cardstack/runtime-common/log-line-index';
import {
  runLogQuery,
  type LogQuery,
} from '@cardstack/runtime-common/log-query';
import type { LogAccess } from '@cardstack/runtime-common/query-engine/types';
import type { Query } from '@cardstack/runtime-common/query-v2/query';
import { NodeSQLiteAdapter } from '@cardstack/query-verification/sqlite-adapter';

import { memoryLogHost } from './helpers/case-table-log.ts';
import { definitionsLookup, ref } from './helpers/case-table-spellings.ts';
import { setupDB } from './helpers/index.ts';
import { syncSeededValueStore } from './helpers/seed-index-rows.ts';

// A log search on SQLite, the browser's index, which keeps no log tables:
// it reads the log's file and answers the query over the parsed lines
// (query-engine/sqlite-log-lines.ts). Under its window it answers as
// Postgres does, row for row, over the same files; past the window it
// answers over the newest lines and says so (docs/search.md, "On SQLite").

const realm = 'http://sqlite-log-lines-test/';
const ADA = 'Feed/ada.jsonl';
const BO = 'Feed/bo.jsonl';
const CY = 'Feed/sub/cy.jsonl';
const AUDIT = 'Feed/audit.log';
const OTHER = 'Other/dee.jsonl';
const OWN_NAMES = 'Own/names.jsonl';
const url = (file: string) => `${realm}${file}`;
const NOW = new Date('2026-11-10T12:00:00.000Z');

type Row = Record<string, any>;

const files = new Map<string, string>();
function write(file: string, lines: (Row | string)[]) {
  files.set(
    url(file),
    lines
      .map((l) => (typeof l === 'string' ? l : JSON.stringify(l)))
      .map((l) => `${l}\n`)
      .join(''),
  );
}

write(ADA, [
  {
    at: '2026-11-01 09:00:00',
    actor: '@ada:test',
    what: { action: 'seen', post: 'p1', n: 3, tags: ['art', 'birds'] },
  },
  {
    at: '2026-11-01T09:05:00Z',
    actor: '@ada:test',
    what: { action: 'like', post: 'p1', n: 10, note: 'Zoë likes it' },
  },
  {
    at: '2026-11-08 10:00:00',
    actor: '@ada:test',
    what: { action: 'seen', post: 'p2', n: '7', tags: ['cooking'] },
  },
  'this line is not JSON',
  {
    actor: '@ada:test',
    what: { action: 'like', post: 'p2', n: null, meta: { k: 1, a: [1, 2] } },
  },
  { at: '2026-11-09 11:00:00', actor: '@ada:test', what: { action: 'Like' } },
  {
    at: '2026-11-09 12:00:00',
    actor: '@bo:test',
    what: JSON.stringify({ action: 'share', post: 'p3', n: 2.5 }),
  },
  '[1, 2, 3]',
  '',
]);
write(BO, [
  {
    at: '2026-11-01 08:00:00',
    actor: '@bo:test',
    what: { action: 'like', post: 'p1', n: 1, tags: ['art'] },
  },
  {
    at: '2026-11-02 08:00:00',
    actor: '@bo:test',
    what: { action: 'like', post: 'p3', n: -4 },
  },
  {
    at: '2026-11-09 08:30:00',
    actor: '@bo:test',
    what: { action: 'seen', post: 'p3', tags: [] },
  },
]);
write(CY, [
  {
    at: '2026-11-02 12:00:00',
    actor: '@cy:test',
    what: { action: 'like', post: 'p2', n: 5 },
  },
]);
write(OTHER, [
  {
    at: '2026-11-01 07:00:00',
    actor: '@dee:test',
    what: { action: 'like', post: 'p4' },
  },
]);
files.set(
  url(AUDIT),
  [
    '2026-11-01 07:00:00 @ada:test signed in',
    '2026-11-03 07:30:00 @bo:test exported the report',
    'not a LogFile line',
  ]
    .map((l) => `${l}\n`)
    .join(''),
);

// Top-level keys that name an object's own machinery in JavaScript. JSON
// holds them as plain keys, and a row must too.
files.set(
  url(OWN_NAMES),
  [
    '{"at":"2026-11-01 08:00:00","actor":"@ada:test","__proto__":{"polluted":true},"constructor":"c1"}',
    '{"at":"2026-11-01 09:00:00","actor":"@bo:test","__proto__":{"polluted":true},"constructor":"c2"}',
  ]
    .map((l) => `${l}\n`)
    .join(''),
);

const read = async (u: string) =>
  files.has(u) ? { content: files.get(u)! } : undefined;

// --- a card type for the `let` cases ----------------------------------------

const stringRef = ref('@cardstack/base/string', 'default');
const cardDefRef = ref('@cardstack/base/card-api', 'CardDef');
const PostRef = ref(`${realm}post`, 'Post');
const POSTS = ['p1', 'p2', 'p3', 'p4', 'p5'];
const definitions = () =>
  definitionsLookup([
    {
      type: 'card-def',
      codeRef: PostRef,
      displayName: 'Post',
      fields: { uri: 'f0' },
      fieldDefs: {
        f0: {
          type: 'contains',
          isPrimitive: true,
          isComputed: false,
          fieldOrCard: stringRef,
        },
      },
    } as unknown as Definition,
    {
      type: 'card-def',
      codeRef: cardDefRef,
      displayName: 'Card',
      fields: {},
      fieldDefs: {},
    } as unknown as Definition,
  ]);

// A row of `boxel_index`, in each database's spelling of JSON.
async function seedRow(
  dbAdapter: DBAdapter,
  row: { url: string; type: 'instance' | 'file'; doc: Row; types: string[] },
) {
  let json = (value: unknown): Expression =>
    dbAdapter.kind === 'pg'
      ? [param(JSON.stringify(value)), '::jsonb']
      : [param(JSON.stringify(value))];
  await query(dbAdapter, [
    `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified) VALUES (`,
    param(row.url),
    `,`,
    param(row.url),
    `,`,
    param(realm),
    `, 1,`,
    param(row.type),
    `,`,
    ...json({ id: row.url, type: 'card' }),
    `,`,
    ...json(row.doc),
    `,`,
    ...json([]),
    `,`,
    ...json(row.types),
    `, false, false,`,
    param(Date.now()),
    `,`,
    param(1000),
    `)`,
  ] as Expression);
}

async function seedPosts(dbAdapter: DBAdapter, vn: VirtualNetwork) {
  for (let uri of POSTS) {
    await seedRow(dbAdapter, {
      url: `${realm}Post/${uri}`,
      type: 'instance',
      doc: { uri },
      types: [internalKeyFor(PostRef, undefined, vn)],
    });
  }
}

// What a log query answers, without the members only one index sends.
const comparable = (result: { data: unknown; meta: Row }) => ({
  data: result.data,
  page: result.meta.page,
  log: result.meta.log,
  logs: result.meta.logs,
  policyScopedLogs: result.meta.policyScopedLogs,
  warnings: result.meta.warnings,
});

module(basename(import.meta.filename), function () {
  module('SQLite log lines, held to Postgres', function (hooks) {
    let pg: PgAdapter;
    let sqlite: NodeSQLiteAdapter;
    let pgEngine: IndexQueryEngine;
    let sqliteEngine: IndexQueryEngine;

    setupDB(hooks, {
      before: async (dbAdapter) => {
        pg = dbAdapter;
        let host = memoryLogHost(pg, realm, files);
        for (let u of files.keys()) {
          await syncLogFile(host, u);
        }
        let vn = new VirtualNetwork();
        pgEngine = new IndexQueryEngine(pg, definitions(), vn);
        await seedPosts(pg, vn);
        await syncSeededValueStore(pg, realm);

        sqlite = new NodeSQLiteAdapter();
        let browser = sqlite as unknown as DBAdapter;
        sqliteEngine = new IndexQueryEngine(browser, definitions(), vn);
        await seedPosts(browser, vn);
        // The browser's index lists a folder's logs from its file rows.
        for (let u of files.keys()) {
          await seedRow(browser, { url: u, type: 'file', doc: {}, types: [] });
        }
      },
      after: async () => {
        await sqlite?.close();
      },
    });

    let onBoth = async (
      q: Row,
      opts: { access?: (u: string) => LogAccess } = {},
    ) => {
      let options = { readLogFile: read, now: NOW, ...opts };
      let expected = await runLogQuery(pg, realm, q as LogQuery, options);
      let actual = await runLogQuery(
        sqlite as unknown as DBAdapter,
        realm,
        q as LogQuery,
        options,
      );
      return { expected: comparable(expected), actual: comparable(actual) };
    };

    const CASES: [string, Row][] = [
      ['every line of a log, in line order', { from: { log: ADA } }],
      [
        'eq on an entry path',
        { from: { log: ADA }, filter: { eq: { 'what.action': 'like' } } },
      ],
      [
        'not eq: a line with no value matches neither',
        {
          from: { log: ADA },
          filter: { not: { eq: { 'what.post': 'p1' } } },
        },
      ],
      [
        'eq on an item of a list, and on a whole list',
        {
          from: { log: ADA },
          filter: {
            any: [
              { eq: { 'what.tags': 'birds' } },
              { eq: { 'what.tags': ['cooking'] } },
            ],
          },
        },
      ],
      [
        'eq on an object',
        {
          from: { log: ADA },
          filter: { eq: { 'what.meta': { a: [1, 2], k: 1 } } },
        },
      ],
      [
        'eq null is missing; exists is its not',
        {
          from: { log: ADA },
          filter: { every: [{ eq: { 'what.n': null } }, { exists: 'what' }] },
        },
      ],
      [
        'in, with a null among the values',
        {
          from: { log: ADA },
          filter: { in: { 'what.post': ['p2', null] } },
        },
      ],
      [
        'not in',
        {
          from: { log: ADA },
          filter: { not: { in: { 'what.post': ['p2', 'p9'] } } },
        },
      ],
      [
        'contains ignores case, and reads a time column as its ISO text',
        {
          from: { log: ADA },
          filter: {
            any: [
              { contains: { 'what.note': 'zoË' } },
              { contains: { at: '11-08T' } },
              { contains: { text: 'NOT json' } },
            ],
          },
        },
      ],
      [
        'range on a number compares numbers only',
        { from: { log: ADA }, filter: { range: { 'what.n': { gte: 3 } } } },
      ],
      [
        'range on text compares text',
        {
          from: { logs: [ADA, BO] },
          filter: { range: { 'what.post': { gt: 'p1', lte: 'p3' } } },
        },
      ],
      [
        'range on at, with a relative date',
        {
          from: { logs: [ADA, BO] },
          filter: { range: { at: { gte: 'now-3d' } } },
        },
      ],
      [
        'eq on the columns',
        {
          from: { logs: { under: 'Feed/' } },
          filter: {
            any: [
              { eq: { actor: '@bo:test' } },
              { eq: { line: 2 } },
              { eq: { at: '2026-11-02 12:00:00' } },
            ],
          },
        },
      ],
      [
        'eq on file names the log',
        {
          from: { logs: { under: 'Feed/' } },
          filter: { eq: { file: BO } },
        },
      ],
      [
        'a negated every with a missing value',
        {
          from: { log: ADA },
          filter: {
            not: {
              every: [
                { eq: { 'what.action': 'like' } },
                { range: { 'what.n': { lt: 5 } } },
              ],
            },
          },
        },
      ],
      [
        'sort by time, newest first, a tie keeps file then line',
        {
          from: { logs: [BO, ADA, CY] },
          sort: [{ by: 'at', direction: 'desc' }],
        },
      ],
      [
        'sort by time, missing first',
        { from: { log: ADA }, sort: [{ by: 'at', missing: 'first' }] },
      ],
      [
        'sort by an entry path: numbers first, then text',
        {
          from: { logs: [ADA, BO, CY] },
          sort: [{ by: 'what.n' }, { by: 'line', direction: 'desc' }],
        },
      ],
      [
        'sort by an entry path descending, missing first',
        {
          from: { logs: [ADA, BO] },
          sort: [{ by: 'what.post', direction: 'desc', missing: 'first' }],
        },
      ],
      [
        'sort by actor then file',
        {
          from: { logs: { under: 'Feed/' } },
          sort: [{ by: 'actor' }, { by: 'file', direction: 'desc' }],
        },
      ],
      [
        'a page past the first, with an exact total',
        {
          from: { logs: { under: 'Feed/' } },
          page: { size: 3, number: 1, total: 'exact' },
        },
      ],
      [
        'a capped total, and no total',
        {
          from: { logs: [ADA, BO] },
          page: { size: 2, total: 'none' },
        },
      ],
      ['a page of no rows', { from: { log: ADA }, page: { size: 0 } }],
      [
        'select reads paths and columns',
        {
          from: { logs: [ADA, BO] },
          select: ['at', 'actor', 'line', 'file', 'what.post', 'what.tags'],
        },
      ],
      [
        'a LogFile log',
        {
          from: { log: AUDIT },
          filter: { contains: { text: 'report' } },
        },
      ],
      ['a folder with no logs', { from: { logs: { under: 'Nothing/' } } }],
    ];

    for (let [rule, q] of CASES) {
      test(`as Postgres: ${rule}`, async function (assert) {
        let { expected, actual } = await onBoth(q);
        assert.deepEqual(actual, expected);
      });
    }

    test('as Postgres: a caller a policy scopes reads their own lines', async function (assert) {
      let { expected, actual } = await onBoth(
        { from: { logs: [ADA, BO] } },
        {
          access: (u) => (u === url(ADA) ? { actor: '@bo:test' } : 'all'),
        },
      );
      assert.deepEqual(actual, expected);
    });

    test('as Postgres: a log that does not exist is refused', async function (assert) {
      let refusal = async (dbAdapter: DBAdapter) => {
        try {
          await runLogQuery(
            dbAdapter,
            realm,
            { from: { log: 'Feed/none.jsonl' } },
            {
              readLogFile: read,
              now: NOW,
            },
          );
          return undefined;
        } catch (e: any) {
          return e.code;
        }
      };
      let expected = await refusal(pg);
      assert.ok(expected, 'Postgres refuses it');
      assert.strictEqual(
        await refusal(sqlite as unknown as DBAdapter),
        expected,
      );
    });

    test('as Postgres: a let binding read from a log feeds a card query', async function (assert) {
      let q = {
        filter: { on: PostRef, in: { uri: '$liked' } },
        sort: [{ by: 'uri', on: PostRef }],
        let: {
          $liked: {
            from: {
              logs: { under: 'Feed/' },
              filter: { eq: { 'what.action': 'like' } },
            },
            select: 'what.post',
          },
        },
      };
      let uris = async (engine: IndexQueryEngine) => {
        let { cards, meta } = await engine.searchCards(
          new URL(realm),
          q as unknown as Query,
          { readLogFile: read, queryNow: NOW } as any,
        );
        return {
          uris: cards.map((c) => String(c.id).split('/').pop()),
          lets: meta.lets,
          warnings: meta.warnings,
        };
      };
      let expected = await uris(pgEngine);
      assert.deepEqual(expected.uris, ['p1', 'p2', 'p3'], 'the likes');
      assert.deepEqual(await uris(sqliteEngine), expected);
    });

    test('as Postgres: a not in a let from a log keeps what the log does not name', async function (assert) {
      let q = {
        filter: { on: PostRef, not: { in: { uri: '$seen' } } },
        sort: [{ by: 'uri', on: PostRef }],
        let: {
          $seen: {
            from: { log: ADA, filter: { eq: { 'what.action': 'seen' } } },
            select: 'what.post',
          },
        },
      };
      let uris = async (engine: IndexQueryEngine) =>
        (
          await engine.searchCards(
            new URL(realm),
            q as unknown as Query,
            {
              readLogFile: read,
            } as any,
          )
        ).cards.map((c) => String(c.id).split('/').pop());
      assert.deepEqual(await uris(sqliteEngine), await uris(pgEngine));
    });

    // --- past the window -----------------------------------------------------

    let onSqlite = (q: Row, window: { lines?: number; bytes?: number }) =>
      runLogQuery(
        sqlite as unknown as DBAdapter,
        realm,
        q as LogQuery,
        {
          readLogFile: read,
          now: NOW,
          sqliteLogWindow: window,
        } as any,
      );

    test('past the window: the newest lines of one log, with a warning', async function (assert) {
      let result = await onSqlite({ from: { log: BO } }, { lines: 2 });
      assert.deepEqual(
        result.data.map((r: Row) => r.line),
        [2, 3],
        'the newest two lines',
      );
      assert.strictEqual(result.meta.page.total, 2);
      let warning = result.meta.warnings?.find(
        (w) => w.code === 'sqlite-log-window',
      );
      assert.ok(warning, 'the window is named');
      assert.ok(
        /2 of 3/.test(warning!.message),
        `lines read of the log's lines: ${warning?.message}`,
      );
    });

    test('past the window: across logs, the newest lines by time', async function (assert) {
      let result = await onSqlite(
        { from: { logs: [BO, CY] }, sort: [{ by: 'at', direction: 'desc' }] },
        { lines: 2 },
      );
      assert.deepEqual(
        result.data.map((r: Row) => `${r.file.split('/').pop()}#${r.line}`),
        ['bo.jsonl#3', 'cy.jsonl#1'],
      );
    });

    test('past the window: at most so many bytes from the end, whole lines only', async function (assert) {
      let content = files.get(url(BO))!;
      let last = content.split('\n').at(-2)!;
      let result = await onSqlite(
        { from: { log: BO } },
        { bytes: last.length + 5 },
      );
      assert.deepEqual(
        result.data.map((r: Row) => r.line),
        [3],
        'only the last line fits',
      );
      assert.ok(
        result.meta.warnings?.some((w) => w.code === 'sqlite-log-window'),
      );
    });

    test('under the window: no warning', async function (assert) {
      let result = await onSqlite({ from: { log: BO } }, { lines: 3 });
      assert.strictEqual(result.data.length, 3);
      assert.strictEqual(result.meta.warnings, undefined);
    });

    test('an invalid log query is still refused', async function (assert) {
      await assert.rejects(
        onSqlite({ from: { log: BO }, page: { size: -1 } }, {}),
        /page/,
      );
    });

    // --- group roll-ups and facets -------------------------------------------

    const ROLL_UPS: [string, Row][] = [
      [
        'group by a path, every aggregate',
        {
          from: { logs: [ADA, BO, CY] },
          group: {
            by: 'what.action',
            aggregates: {
              lines: { count: true },
              posts: { count: 'what.post' },
              distinct: { distinct: 'what.post' },
              sum: { sum: 'what.n' },
              avg: { avg: 'what.n' },
              min: { min: 'what.n' },
              max: { max: 'what.n' },
              first: { min: 'at' },
              last: { max: 'at' },
              who: { min: 'actor' },
              latest: { latest: 'what.post' },
            },
          },
        },
      ],
      [
        'group by two keys, a missing key its own group',
        {
          from: { logs: { under: 'Feed/' } },
          group: {
            by: ['file', 'what.post'],
            aggregates: { n: { count: true } },
          },
          page: { size: 100 },
        },
      ],
      [
        'groups sorted by an aggregate, then paged',
        {
          from: { logs: [ADA, BO, CY] },
          filter: { exists: 'what.post' },
          group: { by: 'what.post', aggregates: { n: { count: true } } },
          sort: [{ by: 'n', direction: 'desc' }],
          page: { size: 2, number: 1, total: 'exact' },
        },
      ],
      [
        'groups sorted by their key descending, missing first',
        {
          from: { logs: [ADA, BO] },
          group: { by: 'what.n', aggregates: { n: { count: true } } },
          sort: [{ by: 'what.n', direction: 'desc', missing: 'first' }],
        },
      ],
      [
        'min and max over text where no value is a number',
        {
          from: { logs: [ADA, BO] },
          group: {
            by: 'actor',
            aggregates: {
              min: { min: 'what.post' },
              max: { max: 'what.post' },
            },
          },
        },
      ],
      [
        'facets by a path, by a list, and by day',
        {
          from: { logs: [ADA, BO, CY] },
          facets: [
            { by: 'what.action' },
            { by: 'what.tags' },
            { by: 'at' },
            { by: 'actor', size: 2 },
          ],
          page: { size: 0 },
        },
      ],
      [
        'facets by day in a zone other than UTC',
        {
          from: { logs: [ADA, BO, CY] },
          timeZone: 'Pacific/Honolulu',
          facets: [{ by: 'at' }],
        },
      ],
      [
        'facets over a filtered set',
        {
          from: { log: ADA },
          filter: { eq: { 'what.action': 'seen' } },
          facets: [{ by: 'what.post' }],
        },
      ],
    ];

    for (let [rule, q] of ROLL_UPS) {
      test(`as Postgres: ${rule}`, async function (assert) {
        let options = { readLogFile: read, now: NOW };
        let expected = await runLogQuery(pg, realm, q as LogQuery, options);
        let actual = await runLogQuery(
          sqlite as unknown as DBAdapter,
          realm,
          q as LogQuery,
          options,
        );
        assert.deepEqual(
          { ...comparable(actual), facets: actual.meta.facets },
          { ...comparable(expected), facets: expected.meta.facets },
        );
      });
    }

    // A group key, a selected path, a facet and an aggregate are the
    // caller's names, and each is a key of the answer: one that names an
    // object's own machinery (`__proto__`, `constructor`, `toString`) is a key
    // like any other, never the row's prototype or a method.
    test('as Postgres: names an object holds itself are keys like any other', async function (assert) {
      let cases: [string, Row, string, string?][] = [
        [
          'grouped by them, with aggregates named for Object.prototype members',
          {
            from: { log: OWN_NAMES },
            group: {
              by: ['__proto__', 'constructor'],
              aggregates: {
                toString: { count: true },
                valueOf: { max: 'line' },
                hasOwnProperty: { min: 'constructor' },
              },
            },
          },
          JSON.stringify([
            JSON.parse(
              '{"group":{"__proto__":{"polluted":true},"constructor":"c1"},"toString":1,"valueOf":1,"hasOwnProperty":"c1"}',
            ),
            JSON.parse(
              '{"group":{"__proto__":{"polluted":true},"constructor":"c2"},"toString":1,"valueOf":2,"hasOwnProperty":"c2"}',
            ),
          ]),
        ],
        [
          'selected',
          { from: { log: OWN_NAMES }, select: ['__proto__', 'constructor'] },
          '[{"line":1,"__proto__":{"polluted":true},"constructor":"c1"},{"line":2,"__proto__":{"polluted":true},"constructor":"c2"}]',
        ],
        [
          'faceted',
          {
            from: { log: OWN_NAMES },
            facets: [{ by: '__proto__' }, { by: 'constructor' }],
            page: { size: 0 },
          },
          '[]',
          '{"__proto__":[{"value":{"polluted":true},"count":2}],"constructor":[{"value":"c1","count":1},{"value":"c2","count":1}]}',
        ],
      ];
      for (let [rule, q, data, facets] of cases) {
        for (let [engine, db] of [
          ['Postgres', pg],
          ['SQLite', sqlite as unknown as DBAdapter],
        ] as [string, DBAdapter][]) {
          let result = await runLogQuery(db, realm, q as LogQuery, {
            readLogFile: read,
            now: NOW,
          });
          assert.strictEqual(
            JSON.stringify(result.data),
            data,
            `${rule} (${engine}): the rows`,
          );
          if (facets) {
            assert.strictEqual(
              JSON.stringify(result.meta.facets),
              facets,
              `${rule} (${engine}): the facets`,
            );
          }
        }
      }
    });

    test('past the window: roll-ups cover the window, and say so', async function (assert) {
      let result = await onSqlite(
        {
          from: { log: BO },
          group: { by: 'what.action', aggregates: { n: { count: true } } },
        },
        { lines: 2 },
      );
      assert.deepEqual(result.data, [
        { group: { 'what.action': 'like' }, n: 1 },
        { group: { 'what.action': 'seen' }, n: 1 },
      ]);
      assert.ok(
        result.meta.warnings?.some((w) => w.code === 'sqlite-log-window'),
      );
    });
  });
});
