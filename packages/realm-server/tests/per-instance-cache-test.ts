import { module, test } from 'qunit';
import { basename } from 'path';
import { rri, query, param, type Expression } from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { setupPermissionedRealmCached } from './helpers';

// Exercises the job-scoped per-instance wire-format cache
// (job_scoped_instance_cache) that RealmIndexQueryEngine.loadLinks consults
// per root resource. The cache activates only when a request carries a job
// identity (the `x-boxel-job-id` header) — which in normal operation only
// indexer-driven prerender stamps, so live traffic skips it.

const testRealm = new URL('http://127.0.0.1:4452/test/');
const CACHE_TABLE = 'job_scoped_instance_cache';

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['target.gts'] = `
    import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
    import StringField from "https://cardstack.com/base/string";

    export class Target extends CardDef {
      @field name = contains(StringField);
      @field cardTitle = contains(StringField);
    }
  `;

  fs['consumer.gts'] = `
    import { contains, field, linksTo, linksToMany, CardDef } from "https://cardstack.com/base/card-api";
    import StringField from "https://cardstack.com/base/string";
    import { Target } from "./target";

    export class Consumer extends CardDef {
      @field name = contains(StringField);
      @field directLink = linksTo(() => Target);
      @field queryLinks = linksToMany(() => Target, {
        query: {
          filter: { eq: { cardTitle: 'query-match' } },
          page: { size: 10, number: 0 },
        },
      });
    }
  `;

  for (let i = 0; i < 3; i++) {
    fs[`query-target-${i}.json`] = {
      data: {
        attributes: { name: `QT${i}`, cardTitle: 'query-match' },
        meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
      },
    } as LooseSingleCardDocument;
  }

  fs['direct-target.json'] = {
    data: {
      attributes: { name: 'DT', cardTitle: 'direct' },
      meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
    },
  } as LooseSingleCardDocument;

  fs['consumer-1.json'] = {
    data: {
      attributes: { name: 'C1' },
      relationships: { directLink: { links: { self: './direct-target' } } },
      meta: { adoptsFrom: { module: rri('./consumer'), name: 'Consumer' } },
    },
  } as LooseSingleCardDocument;

  // Extra Consumers so a `type: Consumer` search returns multiple data[]
  // results, letting the search-path test assert every result instance is
  // cached (not just that some row exists).
  for (let i = 2; i <= 3; i++) {
    fs[`consumer-${i}.json`] = {
      data: {
        attributes: { name: `C${i}` },
        meta: { adoptsFrom: { module: rri('./consumer'), name: 'Consumer' } },
      },
    } as LooseSingleCardDocument;
  }

  return fs;
}

