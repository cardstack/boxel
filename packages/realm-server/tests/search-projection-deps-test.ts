import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  VirtualNetwork,
  type DefinitionLookup,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';

// The item-only (`dataOnly`) entry projection — the one a list page that asks
// for `fields[entry]=item...` runs — must not read `prerendered_html.deps` for
// card-instance rows. `deps` is a toasted jsonb holding a few hundred
// dependency URLs per row, and nothing in the item-only assembly of an
// instance row reads it: on a 200-card list it was the whole of the
// prerendered_html toast read. File rows keep it.

const realmURL = 'http://deps-overfetch-test/';
const instanceCount = 300;
const depsPerRow = 250;

const stubDefinitionLookup: DefinitionLookup = {
  async lookupDefinition() {
    throw new Error('lookupDefinition is not used by these tests');
  },
  async lookupDefinitionEntry(): Promise<never> {
    throw new Error('lookupDefinitionEntry is not used by these tests');
  },
  async lookupCachedDefinition() {
    return undefined;
  },
  async lookupCachedDefinitionEntry() {
    return { status: 'not-cached' as const };
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
    return stubDefinitionLookup;
  },
};

// A few hundred card instances, each with a prerendered_html row whose `deps`
// (md5-named URLs, so pglz cannot squeeze it back inline) lives out of line in
// the TOAST table — the shape a real realm's rendered cards have.
async function seedInstances(dbAdapter: PgAdapter) {
  await dbAdapter.execute(`
    INSERT INTO boxel_index
      (url, file_alias, realm_url, generation, type, pristine_doc, search_doc,
       types, display_names, is_deleted, has_error, indexed_at)
    SELECT
      '${realmURL}case-' || g || '.json', '${realmURL}case-' || g,
      '${realmURL}', 1, 'instance',
      jsonb_build_object(
        'id', '${realmURL}case-' || g, 'type', 'card',
        'attributes', jsonb_build_object(
          'number', g, 'name', 'Case ' || g, 'status', 'open',
          'goal', 'Goal ' || md5(g::text)),
        'meta', jsonb_build_object('adoptsFrom',
          jsonb_build_object('module', '${realmURL}query-case', 'name', 'QueryCase'))),
      jsonb_build_object('number', g, 'name', 'Case ' || g, 'status', 'open'),
      '["${realmURL}query-case/QueryCase"]'::jsonb, '["Query Case"]'::jsonb,
      false, false, 1
    FROM generate_series(1, ${instanceCount}) AS g
  `);
  await dbAdapter.execute(`
    INSERT INTO prerendered_html
      (url, file_alias, realm_url, type, fitted_html, deps, generation,
       is_deleted, rendered_at)
    SELECT
      '${realmURL}case-' || g || '.json', '${realmURL}case-' || g,
      '${realmURL}', 'instance',
      jsonb_build_object('${realmURL}query-case/QueryCase',
        '<div class="fitted">Case ' || g || '</div>'),
      (SELECT jsonb_agg('${realmURL}' || md5(g || '-' || k) || '.glimmer-scoped.css')
         FROM generate_series(1, ${depsPerRow}) AS k),
      1, false, 1
    FROM generate_series(1, ${instanceCount}) AS g
  `);
}

async function seedFile(dbAdapter: PgAdapter) {
  let url = `${realmURL}notes.md`;
  await dbAdapter.execute(`
    INSERT INTO boxel_index
      (url, file_alias, realm_url, generation, type, pristine_doc, search_doc,
       types, display_names, is_deleted, has_error, indexed_at, last_modified,
       resource_created_at)
    VALUES (
      '${url}', '${url}', '${realmURL}', 1, 'file',
      '{"id": "${url}", "type": "file-meta", "attributes": {"name": "notes.md"}}'::jsonb,
      '{"name": "notes.md", "url": "${url}"}'::jsonb,
      '["https://cardstack.com/base/markdown-file-def/MarkdownDef"]'::jsonb,
      '["Markdown"]'::jsonb, false, false, 1, 1, 1)
  `);
  await dbAdapter.execute(`
    INSERT INTO prerendered_html
      (url, file_alias, realm_url, type, deps, generation, is_deleted,
       rendered_at)
    VALUES ('${url}', '${url}', '${realmURL}', 'file',
      '["${realmURL}notes.md.glimmer-scoped.css"]'::jsonb, 1, false, 1)
  `);
}

