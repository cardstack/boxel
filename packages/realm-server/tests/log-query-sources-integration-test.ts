import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  internalKeyFor,
  logSearchResponse,
  param,
  query,
  runLogQuery,
  syncLogFile,
  VirtualNetwork,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type Expression,
  type LogAccess,
  type LogLineIndexHost,
  type LogQuery,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';

// Where a log query's lines come from: one log, several (`from: { logs }`),
// a folder's (`from: { logs: { under } }`), and a card query's `let`
// binding read from a log. Each expectation is worked out here over the
// fixture's lines, never read back from the engine. A policy scope is given
// as the `access` a realm passes (`LogAccess`): the caller's own lines of a
// log, all of them, or none.

const realm = 'http://log-sources-test/';
const ADA = 'Feed/ada.jsonl';
const BO = 'Feed/bo.jsonl';
const CY = 'Feed/sub/cy.jsonl';
const OTHER = 'Other/dee.jsonl';
const SHARED = 'Shared/class.jsonl';

type Row = Record<string, any>;

interface Line {
  file: string;
  line: number;
  at: string;
  actor: string;
  what: Row;
}

const lines: Line[] = [];
const files = new Map<string, string>();

function write(file: string, entries: [string, string, Row][]) {
  let url = `${realm}${file}`;
  let text = '';
  entries.forEach(([at, actor, what], i) => {
    text += `${JSON.stringify({ at, actor, what })}\n`;
    lines.push({
      file: url,
      line: i + 1,
      at: new Date(`${at.replace(' ', 'T')}Z`).toISOString(),
      actor,
      what,
    });
  });
  files.set(url, text);
}

write(ADA, [
  ['2026-11-01 09:00:00', '@ada:test', { action: 'seen', post: 'p1' }],
  ['2026-11-01 09:05:00', '@ada:test', { action: 'like', post: 'p1' }],
  ['2026-11-02 10:00:00', '@ada:test', { action: 'seen', post: 'p2' }],
  ['2026-11-03 11:00:00', '@ada:test', { action: 'seen', post: 'p1' }],
]);
write(BO, [
  ['2026-11-01 08:00:00', '@bo:test', { action: 'like', post: 'p1' }],
  ['2026-11-02 08:00:00', '@bo:test', { action: 'like', post: 'p3' }],
  ['2026-11-02 08:30:00', '@bo:test', { action: 'seen', post: 'p3' }],
]);
write(CY, [
  ['2026-11-02 12:00:00', '@cy:test', { action: 'like', post: 'p2' }],
]);
write(OTHER, [
  ['2026-11-01 07:00:00', '@dee:test', { action: 'like', post: 'p4' }],
]);
// One log many people write: attendance, one line per check-in.
write(SHARED, [
  ['2026-11-01 08:00:00', '@ada:test', { present: true }],
  ['2026-11-01 08:01:00', '@bo:test', { present: true }],
  ['2026-11-02 08:00:00', '@ada:test', { present: true }],
  ['2026-11-02 08:02:00', '@cy:test', { present: true }],
  ['2026-11-03 08:00:00', '@bo:test', { present: true }],
]);

const url = (file: string) => `${realm}${file}`;
const of = (...names: string[]) =>
  lines.filter((l) => names.map(url).includes(l.file));
// Ties keep file order: by log URL, then line.
const fileOrder = (a: Line, b: Line) =>
  a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line;
const keys = (rows: Row[]) => rows.map((r) => `${r.file}#${r.line}`);
const keysOf = (ls: Line[]) => ls.map((l) => `${l.file}#${l.line}`);

// --- a card type for the `let` cases ----------------------------------------

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const cardDefRef = ref('@cardstack/base/card-api', 'CardDef');
const PostRef = ref(`${realm}post`, 'Post');
const POSTS = ['p1', 'p2', 'p3', 'p4', 'p5'];

