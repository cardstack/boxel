import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  SEARCH_TEXT_KEY,
  VectorSerializer,
  VirtualNetwork,
  internalKeyFor,
  query as runQuery,
  rri,
  type Definition,
  type DefinitionLookup,
  type Expression,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query-v2/query';
import { hasVectorIndex } from '@cardstack/runtime-common/vector-index';
import { runLogQuery } from '@cardstack/runtime-common/log-query';
import {
  syncLogFile,
  type LogLineIndexHost,
} from '@cardstack/runtime-common/log-line-index';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';
import { definitionLookupOf } from './helpers/definition-lookup.ts';

// The realm test harness (packages/realm-test-harness, `database.ts`) builds
// a realm's index once in a template database and clones it for each run,
// rewriting the realm server's URL when the run's differs, and it resets a
// realm's rows before reseeding them. Both have to reach every table that
// holds a realm's index rows. A clone that misses one answers from rows
// still under the template's URL, or from none, until the realm is indexed
// again; a realm reseeded over a reset that missed one finds the rows the
// reset left. The harness finds the index's side tables itself: every
// `boxel_*` table with a `realm_url` column. These tests write two realms'
// index rows as an index pass does, then clone and reset, and check each
// side table and the answers searches give.

type Harness = typeof import('@cardstack/realm-test-harness/database');

// Loading the harness clears the settings it gives the stacks it spawns
// (`HOST_URL`, the prerender pool's), for the whole process. This suite only
// uses its database functions, and later suites in the same process serve
// through the host, so the environment is put back as it was.
async function loadHarness(): Promise<Harness> {
  let before = { ...process.env };
  // The harness opens its own connections, to the suite's Postgres.
  process.env.TEST_HARNESS_PGPORT ??= process.env.PGPORT;
  process.env.TEST_HARNESS_PGHOST ??= process.env.PGHOST ?? '127.0.0.1';
  let harness = await import('@cardstack/realm-test-harness/database');
  for (let [name, value] of Object.entries(before)) {
    if (process.env[name] !== value) {
      process.env[name] = value;
    }
  }
  return harness;
}

// The realm index's side tables this schema has. A migration that adds
// another must list it here, and fill it in `writeRealm`, so that its clone
// and reset are checked too.
const SIDE_TABLES = [
  'boxel_index_passages',
  'boxel_index_value_cards',
  'boxel_index_value_realms',
  'boxel_index_value_types',
  'boxel_index_vector_sidecars',
  'boxel_index_vectors',
  'boxel_index_words',
  'boxel_log_files',
  'boxel_log_lines',
  'boxel_log_realms',
];

// The side tables `writeRealm` leaves holding a realm's rows.
const FILLED_TABLES = SIDE_TABLES.filter(
  (table) =>
    // A sidecar file's record; these realms have no sidecar files.
    table !== 'boxel_index_vector_sidecars',
);

const TEMPLATE_ORIGIN = 'http://harness-template.test/';
const CLONE_ORIGIN = 'http://harness-clone.test/';
const OTHER_ORIGIN = 'http://harness-other.test/';
const realmAt = (origin: string) => `${origin}notes/`;

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const vectorRef = ref('@cardstack/base/vector', 'default');
const noteRef = (realm: string) => ref(`${realm}note`, 'Note');

const primitive = (
  fieldOrCard: ResolvedCodeRef,
  extra: Record<string, unknown> = {},
) => ({
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard,
  ...extra,
});

// A Note in any realm: the definition is the same wherever its module is.
function noteDefinition(codeRef: ResolvedCodeRef): Definition {
  return {
    type: 'card-def',
    codeRef,
    displayName: 'Note',
    fields: {
      title: 'f0',
      body: 'f1',
      speaker: 'f2',
      vid: 'f3',
      channel: 'f4',
      embedding: 'f5',
    },
    fieldDefs: {
      f0: primitive(stringRef, { search: { role: 'title' } }),
      f1: primitive(stringRef, { search: { role: 'body' } }),
      f2: primitive(stringRef, { search: { role: 'name', typos: true } }),
      f3: primitive(stringRef, {
        search: { role: 'identifier', patterns: true },
      }),
      f4: primitive(stringRef, { search: { role: 'label', facet: true } }),
      f5: primitive(vectorRef, { serializerName: 'vector' }),
    },
  } as Definition;
}