interface BlockCounts {
  // Buffer requests (hit + read) against the prerendered_html TOAST table.
  prerenderedToast: number;
  // ...and against boxel_index's TOAST table.
  indexToast: number;
  // Every relation of both tables: heaps, TOAST tables and indexes.
  total: number;
}

// Run `sql` on one pinned connection inside a transaction and read this
// backend's not-yet-flushed per-relation block counters
// (`pg_stat_get_xact_blocks_fetched`) before and after it, so the counts are
// exactly what the statement itself touched — no stats-collector flush delay.
// (A cold measurement lives outside the suite: it needs a Postgres restart.)
async function runCountingBlocks(
  dbAdapter: PgAdapter,
  sql: string,
  bind: unknown[] | undefined,
): Promise<{ rows: Record<string, unknown>[]; blocks: BlockCounts }> {
  let pool = (
    dbAdapter as unknown as {
      pool: {
        connect(): Promise<{
          query(
            q: string | { text: string; values?: unknown[] },
          ): Promise<{ rows: Record<string, unknown>[] }>;
          release(): void;
        }>;
      };
    }
  ).pool;
  let client = await pool.connect();
  let counters = `
    WITH tables AS (
      SELECT oid, relname, reltoastrelid FROM pg_class
      WHERE relname IN ('prerendered_html', 'boxel_index')
    ), rels AS (
      SELECT oid AS rel, relname, 'heap' AS kind FROM tables
      UNION ALL SELECT reltoastrelid, relname, 'toast' FROM tables
      UNION ALL SELECT x.indexrelid, t.relname, 'index'
        FROM pg_index x JOIN tables t ON x.indrelid = t.oid
      UNION ALL SELECT x.indexrelid, t.relname, 'toast-index'
        FROM pg_index x JOIN tables t ON x.indrelid = t.reltoastrelid
    )
    SELECT
      COALESCE(SUM(pg_stat_get_xact_blocks_fetched(rel))
        FILTER (WHERE relname = 'prerendered_html' AND kind = 'toast'), 0)::int
        AS prerendered_toast,
      COALESCE(SUM(pg_stat_get_xact_blocks_fetched(rel))
        FILTER (WHERE relname = 'boxel_index' AND kind = 'toast'), 0)::int
        AS index_toast,
      COALESCE(SUM(pg_stat_get_xact_blocks_fetched(rel)), 0)::int AS total
    FROM rels`;
  try {
    await client.query('BEGIN');
    // The test Postgres boots with track_counts off; turn it on for this
    // transaction so the counters below record the statement's reads.
    await client.query('SET LOCAL track_counts = on');
    let [before] = (await client.query(counters)).rows;
    let { rows } = await client.query({ text: sql, values: bind });
    let [after] = (await client.query(counters)).rows;
    await client.query('COMMIT');
    return {
      rows,
      blocks: {
        prerenderedToast:
          Number(after.prerendered_toast) - Number(before.prerendered_toast),
        indexToast: Number(after.index_toast) - Number(before.index_toast),
        total: Number(after.total) - Number(before.total),
      },
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module(basename(import.meta.filename), function () {
  module('dataOnly projection deps over-fetch (Postgres)', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        engine = new IndexQueryEngine(
          dbAdapter,
          stubDefinitionLookup,
          new VirtualNetwork(),
        );
        await seedInstances(dbAdapter);
        await seedFile(dbAdapter);
        await dbAdapter.execute('ANALYZE boxel_index');
        await dbAdapter.execute('ANALYZE prerendered_html');
      },
    });

    // Runs the list page's engine call — the item-only projection in the
    // default 'all' scope (no `scope` on the wire) — capturing each statement
    // and running the page's statement through the block counter.
    async function listPage(filterUrls?: string[]) {
      let executed: string[] = [];
      let pageBlocks: BlockCounts | undefined;
      let originalExecute = dbAdapter.execute.bind(dbAdapter);
      dbAdapter.execute = (async (
        sql: string,
        opts?: Parameters<typeof originalExecute>[1],
      ) => {
        executed.push(sql);
        if (sql.includes('GROUP BY i.url, i.type') && !sql.includes('COUNT(')) {
          let { rows, blocks } = await runCountingBlocks(
            dbAdapter,
            sql,
            opts?.bind as unknown[] | undefined,
          );
          pageBlocks = blocks;
          return rows;
        }
        return originalExecute(sql, opts);
      }) as typeof dbAdapter.execute;
      try {
        let result = await engine.search(
          new URL(realmURL),
          {
            page: { size: 200, number: 0 },
          },
          filterUrls ? { cardUrls: filterUrls } : {},
          { kind: 'dataOnly' },
          'all',
        );
        return { result, executed, pageBlocks: pageBlocks! };
      } finally {
        dbAdapter.execute = originalExecute;
      }
    }

    test('an instance-only list page reads no prerendered_html.deps', async function (assert) {
      let { result, executed, pageBlocks } = await listPage();

      assert.strictEqual(
        result.meta.page.total,
        instanceCount + 1,
        'total counts every instance and the file',
      );
      assert.strictEqual(result.results.length, 200, 'one full page');
      assert.true(
        result.results.every((row) => row.type === 'instance'),
        'the first page (url order) holds only card instances',
      );
      assert.true(
        result.results.every(
          (row) =>
            row.pristine_doc != null &&
            (row.pristine_doc as { attributes?: Record<string, unknown> })
              .attributes?.name != null,
        ),
        'every instance row still carries its pristine_doc',
      );
      assert.true(
        result.results.every((row) => row.deps == null),
        'no instance row carries prerendered deps',
      );

      let page = executed.find(
        (sql) =>
          sql.includes('GROUP BY i.url, i.type') && !sql.includes('COUNT('),
      );
      assert.ok(page, 'captured the page statement');
      // Every mention of ph.deps in the projection is gated to file rows.
      let ungated = page!
        .replace(/CASE WHEN i\.type = 'file' THEN ph\.deps END/g, '')
        .includes('ph.deps');
      assert.false(
        ungated,
        'the projection reads ph.deps only through the file-row gate',
      );

      console.log(
        `[deps over-fetch] 200-row instance list page (warm): prerendered_html toast ${pageBlocks.prerenderedToast} blocks, boxel_index toast ${pageBlocks.indexToast} blocks, both tables total ${pageBlocks.total} blocks`,
      );
      assert.strictEqual(
        pageBlocks.prerenderedToast,
        0,
        'the page statement touches no prerendered_html TOAST block',
      );
    });

    test('a file entry in the same projection still gets its deps', async function (assert) {
      let fileUrl = `${realmURL}notes.md`;
      let { result } = await listPage([fileUrl, `${realmURL}case-1.json`]);
      let file = result.results.find((row) => row.type === 'file');
      let card = result.results.find((row) => row.type === 'instance');
      assert.ok(file, 'the file row is in the page');
      assert.deepEqual(
        file!.deps,
        [`${realmURL}notes.md.glimmer-scoped.css`],
        'the file row carries its prerendered deps',
      );
      assert.ok(card, 'the instance row is in the page');
      assert.strictEqual(
        card!.deps,
        null,
        'the instance row beside it carries none',
      );
    });
  });
});
