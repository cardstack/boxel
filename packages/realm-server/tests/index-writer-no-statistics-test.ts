import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexWriter,
  VirtualNetwork,
  rri,
  type SearchIndexEntry,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// The no-statistics gate for indexing: a realm's first pass commits on a
// database whose statistics say every table is empty, as they do before a
// realm's first index (or after it was emptied), and its statements must cost
// the same per card from the first chunk to the last. A statement planned
// from those counts that reads a table growing under it (the realm's rows,
// the value store's dictionaries) costs more with every chunk, so a pass
// costs the square of its size; at 36,000 cards that was 130 s inside the
// commit lock. Each watched statement first runs under `EXPLAIN (ANALYZE,
// BUFFERS)` in a savepoint that is rolled back, which counts the buffers it
// touches, and then runs for the writer.

const CARDS = 20_000; // 40 chunks of the value store's 500
const JOB = 900001;
const RESERVATION = 1;

type Reads = { buffers: number; rows: number; jit: boolean };

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  let entry = (url: URL): SearchIndexEntry => ({
    type: 'instance',
    resource: {
      id: rri(url.href),
      type: 'card',
      attributes: {},
      meta: { adoptsFrom: { module: rri(`${testRealm}note`), name: 'Note' } },
    },
    lastModified: 1_000,
    resourceCreatedAt: 1_000,
    searchData: {
      cardTitle: 'Note',
      score: 3,
      tags: ['a', 'b'],
      publishedOn: '2026-11-01',
      _searchText: { A: 'Note', C: 'a pelican' },
    },
    deps: new Set(),
    displayNames: ['Note'],
    types: [`${testRealm}note/Note`],
    isolatedHtml: `<div>Note</div>`,
  });

  // Stages CARDS rows under the job's staging id, as a pass that was
  // interrupted before its commit leaves them: one row as the writer stages
  // it, copied under new urls.
  async function stage() {
    let seed = new URL(`${testRealm}Note/0.json`);
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await batch.updateEntry(seed, entry(seed));
    let columns = (
      (await adapter.execute(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'boxel_index_pending' AND is_generated = 'NEVER' ORDER BY ordinal_position`,
      )) as { column_name: string }[]
    ).map((r) => r.column_name);
    let select = columns.map((c) =>
      c === 'url'
        ? `replace(url, '/0.json', '/' || n || '.json')`
        : c === 'staging_id'
          ? `'job:${JOB}.${RESERVATION}'`
          : c,
    );
    await adapter.execute(
      `INSERT INTO boxel_index_pending (${columns.join(', ')})
       SELECT ${select.join(', ')} FROM boxel_index_pending, generate_series(1, ${CARDS}) AS n
       WHERE url = $1`,
      { bind: [seed.href] },
    );
    await adapter.execute(`DELETE FROM boxel_index_pending WHERE url = $1`, {
      bind: [seed.href],
    });
  }

  // Commits the staged rows, recording the reads of each statement of the
  // swap transaction whose text `watch` matches.
  async function commit(watch: RegExp) {
    let reads: { sql: string; reads: Reads }[] = [];
    let original = adapter.withTransaction.bind(adapter);
    let measure = async (q: any, expression: any): Promise<Reads> => {
      await q(['SAVEPOINT no_statistics']);
      let [row] = await q([
        'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)',
        ...expression,
      ]);
      await q(['ROLLBACK TO SAVEPOINT no_statistics']);
      let explained = (row['QUERY PLAN'] as any)[0];
      let plan = explained.Plan;
      return {
        jit: Boolean(explained.JIT),
        // Temp blocks count too: a join that re-reads a materialized set per
        // row spills it.
        buffers:
          plan['Shared Hit Blocks'] +
          plan['Shared Read Blocks'] +
          plan['Temp Read Blocks'] +
          plan['Temp Written Blocks'],
        rows: plan['Actual Rows'],
      };
    };
    (adapter as any).withTransaction = async (fn: any, opts: any) =>
      original(async (q: any) => {
        let wrapped = async (expression: any, ...rest: any[]) => {
          let sql = flatten(expression);
          if (!watch.test(sql)) {
            return q(expression, ...rest);
          }
          reads.push({ sql, reads: await measure(q, expression) });
          return q(expression, ...rest);
        };
        return fn(wrapped);
      }, opts);
    try {
      let batch: any = await new IndexWriter(adapter).createBatch(
        new URL(testRealm),
        virtualNetwork,
        { jobId: JOB, reservationId: RESERVATION } as any,
        { splitPrerenderHtml: false },
      );
      // The fence reads the attempt's job row, which this test has none of.
      batch.assertAttemptHoldsJob = async () => {};
      await batch.done({ fullRealm: true });
    } finally {
      (adapter as any).withTransaction = original;
    }
    return reads;
  }

  test("a realm's first pass reads the same per chunk from the first to the last, on empty statistics", async function (assert) {
    assert.timeout(900_000);
    await stage();
    // Statistics as before a realm's first index: every table analyzed while
    // the realm had no rows, the staged rows counted.
    await adapter.execute(`ANALYZE`);
    let reads = await commit(
      /^(WITH (live|u) AS|SELECT u\.url FROM jsonb_array_elements_text|INSERT INTO boxel_index \()/,
    );
    // Short chunked statements whose estimates are inflated compile for
    // longer than they run, so the swap turns JIT off.
    assert.deepEqual(
      reads.filter((r) => r.reads.jit).map((r) => r.sql.slice(0, 40)),
      [],
      'no swap statement is JIT-compiled',
    );
    let [promotion] = reads.filter((r) => r.sql.startsWith('INSERT'));
    assert.ok(promotion, 'the promotion ran');
    assert.true(
      promotion.reads.buffers <= 200 * CARDS,
      `the promotion touches a bounded number of buffers per card, not the table once per card (${promotion.reads.buffers} for ${CARDS} cards)`,
    );
    for (let prefix of ['WITH', 'SELECT u.url']) {
      let chunks = reads
        .filter((r) => r.sql.startsWith(prefix))
        .map((r) => r.reads.buffers);
      assert.true(chunks.length >= 40, `${prefix}: ${chunks.length} chunks`);
      let first = chunks[0];
      let late = chunks[39];
      assert.true(
        late <= 2 * first,
        `${prefix}: chunk 40 touches ${late} buffers, at most twice chunk 1's ${first}`,
      );
      // A statement that reaches each card through the whole realm touches
      // the realm's pages for every card: over a thousand per card here.
      assert.true(
        Math.max(...chunks) <= 400 * 500,
        `${prefix}: no chunk touches more than 400 buffers per card (most: ${Math.max(...chunks)})`,
      );
    }
  });
});

function flatten(e: unknown): string {
  if (typeof e === 'string') return e;
  if (Array.isArray(e)) return e.map(flatten).join(' ');
  return '';
}