module(basename(__filename), function () {
  module('per-instance wire-format cache', function (hooks) {
    let realm: Realm;
    let dbAdapter: PgAdapter;

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: testRealm,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      onRealmSetup({ testRealm: r, dbAdapter: a }) {
        realm = r;
        dbAdapter = a;
      },
    });

    hooks.beforeEach(async function () {
      await query(dbAdapter, [`DELETE FROM ${CACHE_TABLE}`] as Expression);
    });

    async function queryLinkCount(jobIdentity?: string): Promise<number> {
      let result = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${testRealm}consumer-1`),
        { loadLinks: true, ...(jobIdentity ? { jobIdentity } : {}) },
      );
      let doc = result?.type === 'doc' ? result.doc : undefined;
      let queryLinks = (
        doc?.data.relationships as
          | Record<string, { data?: Array<{ id: string }> }>
          | undefined
      )?.queryLinks;
      return queryLinks?.data?.length ?? -1;
    }

    async function cacheRowCount(jobIdentity: string): Promise<number> {
      let rows = (await query(dbAdapter, [
        `SELECT COUNT(*)::int AS count FROM ${CACHE_TABLE} WHERE job_id =`,
        param(jobIdentity),
      ] as Expression)) as { count: number }[];
      return rows[0]?.count ?? 0;
    }

    test('no job identity: live traffic resolves query fields live and never touches the cache', async function (assert) {
      assert.strictEqual(await queryLinkCount(), 3, 'three live matches');
      let rows = (await query(dbAdapter, [
        `SELECT COUNT(*)::int AS count FROM ${CACHE_TABLE}`,
      ] as Expression)) as { count: number }[];
      let total = rows[0]?.count ?? 0;
      assert.strictEqual(total, 0, 'table untouched without a job identity');
    });

    test('with a job identity: writes the assembled resource, and a hit is served from the cache', async function (assert) {
      // First call assembles live and writes the cache.
      assert.strictEqual(await queryLinkCount('7.1'), 3, 'first call is live');
      assert.ok(
        (await cacheRowCount('7.1')) >= 1,
        'an entry was written for this job',
      );

      // Mutate the cached consumer row so the umbrella names zero matches.
      // A subsequent assembly under the same job must reflect the cached
      // (pinned) value, proving the read path short-circuits populateQueryFields.
      let rows = (await query(dbAdapter, [
        `SELECT url, result FROM ${CACHE_TABLE} WHERE job_id =`,
        param('7.1'),
        ` AND url LIKE '%consumer-1'`,
      ] as Expression)) as { url: string; result: string }[];
      assert.strictEqual(rows.length, 1, 'consumer row is cached');
      let rels = JSON.parse(rows[0].result) as {
        queryLinks?: { data?: unknown[] };
      };
      rels.queryLinks = { ...(rels.queryLinks ?? {}), data: [] };
      await query(dbAdapter, [
        `UPDATE ${CACHE_TABLE} SET result =`,
        param(JSON.stringify(rels)),
        ` WHERE job_id =`,
        param('7.1'),
        ` AND url =`,
        param(rows[0].url),
      ] as Expression);

      assert.strictEqual(
        await queryLinkCount('7.1'),
        0,
        'second call under the same job is served from the (mutated) cache',
      );
    });

    test('cache is scoped per job identity', async function (assert) {
      // Populate + poison job 8.1's cached consumer row.
      await queryLinkCount('8.1');
      await query(dbAdapter, [
        `UPDATE ${CACHE_TABLE} SET result =`,
        param(JSON.stringify({ queryLinks: { data: [] } })),
        ` WHERE job_id =`,
        param('8.1'),
        ` AND url LIKE '%consumer-1'`,
      ] as Expression);
      assert.strictEqual(
        await queryLinkCount('8.1'),
        0,
        'job 8.1 reads its own poisoned entry',
      );

      // A different job identity must not see job 8.1's entry.
      assert.strictEqual(
        await queryLinkCount('9.1'),
        3,
        'job 9.1 assembles live, ignoring job 8.1 entries',
      );
    });

    // Regression for the real search path. Indexing funnels through
    // `Realm.search`, which rebuilds the `searchCards` opts; if it drops
    // `jobIdentity`, `loadLinks` never gets a cache key and the cache is
    // silently never populated during indexing — even though the search itself
    // runs fine. The `cardDocument`-based tests above cannot catch this because
    // they pass `jobIdentity` straight into the engine, bypassing `Realm.search`.
    //
    // Precise assertion: every instance in the search's `data[]` is cached, by
    // its own URL, with its assembled query-field umbrella (not merely that
    // "some row" exists).
    test('Realm.search caches every data[] result instance with its expanded query fields', async function (assert) {
      let doc = await realm.search(
        {
          filter: {
            type: { module: rri(`${testRealm}consumer`), name: 'Consumer' },
          },
        },
        {
          cacheOnlyDefinitions: true,
          skipQueryBackedExpansion: true,
          omitIncluded: true,
          jobIdentity: '11.1',
        },
      );

      let resultIds = (doc.data ?? [])
        .map((r) => r.id)
        .filter(Boolean) as string[];
      assert.strictEqual(
        resultIds.length,
        3,
        'search returned all three Consumer data[] results',
      );

      let rows = (await query(dbAdapter, [
        `SELECT url, result FROM ${CACHE_TABLE} WHERE job_id =`,
        param('11.1'),
      ] as Expression)) as { url: string; result: string }[];
      let cachedByUrl = new Map(rows.map((r) => [r.url, r.result]));

      for (let id of resultIds) {
        let cached = cachedByUrl.get(id);
        assert.notStrictEqual(
          cached,
          undefined,
          `data[] result ${id} is cached`,
        );
        let rels = JSON.parse(cached ?? '{}') as {
          queryLinks?: { data?: unknown[] };
        };
        assert.strictEqual(
          rels.queryLinks?.data?.length,
          3,
          `cached entry for ${id} holds its expanded queryLinks umbrella`,
        );
      }
    });
  });
});