function definitions(): DefinitionLookup {
  let defs: Definition[] = [
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
  ];
  let same = (a: CodeRef, b: CodeRef) =>
    'module' in a &&
    'module' in b &&
    a.module === b.module &&
    a.name === b.name;
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef) {
      let found = defs.find((d) => same(d.codeRef, codeRef));
      if (!found) {
        throw new Error(`unexpected definition lookup: ${codeRef.name}`);
      }
      return found;
    },
    async lookupDefinitionEntry(): Promise<never> {
      throw new Error('not used');
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

async function seedPost(dbAdapter: PgAdapter, vn: VirtualNetwork, uri: string) {
  let id = `${realm}Post/${uri}`;
  await query(dbAdapter, [
    `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified) VALUES (`,
    param(id),
    `,`,
    param(id),
    `,`,
    param(realm),
    `, 1, 'instance',`,
    param(JSON.stringify({ id, type: 'card' })),
    `::jsonb,`,
    param(JSON.stringify({ uri })),
    `::jsonb, '[]'::jsonb,`,
    param(JSON.stringify([internalKeyFor(PostRef, undefined, vn)])),
    `::jsonb, false, false,`,
    param(Date.now()),
    `,`,
    param(1000),
    `)`,
  ] as Expression);
}

module(basename(import.meta.filename), function () {
  module('log query sources (Postgres integration)', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      before: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        let host: LogLineIndexHost = {
          dbAdapter,
          realmURL: realm,
          query: (e: Expression) => query(dbAdapter, e) as any,
          readLogFile: async (u) =>
            files.has(u) ? { content: files.get(u)! } : undefined,
        };
        for (let u of files.keys()) {
          await syncLogFile(host, u);
        }
        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, definitions(), vn);
        for (let uri of POSTS) {
          await seedPost(dbAdapter, vn, uri);
        }
      },
    });

    let search = (q: Row, access?: (u: string) => LogAccess) =>
      runLogQuery(dbAdapter, realm, q as LogQuery, access ? { access } : {});

    // --- several logs --------------------------------------------------------

    test('logs: [...] reads the named logs as one set, each row naming its file, ties by file then line', async function (assert) {
      let result = await search({
        from: { logs: [BO, ADA] },
        page: { size: 100 },
      });
      assert.deepEqual(keys(result.data), keysOf(of(ADA, BO).sort(fileOrder)));
      assert.deepEqual(result.meta.logs, [url(ADA), url(BO)], 'in file order');
      assert.strictEqual(result.meta.log, undefined);
      assert.strictEqual(result.meta.page.total, of(ADA, BO).length);
    });

    test('logs: a log named twice is read once', async function (assert) {
      let result = await search({
        from: { logs: [ADA, url(ADA), `./${ADA}`] },
        page: { size: 100 },
      });
      assert.strictEqual(result.data.length, of(ADA).length);
      assert.deepEqual(result.meta.logs, [url(ADA)]);
    });

    test('logs: sorted by time, a tie in time keeps file then line order', async function (assert) {
      let result = await search({
        from: { logs: [SHARED, BO] },
        sort: [{ by: 'at', direction: 'asc' }],
        page: { size: 100 },
      });
      let expected = of(SHARED, BO).sort(
        (a, b) => a.at.localeCompare(b.at) || fileOrder(a, b),
      );
      assert.deepEqual(keys(result.data), keysOf(expected));
    });

    test('logs: under a folder reads every log in it and its subfolders, and none outside', async function (assert) {
      let result = await search({
        from: { logs: { under: 'Feed/' } },
        page: { size: 100 },
      });
      assert.deepEqual(
        keys(result.data),
        keysOf(of(ADA, BO, CY).sort(fileOrder)),
      );
      assert.deepEqual(result.meta.logs, [url(ADA), url(BO), url(CY)]);
      let noSlash = await search({
        from: { logs: { under: 'Feed' } },
        page: { size: 100 },
      });
      assert.deepEqual(keys(noSlash.data), keys(result.data), 'Feed is Feed/');
    });

    test('logs: a folder with no logs answers no rows', async function (assert) {
      let result = await search({ from: { logs: { under: 'Nothing/' } } });
      assert.deepEqual(result.data, []);
      assert.deepEqual(result.meta.logs, []);
      assert.strictEqual(result.meta.page.total, 0);
    });

    test('logs: group by file and an entry path counts per log', async function (assert) {
      let result = await search({
        from: { logs: { under: 'Feed/' } },
        filter: { eq: { 'what.action': 'like' } },
        group: {
          by: ['file', 'what.post'],
          aggregates: { n: { count: true } },
        },
        page: { size: 100 },
      });
      let counts = new Map<string, number>();
      for (let l of of(ADA, BO, CY).filter((l) => l.what.action === 'like')) {
        let key = `${l.file}|${l.what.post}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let expected = [...counts.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, n]) => {
          let [file, post] = key.split('|');
          return { group: { file, 'what.post': post }, n };
        });
      assert.deepEqual(result.data, expected);
    });

    test('logs: eq on file keeps one log of several', async function (assert) {
      let result = await search({
        from: { logs: [ADA, BO] },
        filter: { eq: { file: BO } },
        page: { size: 100 },
      });
      assert.deepEqual(keys(result.data), keysOf(of(BO)));
    });

    test('logs: more than 100 logs is refused, not cut', async function (assert) {
      let names = Array.from({ length: 101 }, (_, i) => `Feed/l${i}.jsonl`);
      let { status, body } = await logSearchResponse(dbAdapter, realm, {
        from: { logs: names },
      } as LogQuery);
      assert.strictEqual(status, 400);
      assert.strictEqual((body as Row).errors[0].code, 'limit-exceeded');
    });

    test('logs: from takes log or logs, not both, and logs is never empty', async function (assert) {
      for (let [from, code] of [
        [{ log: ADA, logs: [BO] }, 'conflicting-members'],
        [{ logs: [] }, 'missing-member'],
        [{ logs: { under: 5 } }, 'invalid-value'],
        [{ logs: { below: 'Feed/' } }, 'unknown-key'],
        [{ logs: 'Feed/' }, 'invalid-value'],
      ] as [Row, string][]) {
        let { status, body } = await logSearchResponse(dbAdapter, realm, {
          from,
        } as unknown as LogQuery);
        assert.deepEqual(
          [status, (body as Row).errors?.[0]?.code],
          [400, code],
          JSON.stringify(from),
        );
      }
    });

    test('logs: a folder outside the realm is refused', async function (assert) {
      let { status, body } = await logSearchResponse(dbAdapter, realm, {
        from: { logs: { under: 'http://elsewhere.test/Feed/' } },
      } as LogQuery);
      assert.strictEqual(status, 400);
      assert.strictEqual((body as Row).errors[0].code, 'invalid-value');
    });

    // --- a policy scope -------------------------------------------------------

    const ownLines = (actor: string) => () => ({ actor }) as LogAccess;

    test('policy: rows, total, groups and facets cover only the caller’s own lines', async function (assert) {
      let mine = of(SHARED).filter((l) => l.actor === '@ada:test');
      let rows = await search(
        { from: { log: SHARED }, page: { size: 1, total: 'exact' } },
        ownLines('@ada:test'),
      );
      assert.deepEqual(
        rows.data.map((r) => r.line),
        [mine[0].line],
      );
      assert.strictEqual(rows.meta.page.total, mine.length, 'total');
      assert.true(rows.meta.page.hasMore);
      assert.deepEqual(rows.meta.policyScopedLogs, [url(SHARED)]);

      let facets = await search(
        { from: { log: SHARED }, page: { size: 0 }, facets: [{ by: 'actor' }] },
        ownLines('@ada:test'),
      );
      assert.deepEqual(facets.meta.facets?.actor, [
        { value: '@ada:test', count: mine.length },
      ]);

      // A group whose only lines are someone else's is not there at all.
      let groups = await search(
        {
          from: { log: SHARED },
          group: { by: 'actor', aggregates: { n: { count: true } } },
        },
        ownLines('@cy:test'),
      );
      assert.deepEqual(groups.data, [{ group: { actor: '@cy:test' }, n: 1 }]);
      assert.strictEqual(groups.meta.page.total, 1);
    });

    test('policy: a filter on actor cannot reach past the caller’s lines', async function (assert) {
      let result = await search(
        {
          from: { log: SHARED },
          filter: { any: [{ eq: { actor: '@bo:test' } }, { exists: 'at' }] },
          page: { size: 100 },
        },
        ownLines('@ada:test'),
      );
      assert.deepEqual(
        result.data.map((r) => r.actor),
        ['@ada:test', '@ada:test'],
      );
    });

    test('policy: a named log the caller may read none of is refused; a folder leaves it out', async function (assert) {
      let access = (u: string): LogAccess =>
        u === url(BO) ? 'none' : u === url(ADA) ? 'all' : { actor: '@cy:test' };
      let { status, body } = await logSearchResponse(
        dbAdapter,
        realm,
        { from: { logs: [ADA, BO] } } as LogQuery,
        { access },
      );
      assert.strictEqual(status, 403);
      assert.strictEqual((body as Row).errors[0].code, 'log-not-readable');
      let under = await search(
        { from: { logs: { under: 'Feed/' } }, page: { size: 100 } },
        access,
      );
      assert.deepEqual(
        keys(under.data),
        keysOf([...of(ADA), ...of(CY)].sort(fileOrder)),
        'all of ada, cy’s own lines of cy, nothing of bo',
      );
      assert.deepEqual(under.meta.logs, [url(ADA), url(CY)]);
      assert.deepEqual(under.meta.policyScopedLogs, [url(CY)]);
    });

    // --- a let binding read from a log ------------------------------------

    let cards = async (q: Record<string, any>, opts: Row = {}) => {
      let { cards, meta } = await engine.searchCards(
        new URL(realm),
        q as Query,
        opts,
      );
      return { uris: cards.map((c) => String(c.id).split('/').pop()), meta };
    };

    const seenBy = (log: string) => ({
      from: { log, filter: { eq: { 'what.action': 'seen' } } },
      select: 'what.post',
    });

    test('let from a log: skip what I have seen, in one request', async function (assert) {
      let seen = new Set(
        of(ADA)
          .filter((l) => l.what.action === 'seen')
          .map((l) => l.what.post),
      );
      let { uris, meta } = await cards({
        filter: { on: PostRef, not: { in: { uri: '$seen' } } },
        sort: [{ by: 'uri', on: PostRef }],
        let: { $seen: seenBy(ADA) },
      });
      assert.deepEqual(
        uris,
        POSTS.filter((p) => !seen.has(p)),
      );
      assert.deepEqual(meta.lets?.$seen, {
        strategy: 'list',
        values: seen.size,
      });
    });

    test('let from a log: in keeps what the log names; select may be written inside from', async function (assert) {
      let liked = new Set(
        of(ADA, BO, CY)
          .filter((l) => l.what.action === 'like')
          .map((l) => l.what.post),
      );
      let { uris } = await cards({
        filter: { on: PostRef, in: { uri: '$liked' } },
        sort: [{ by: 'uri', on: PostRef }],
        let: {
          $liked: {
            from: {
              logs: { under: 'Feed/' },
              filter: { eq: { 'what.action': 'like' } },
              select: 'what.post',
            },
          },
        },
      });
      assert.deepEqual(
        uris,
        POSTS.filter((p) => liked.has(p)),
      );
    });

    test('let from a log: the caller’s log access applies to the lines it reads', async function (assert) {
      // Under a policy that admits @bo to their own lines of the shared feed
      // only, Ada's log contributes nothing she saw.
      let { uris } = await cards(
        {
          filter: { on: PostRef, in: { uri: '$liked' } },
          sort: [{ by: 'uri', on: PostRef }],
          let: {
            $liked: {
              from: {
                logs: [ADA, BO],
                filter: { eq: { 'what.action': 'like' } },
              },
              select: 'what.post',
            },
          },
        },
        {
          logAccess: (u: string) =>
            u === url(BO) ? { actor: '@bo:test' } : { actor: '@nobody:test' },
        },
      );
      let liked = new Set(
        of(BO)
          .filter((l) => l.what.action === 'like')
          .map((l) => l.what.post),
      );
      assert.deepEqual(
        uris,
        POSTS.filter((p) => liked.has(p)),
      );
    });

    test('let from a log: a binding that is refused names the log grammar’s mistake', async function (assert) {
      await assert.rejects(
        cards({
          filter: { on: PostRef, in: { uri: '$x' } },
          let: {
            $x: {
              from: { log: ADA, filter: { eq: { 'what-action': 'like' } } },
              select: 'what.post',
            },
          },
        }),
        /Invalid log path/,
      );
      await assert.rejects(
        cards({
          filter: { on: PostRef, in: { uri: '$x' } },
          let: { $x: { from: { log: ADA }, one: true } },
        }),
        /a list/,
      );
      await assert.rejects(
        cards({
          filter: { on: PostRef, in: { uri: '$x' } },
          let: { $x: { from: { log: ADA } } },
        }),
        /select/,
      );
    });

    test('let from a log: a log no pass has synced is refused, never read as empty', async function (assert) {
      await assert.rejects(
        cards({
          filter: { on: PostRef, not: { in: { uri: '$x' } } },
          let: {
            $x: { from: { log: 'Feed/never.jsonl' }, select: 'what.post' },
          },
        }),
        (e: any) => e?.code === 'log-not-indexed',
      );
    });
  });
});