function makeDefinitionLookup(): DefinitionLookup {
  return definitionLookupOf((codeRef) => {
    if (codeRef.name === 'Note' && String(codeRef.module).endsWith('note')) {
      return noteDefinition(codeRef);
    }
    throw new Error(
      `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
    );
  });
}

const vec = (components: number[]) =>
  VectorSerializer.queryableValue(VectorSerializer.encodeVector(components));

interface NoteData {
  title: string;
  body: string;
  speaker: string;
  channel: string;
  embedding: number[];
}

// A body long enough that Postgres stores the search doc out of line.
const longBody = (topic: string) =>
  `${topic} ${Array.from({ length: 400 }, (_, i) => `lorem${i % 7}`).join(' ')} closing remarks on ${topic}`;

const corpus: Record<string, NoteData> = {
  first: {
    title: 'Local-first software',
    body: longBody('replicated data types'),
    speaker: 'Martin Kleppmann',
    channel: 'Strange Loop',
    embedding: [1, 0, 0],
  },
  second: {
    title: 'Ownership in practice',
    body: longBody('borrow checker'),
    speaker: 'Niko Matsakis',
    channel: 'Strange Loop',
    embedding: [1, 1, 0],
  },
  third: {
    title: 'Concurrency patterns',
    body: 'goroutines and channels',
    speaker: 'Rob Pike',
    channel: 'GOTO',
    embedding: [0, 1, 0],
  },
};

const noteURL = (realm: string, name: string) => `${realm}Note/${name}.json`;
// A pattern field whose values are URLs, so a clone has to rewrite the
// trigram-indexed `pattern_text` they are copied into.
const videoURL = (realm: string, name: string) => `${realm}video/${name}`;
const logURL = (realm: string) => `${realm}Note/history.jsonl`;

function logContent(realm: string): string {
  return [1, 2, 3]
    .map(
      (i) =>
        `${JSON.stringify({
          at: `2026-11-10 06:0${i}:00`,
          actor: '@ada:localhost',
          what: JSON.stringify({
            action: 'read',
            card: noteURL(realm, 'first'),
          }),
        })}\n`,
    )
    .join('');
}

function logHost(adapter: PgAdapter, realm: string): LogLineIndexHost {
  return {
    dbAdapter: adapter,
    realmURL: realm,
    query: (e: Expression) => runQuery(adapter, e) as any,
    readLogFile: async (url) =>
      url === logURL(realm) ? { content: logContent(realm) } : undefined,
  };
}

// A realm's index rows, written as an index pass writes them.
async function writeRealm(adapter: PgAdapter, realm: string): Promise<void> {
  let virtualNetwork = new VirtualNetwork();
  let on = noteRef(realm);
  let noteKey = internalKeyFor(on, undefined, virtualNetwork);
  let batch = await new IndexWriter(adapter).createBatch(
    new URL(realm),
    virtualNetwork,
    undefined,
    { splitPrerenderHtml: false },
  );
  for (let [name, data] of Object.entries(corpus)) {
    let cardURL = new URL(noteURL(realm, name));
    let searchData: Record<string, unknown> = {
      ...data,
      vid: videoURL(realm, name),
      // What the render stamps for these declarations.
      [SEARCH_TEXT_KEY]: {
        A: `${data.title}\n${data.speaker}`,
        D: data.body,
        typos: data.speaker,
        patterns: videoURL(realm, name),
      },
      // A passage list (`within`).
      _passages: ['segments'],
      segments: [
        { start: 0, end: 60, text: `opening on ${data.title}` },
        { start: 60, text: `logical clocks and ${data.body.slice(0, 20)}` },
      ],
      embedding: vec(data.embedding),
    };
    await batch.updateEntry(cardURL, {
      type: 'instance',
      resource: {
        id: rri(cardURL.href),
        type: 'card',
        attributes: {},
        meta: { adoptsFrom: { module: rri(on.module), name: 'Note' } },
      },
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData,
      markdown: `# ${data.title}\n\n${data.body}`,
      deps: new Set(),
      displayNames: ['Note'],
      types: [noteKey],
      isolatedHtml: `<div>${name}</div>`,
    });
  }
  await batch.done();
  await syncLogFile(logHost(adapter, realm), logURL(realm));
  // A realm's first log query gives it its own partition of the log lines.
  await runLogQuery(adapter, realm, { from: { log: logURL(realm) } });
}

