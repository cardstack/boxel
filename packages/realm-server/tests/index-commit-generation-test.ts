import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexWriter,
  VirtualNetwork,
  rri,
  type Batch,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
  waitUntil,
} from './helpers/index.ts';

const cardDefKey = 'https://cardstack.com/base/card-api/CardDef';
const personKey = `${testRealm}person/Person`;
const petKey = `${testRealm}pet/Pet`;

// Holds every `realm_type_generations` statement for `seconds`. The index swap
// stamps that table after it has allocated its generation and promoted its
// rows, so a swap held here is holding the realm's commit lock. Before
// sleeping it takes a transaction-scoped advisory lock, which is how the test
// sees that a swap has arrived: the test database runs with activity tracking
// off, so `pg_stat_activity` shows no queries, but `pg_locks` always lists a
// granted lock.
const SLOW_STAMP_FUNCTION = 'index_commit_generation_test_slow_stamp';
const SLOW_STAMP_TRIGGER = 'index_commit_generation_test_slow_stamp_trigger';
const SLOW_STAMP_LOCK_KEY = 1317401;

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let indexWriter: IndexWriter;
  let virtualNetwork: VirtualNetwork;
  let jobCounter = 1;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    indexWriter = new IndexWriter(adapter);
    virtualNetwork = new VirtualNetwork();
  });

  hooks.afterEach(async function () {
    await adapter.close();
  });

  const url = (name: string) => `${testRealm}${name}.json`;

  async function createBatch(opts?: { splitPrerenderHtml?: boolean }) {
    return await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      {
        jobId: jobCounter++,
        reservationId: 1,
        priority: 0,
        queueWaitMs: null,
      },
      opts,
    );
  }

  // Stages one card of `typeKey` in the batch, the way an index visit would.
  async function stageCard(batch: Batch, name: string, typeKey: string) {
    await batch.invalidate([new URL(url(name))]);
    await writeCard(batch, name, typeKey);
  }

  // The visit's write alone, for a pass whose invalidation ran earlier.
  async function writeCard(batch: Batch, name: string, typeKey: string) {
    let cardURL = new URL(url(name));
    await batch.updateEntry(cardURL, {
      type: 'instance',
      resource: {
        id: rri(cardURL.href),
        type: 'card',
        attributes: { name },
        meta: {
          adoptsFrom: { module: rri(typeKey.replace(/\/[^/]+$/, '')), name },
        },
      },
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: { name },
      deps: new Set(),
      displayNames: [name],
      types: [typeKey, cardDefKey],
      isolatedHtml: `<div>${name}</div>`,
    });
  }

  async function currentGeneration(): Promise<number> {
    let [row] = (await adapter.execute(
      `SELECT current_generation FROM realm_generations WHERE realm_url = $1`,
      { bind: [testRealm] },
    )) as { current_generation: number }[];
    return Number(row?.current_generation);
  }

  async function productionGeneration(
    table: 'boxel_index' | 'prerendered_html',
    name: string,
  ): Promise<number | undefined> {
    let [row] = (await adapter.execute(
      `SELECT generation FROM ${table} WHERE url = $1 AND type = 'instance'`,
      { bind: [url(name)] },
    )) as { generation: number }[];
    return row === undefined ? undefined : Number(row.generation);
  }

  async function pendingGeneration(
    batch: Batch,
    name: string,
  ): Promise<number | undefined> {
    let [row] = (await adapter.execute(
      `SELECT generation FROM boxel_index_pending
        WHERE staging_id = $1 AND url = $2 AND type = 'instance'`,
      { bind: [batch.stagingId, url(name)] },
    )) as { generation: number }[];
    return row === undefined ? undefined : Number(row.generation);
  }

  // The type summary a reader sees: the `realm_meta` row the JOIN on
  // `realm_generations.current_generation` resolves, reduced to code-ref →
  // count.
  async function publishedTypeCounts(): Promise<Record<string, number>> {
    let rows = (await adapter.execute(
      `SELECT rm.value
         FROM realm_meta rm
         JOIN realm_generations rg
           ON rg.realm_url = rm.realm_url
          AND rg.current_generation = rm.generation
        WHERE rm.realm_url = $1`,
      { bind: [testRealm] },
    )) as {
      value: { instances: { code_ref: string; total: number }[] };
    }[];
    if (rows.length !== 1) {
      throw new Error(
        `expected the realm_meta JOIN to resolve exactly one row, got ${rows.length}`,
      );
    }
    return Object.fromEntries(
      rows[0].value.instances.map(({ code_ref, total }) => [
        code_ref,
        Number(total),
      ]),
    );
  }

  async function indexWatermarks(): Promise<Record<string, number>> {
    let rows = (await adapter.execute(
      `SELECT type_key, index_generation FROM realm_type_generations
        WHERE realm_url = $1`,
      { bind: [testRealm] },
    )) as { type_key: string; index_generation: number }[];
    return Object.fromEntries(
      rows.map((row) => [row.type_key, Number(row.index_generation)]),
    );
  }

  async function ledger() {
    let rows = (await adapter.execute(
      `SELECT generation, base_generation, urls, render_only_urls, full_realm
         FROM realm_index_commits
        WHERE realm_url = $1
        ORDER BY generation`,
      { bind: [testRealm] },
    )) as {
      generation: number;
      base_generation: number;
      urls: string[] | null;
      render_only_urls: string[] | null;
      full_realm: boolean;
    }[];
    return rows.map((row) => ({
      generation: Number(row.generation),
      baseGeneration: Number(row.base_generation),
      urls: row.urls,
      renderOnlyUrls: row.render_only_urls,
      fullRealm: row.full_realm,
    }));
  }

  test('passes that overlap take generations in the order they commit, not the order they started', async function (assert) {
    // Both passes set up against the same committed state, so both stage
    // their rows under the same provisional generation. B then commits first.
    let a = await createBatch({ splitPrerenderHtml: false });
    let b = await createBatch({ splitPrerenderHtml: false });
    assert.strictEqual(
      a.provisionalGeneration,
      b.provisionalGeneration,
      'precondition: the two passes anticipated the same generation',
    );
    await stageCard(a, 'a', personKey);
    await stageCard(b, 'b', petKey);

    await b.done();
    assert.strictEqual(b.committedGeneration, 1, 'B commits generation 1');
    assert.deepEqual(
      await publishedTypeCounts(),
      { [petKey]: 1 },
      'the summary B publishes holds only committed rows, not the card A has staged',
    );
    let watermarksAfterB = await indexWatermarks();
    assert.strictEqual(
      await pendingGeneration(a, 'a'),
      1,
      'precondition: A staged its row under the provisional generation',
    );

    await a.done();
    assert.strictEqual(
      a.committedGeneration,
      2,
      'A, committing second, takes the next generation',
    );
    assert.strictEqual(
      a.baseGeneration,
      0,
      'A reports the committed generation it was set up against',
    );
    assert.strictEqual(
      await currentGeneration(),
      2,
      'the realm generation ends at the last commit',
    );

    assert.strictEqual(
      await productionGeneration('boxel_index', 'a'),
      2,
      "A's index row is restamped with the generation A committed",
    );
    assert.strictEqual(
      await productionGeneration('prerendered_html', 'a'),
      2,
      "A's HTML row is restamped with the generation A committed",
    );
    assert.strictEqual(
      await productionGeneration('boxel_index', 'b'),
      1,
      "B's index row keeps the generation B committed",
    );

    assert.deepEqual(
      await publishedTypeCounts(),
      { [personKey]: 1, [petKey]: 1 },
      'the realm_meta JOIN resolves to a summary holding both passes’ cards',
    );

    let watermarksAfterA = await indexWatermarks();
    for (let [typeKey, generation] of Object.entries(watermarksAfterB)) {
      assert.true(
        (watermarksAfterA[typeKey] ?? 0) >= generation,
        `the ${typeKey} watermark does not move backwards (${generation} → ${watermarksAfterA[typeKey]})`,
      );
    }
    assert.strictEqual(
      watermarksAfterA[personKey],
      2,
      'the type A touched carries the generation A committed',
    );
    assert.strictEqual(
      watermarksAfterA[petKey],
      1,
      'the type only B touched keeps the generation B committed',
    );
    assert.strictEqual(
      watermarksAfterA[cardDefKey],
      2,
      'a type both touched carries the later commit',
    );

    assert.deepEqual(
      await ledger(),
      [
        {
          generation: 1,
          baseGeneration: 0,
          urls: [url('b')],
          renderOnlyUrls: [],
          fullRealm: false,
        },
        {
          generation: 2,
          baseGeneration: 0,
          urls: [url('a')],
          renderOnlyUrls: [],
          fullRealm: false,
        },
      ],
      'the ledger records one row per commit, in commit order',
    );
    let passIds = (
      (await adapter.execute(
        `SELECT pass_id FROM realm_index_commits
          WHERE realm_url = $1 ORDER BY generation`,
        { bind: [testRealm] },
      )) as { pass_id: string }[]
    ).map((row) => row.pass_id);
    assert.deepEqual(
      passIds,
      [b.passId, a.passId],
      "each ledger row names the pass that committed it, by that batch's pass id",
    );
    assert.notStrictEqual(
      a.passId,
      b.passId,
      'every batch mints its own pass id',
    );
  });

  test('a commit over a card a peer moved to another type recomputes the type the peer moved it into', async function (assert) {
    let seed = await createBatch({ splitPrerenderHtml: false });
    await stageCard(seed, 'x', personKey);
    await seed.done();
    assert.deepEqual(
      await publishedTypeCounts(),
      { [personKey]: 1 },
      'precondition: x is published as a Person',
    );

    // Both passes invalidate x while it is still a Person, so each reads
    // Person as the type x is leaving. A then moves x to Pet and commits; B
    // moves it back to Person and commits after.
    let a = await createBatch({ splitPrerenderHtml: false });
    let b = await createBatch({ splitPrerenderHtml: false });
    await b.invalidate([new URL(url('x'))]);
    await stageCard(a, 'x', petKey);
    await a.done();
    assert.deepEqual(
      await publishedTypeCounts(),
      { [petKey]: 1 },
      'precondition: after A, x is published as a Pet',
    );

    await writeCard(b, 'x', personKey);
    await b.done();
    assert.strictEqual(b.committedGeneration, 3, 'B commits after A');
    assert.deepEqual(
      await publishedTypeCounts(),
      { [personKey]: 1 },
      'the summary no longer counts x as the Pet A had made it',
    );
    assert.strictEqual(
      (await indexWatermarks())[petKey],
      3,
      'the Pet watermark moves with B, whose commit took x out of Pet',
    );
  });

  test('a commit waits for a peer commit of the same realm, and takes the generation after it', async function (assert) {
    assert.timeout(60_000);
    let sleepSeconds = 2;
    let a = await createBatch();
    let b = await createBatch();
    await stageCard(a, 'a', personKey);
    await stageCard(b, 'b', petKey);

    await adapter.execute(`
      CREATE OR REPLACE FUNCTION ${SLOW_STAMP_FUNCTION}() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${SLOW_STAMP_LOCK_KEY});
        PERFORM pg_sleep(${sleepSeconds});
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await adapter.execute(`
      CREATE TRIGGER ${SLOW_STAMP_TRIGGER}
      BEFORE INSERT OR UPDATE ON realm_type_generations
      FOR EACH STATEMENT
      EXECUTE FUNCTION ${SLOW_STAMP_FUNCTION}();
    `);
    try {
      let bDone = b.done();
      await waitUntil(
        async () => {
          let [row] = (await adapter.execute(
            `SELECT count(*)::int AS n FROM pg_locks
               WHERE locktype = 'advisory' AND granted AND objid = $1`,
            { bind: [SLOW_STAMP_LOCK_KEY] },
          )) as { n: number }[];
          return (row?.n ?? 0) > 0;
        },
        {
          timeout: 30_000,
          interval: 25,
          timeoutMessage: "B's swap never reached its type-watermark stamps",
        },
      );

      let aResult = await a.done();
      await bDone;

      assert.deepEqual(
        [b.committedGeneration, a.committedGeneration],
        [1, 2],
        'the passes commit under distinct, consecutive generations',
      );
      assert.true(
        (aResult.commitLockWaitMs ?? 0) >= (sleepSeconds * 1000) / 2,
        `A waited for B's commit to finish before allocating its own (commitLockWaitMs=${aResult.commitLockWaitMs})`,
      );
      assert.strictEqual(
        await currentGeneration(),
        2,
        'the realm generation counts both commits',
      );
    } finally {
      await adapter.execute(
        `DROP TRIGGER IF EXISTS ${SLOW_STAMP_TRIGGER} ON realm_type_generations`,
      );
      await adapter.execute(`DROP FUNCTION IF EXISTS ${SLOW_STAMP_FUNCTION}()`);
    }
  });
});