// What searches of a realm answer, with the realm's origin written as
// `<origin>` so answers from two origins compare.
async function answers(adapter: PgAdapter, realm: string, origin: string) {
  let engine = new IndexQueryEngine(
    adapter,
    makeDefinitionLookup(),
    new VirtualNetwork(),
  );
  let on = noteRef(realm);
  let queries: Record<string, Query> = {
    'every note, by title': {
      filter: { type: on },
      sort: [{ on, by: 'title', direction: 'asc' }],
    },
    'a word only a long body holds': {
      filter: { on, contains: { body: 'closing remarks on borrow' } },
    },
    'a misspelt name, corrected from the word list': {
      filter: { on, matches: 'martn kleppmann', typos: true },
    },
    'a glob over a pattern field holding URLs': {
      filter: { on, pattern: { vid: `${videoURL(realm, '')}s*` } },
    },
    'facet counts': { filter: { type: on }, facets: [{ by: 'channel' }] },
    'nearest first': {
      filter: { type: on },
      sort: [{ on, by: 'embedding', near: [1, 0, 0] }],
    },
  };
  let out: Record<string, unknown> = {};
  for (let [name, query] of Object.entries(queries)) {
    let result = await engine.searchCards(new URL(realm), query);
    out[name] = {
      ids: result.cards.map((card) => String(card.id)),
      facets: result.meta.facets,
    };
  }
  out['log lines'] = (
    await runLogQuery(adapter, realm, { from: { log: logURL(realm) } })
  ).data;
  return JSON.parse(JSON.stringify(out).replaceAll(origin, '<origin>'));
}

// A table's rows for a realm as JSON, less timestamp columns, in a stable
// order.
async function rowsOf(
  adapter: PgAdapter,
  table: string,
  realm: string,
): Promise<unknown[]> {
  let stamps = (
    (await adapter.execute(
      `SELECT a.attname AS name FROM pg_attribute a
        WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
          AND format_type(a.atttypid, NULL) LIKE 'timestamp%'`,
      { bind: [table] },
    )) as { name: string }[]
  ).map((r) => r.name);
  // The value store's dictionaries are compared by their natural values:
  // an id is a sequence's next number, which a reseed after another realm's
  // rows does not repeat. The store's own rows are compared the same way, by
  // `storeRowsOf`.
  if (VALUE_DICTIONARIES.includes(table)) {
    stamps = [...stamps, 'id'];
  }
  let rows = (await adapter.execute(
    `SELECT (to_jsonb(t) - $2::text[])::text AS row FROM ${table} AS t
      WHERE realm_url = $1`,
    { bind: [realm, stamps] },
  )) as { row: string }[];
  return rows.map((r) => r.row).sort();
}

const VALUE_DICTIONARIES = [
  'boxel_index_value_cards',
  'boxel_index_value_realms',
  'boxel_index_value_types',
];

// A realm's value rows, each with its ids read back to the realm, card url,
// path and type they name.
async function storeRowsOf(
  adapter: PgAdapter,
  realm: string,
): Promise<unknown[]> {
  let rows = (await adapter.execute(
    `SELECT jsonb_build_object('realm', r.realm_url, 'url', c.url, 'path', p.path,
              'type', t.type, 'kind', v.kind, 'txt', v.txt, 'num', v.num, 'ts', v.ts)::text AS row
       FROM boxel_index_values AS v
       JOIN boxel_index_value_realms AS r ON r.id = v.realm_id
       JOIN boxel_index_value_cards AS c ON c.id = v.card_id
       JOIN boxel_index_value_paths AS p ON p.id = v.path_id
       JOIN boxel_index_value_types AS t ON t.id = v.type_id
      WHERE r.realm_url = $1`,
    { bind: [realm] },
  )) as { row: string }[];
  return rows.map((r) => r.row).sort();
}

async function snapshot(adapter: PgAdapter, realm: string) {
  let out: Record<string, unknown[]> = {};
  for (let table of SIDE_TABLES) {
    out[table] = await rowsOf(adapter, table, realm);
  }
  out.boxel_index_values = await storeRowsOf(adapter, realm);
  return out;
}

// The tables the harness treats as the realm index's side tables, read from
// the catalog the way it reads them.
async function sideTablesInSchema(adapter: PgAdapter): Promise<string[]> {
  let rows = (await adapter.execute(
    `SELECT c.relname AS name FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')
        AND NOT c.relispartition AND c.relname LIKE 'boxel\\_%'
        AND c.relname NOT IN ('boxel_index', 'boxel_index_pending', 'boxel_index_working')
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                     AND a.attname = 'realm_url' AND NOT a.attisdropped)`,
  )) as { name: string }[];
  return rows.map((r) => r.name).sort();
}

async function databaseOf(adapter: PgAdapter): Promise<string> {
  let [row] = (await adapter.execute(`SELECT current_database() AS name`)) as {
    name: string;
  }[];
  return row.name;
}

async function indexRowCount(
  adapter: PgAdapter,
  realm: string,
): Promise<number> {
  let [row] = (await adapter.execute(
    `SELECT COUNT(*)::int AS n FROM boxel_index WHERE realm_url = $1`,
    { bind: [realm] },
  )) as { n: number }[];
  return row.n;
}

async function logPartitionOf(
  adapter: PgAdapter,
  realm: string,
): Promise<{ name: string | undefined; lines: number; inDefault: number }> {
  let [row] = (await adapter.execute(
    `SELECT partition_name FROM boxel_log_realms WHERE realm_url = $1`,
    { bind: [realm] },
  )) as { partition_name: string }[];
  let name = row?.partition_name;
  let count = async (table: string) =>
    Number(
      (
        (await adapter.execute(
          `SELECT COUNT(*)::int AS n FROM ${table} WHERE realm_url = $1`,
          { bind: [realm] },
        )) as { n: number }[]
      )[0].n,
    );
  return {
    name,
    lines: name ? await count(name) : 0,
    inDefault: await count('boxel_log_lines_default'),
  };
}

async function tableExists(adapter: PgAdapter, table: string) {
  let [row] = (await adapter.execute(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    { bind: [table] },
  )) as { present: boolean }[];
  return Boolean(row.present);
}

module(basename(import.meta.filename), function (hooks) {
  let harness: Harness;
  let adapters: PgAdapter[] = [];

  let hostURLBefore: string | undefined;
  hooks.before(async function () {
    hostURLBefore = process.env.HOST_URL;
    harness = await loadHarness();
  });

  hooks.afterEach(async function () {
    for (let adapter of adapters.reverse()) {
      await closeTestPgAdapter(adapter);
    }
    adapters = [];
  });

  async function freshDatabase(templateDatabase?: string) {
    prepareTestDB();
    let adapter = await createTestPgAdapter(
      templateDatabase ? { templateDatabase } : undefined,
    );
    adapters.push(adapter);
    if (!(await hasVectorIndex(adapter))) {
      throw new Error(
        'this Postgres has no pgvector; run the tests on the test image',
      );
    }
    return adapter;
  }

  test("loading the harness leaves the suite's environment as it was", function (assert) {
    // HOST_URL is set for every realm-server suite; the harness's own
    // module clears it when it loads.
    assert.strictEqual(process.env.HOST_URL, hostURLBefore);
  });

  test('the side tables are the ones this test checks', async function (assert) {
    let adapter = await freshDatabase();
    assert.deepEqual(
      await sideTablesInSchema(adapter),
      [...SIDE_TABLES].sort(),
    );
  });

  test('a clone to a new origin answers as its template did, before any reindex', async function (assert) {
    let template = await freshDatabase();
    let realm = realmAt(TEMPLATE_ORIGIN);
    let other = realmAt(OTHER_ORIGIN);
    await writeRealm(template, realm);
    await writeRealm(template, other);
    let templateRows = await snapshot(template, realm);
    for (let table of FILLED_TABLES) {
      assert.ok(templateRows[table].length > 0, `the realm fills ${table}`);
    }
    let otherRows = await snapshot(template, other);
    let templateAnswers = await answers(template, realm, TEMPLATE_ORIGIN);
    let otherAnswers = await answers(template, other, OTHER_ORIGIN);
    let templateDatabase = await databaseOf(template);
    // A database is a template only once nothing is connected to it.
    await template.close();

    let clone = await freshDatabase(templateDatabase);
    let cloneDatabase = await databaseOf(clone);
    await harness.rewriteClonedRealmServerUrls(
      cloneDatabase,
      new URL(TEMPLATE_ORIGIN),
      new URL(CLONE_ORIGIN),
    );
    await harness.clearPendingIndexRows(cloneDatabase);

    let cloned = realmAt(CLONE_ORIGIN);
    assert.deepEqual(
      await answers(clone, cloned, CLONE_ORIGIN),
      templateAnswers,
      'searches of the clone answer as the template did',
    );
    let expected = JSON.parse(
      JSON.stringify(templateRows).replaceAll(TEMPLATE_ORIGIN, CLONE_ORIGIN),
    ) as Record<string, string[]>;
    let cloneRows = await snapshot(clone, cloned);
    for (let table of SIDE_TABLES) {
      assert.deepEqual(
        cloneRows[table],
        [...expected[table]].sort(),
        `${table} holds the template's rows under the new URL`,
      );
      let [{ n }] = (await clone.execute(
        `SELECT COUNT(*)::int AS n FROM ${table} AS t
          WHERE position($1 in to_jsonb(t)::text) > 0`,
        { bind: [TEMPLATE_ORIGIN] },
      )) as { n: number }[];
      assert.strictEqual(n, 0, `${table} keeps nothing of the template's URL`);
    }
    assert.deepEqual(
      await snapshot(clone, other),
      otherRows,
      "another server's realm keeps its rows",
    );
    assert.deepEqual(
      await answers(clone, other, OTHER_ORIGIN),
      otherAnswers,
      'and its answers',
    );
    let partition = await logPartitionOf(clone, cloned);
    assert.ok(partition.name, 'the cloned realm has its log partition');
    assert.strictEqual(
      partition.lines,
      3,
      'its lines are in that partition, which is bound to the new URL',
    );
    assert.strictEqual(partition.inDefault, 0, 'none in the default one');
  });

  test('a reset clears one realm from every side table and leaves the rest; a reseed restores it', async function (assert) {
    let adapter = await freshDatabase();
    let database = await databaseOf(adapter);
    let realm = realmAt(TEMPLATE_ORIGIN);
    let other = realmAt(OTHER_ORIGIN);
    await writeRealm(adapter, realm);
    await writeRealm(adapter, other);
    let realmRows = await snapshot(adapter, realm);
    let otherRows = await snapshot(adapter, other);
    let realmAnswers = await answers(adapter, realm, TEMPLATE_ORIGIN);
    let otherAnswers = await answers(adapter, other, OTHER_ORIGIN);
    let { name: partitionName } = await logPartitionOf(adapter, realm);

    await harness.resetRealmState(database, new URL(realm));

    assert.strictEqual(await indexRowCount(adapter, realm), 0);
    let afterReset = await snapshot(adapter, realm);
    for (let table of SIDE_TABLES) {
      assert.deepEqual(afterReset[table], [], `${table} has none of its rows`);
    }
    assert.false(
      await tableExists(adapter, partitionName!),
      'its log partition is dropped',
    );
    assert.deepEqual(
      await snapshot(adapter, other),
      otherRows,
      'the other realm keeps its rows',
    );
    assert.deepEqual(
      await answers(adapter, other, OTHER_ORIGIN),
      otherAnswers,
      'and its answers',
    );

    // Reseeded the way a run reseeds it: indexed again, by a process that
    // starts after the reset.
    let reseeding = new PgAdapter();
    try {
      await writeRealm(reseeding, realm);
    } finally {
      await reseeding.close();
    }
    assert.deepEqual(
      await snapshot(adapter, realm),
      realmRows,
      'a reseed writes the same rows, with nothing left over to collide with',
    );
    assert.deepEqual(
      await answers(adapter, realm, TEMPLATE_ORIGIN),
      realmAnswers,
      'and searches answer as before',
    );
  });
});
