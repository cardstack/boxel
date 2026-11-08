import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { IndexWriter, VirtualNetwork, rri } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// What an incremental pass spends finding the cards a change reaches, on
// graphs shaped like the ones that make it expensive: a module many cards
// adopt from, a hub that cards link to through intermediate cards, and a long
// chain. Each test checks the invalidation set exactly, and reports the SQL
// statements and wall time the walk took (`INVALIDATION_COST_LOG=1`), so a
// change to the walk can be compared against the one before it.
module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let indexWriter: IndexWriter;
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    indexWriter = new IndexWriter(adapter);
    virtualNetwork = new VirtualNetwork();
    virtualNetwork.addRealmMapping(
      '@cardstack/base/',
      'http://localhost:4201/base/',
    );
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  // Writes one instance row per entry, each depending on `deps`.
  async function seed(entries: { path: string; deps: string[] }[]) {
    let batch = await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await batch.invalidate(entries.map(({ path }) => new URL(path, testRealm)));
    for (let { path, deps } of entries) {
      let url = new URL(path, testRealm);
      await batch.updateEntry(url, {
        type: 'instance',
        resource: {
          id: rri(url.href),
          type: 'card',
          attributes: { name: path },
          meta: {
            adoptsFrom: { module: rri(`${testRealm}card`), name: 'Card' },
          },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData: { name: path },
        deps: new Set(deps.map((dep) => new URL(dep, testRealm).href)),
        displayNames: ['Card'],
        types: [`${testRealm}card/Card`],
        isolatedHtml: `<div>${path}</div>`,
      });
    }
    await batch.done();
    await neighbours(entries[0].path);
  }

  // The index tables hold every realm's rows, and production has planner
  // statistics for them. Copies of one seeded row fill both tables with
  // 20,000 cards of other realms, each depending on cards of its own, and
  // the tables are analyzed, so the walk is measured against the plans it
  // would get there rather than those of a near-empty table.
  //
  // Two conditions, chosen by environment. By default the neighbours have
  // just been written, as under a write stream; with
  // `INVALIDATION_COST_VACUUMED` the GIN pending lists are flushed first, as
  // after a VACUUM. `INVALIDATION_COST_GIN_DEFAULTS` restores GIN's default
  // pending list first, so the walk can be measured against it, and
  // `INVALIDATION_COST_FASTUPDATE_OFF` turns `fastupdate` off instead, the
  // alternative to a small pending list.
  async function neighbours(templatePath: string) {
    let template = new URL(templatePath, testRealm).href;
    let gin = (
      (await adapter.execute(
        `SELECT indexname FROM pg_indexes WHERE indexdef ILIKE '%USING gin%'`,
      )) as { indexname: string }[]
    ).map(({ indexname }) => indexname);
    for (let index of gin) {
      if (process.env.INVALIDATION_COST_GIN_DEFAULTS) {
        await adapter.execute(
          `ALTER INDEX ${index} RESET (gin_pending_list_limit, fastupdate)`,
        );
      } else if (process.env.INVALIDATION_COST_FASTUPDATE_OFF) {
        await adapter.execute(
          `ALTER INDEX ${index} RESET (gin_pending_list_limit)`,
        );
        await adapter.execute(`ALTER INDEX ${index} SET (fastupdate = off)`);
      } else {
        // What the migration sets, whatever the database was seeded with.
        await adapter.execute(`ALTER INDEX ${index} RESET (fastupdate)`);
        await adapter.execute(
          `ALTER INDEX ${index} SET (gin_pending_list_limit = 256)`,
        );
      }
    }
    for (let table of ['boxel_index', 'prerendered_html']) {
      await adapter.execute(
        `INSERT INTO ${table}
         SELECT (jsonb_populate_record(NULL::${table}, to_jsonb(t) || jsonb_build_object(
           'url', 'http://neighbour-' || (g % 40) || '.test/' || g || '.json',
           'file_alias', 'http://neighbour-' || (g % 40) || '.test/' || g,
           'realm_url', 'http://neighbour-' || (g % 40) || '.test/',
           'deps', jsonb_build_array('http://neighbour-' || (g % 40) || '.test/' || (g % 97) || '.json',
                                     'http://neighbour-' || (g % 40) || '.test/card')))).*
         FROM ${table} t, generate_series(1, 20000) g
         WHERE t.url = $1 AND t.type = 'instance'`,
        { bind: [template] },
      );
      await adapter.execute(`ANALYZE ${table}`);
    }
    if (process.env.INVALIDATION_COST_VACUUMED) {
      for (let index of gin) {
        await adapter.execute(`SELECT gin_clean_pending_list('${index}')`);
      }
    }
  }

  // Invalidates `changed` in a fresh pass and returns what the pass reached,
  // with the statements and time the walk cost.
  async function measure(
    label: string,
    changed: string | string[],
    splitPrerenderHtml: boolean,
  ) {
    let batch = await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml },
    );
    let execute = adapter.execute.bind(adapter);
    let statements = 0;
    let slowest: string[] = [];
    adapter.execute = (async (...args: Parameters<PgAdapter['execute']>) => {
      statements++;
      let begun = process.hrtime.bigint();
      try {
        return await execute(...args);
      } finally {
        let took = Number(process.hrtime.bigint() - begun) / 1e6;
        if (took > 2) {
          slowest.push(
            `${took.toFixed(1)}ms ${String(args[0]).replace(/\s+/g, ' ').slice(0, 90)}`,
          );
        }
      }
    }) as PgAdapter['execute'];
    let start = process.hrtime.bigint();
    let reached: string[];
    try {
      await batch.invalidate(
        (Array.isArray(changed) ? changed : [changed]).map(
          (path) => new URL(path, testRealm),
        ),
      );
      reached = [...batch.invalidations, ...batch.renderOnlyInvalidations];
    } finally {
      adapter.execute = execute;
    }
    let ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (process.env.INVALIDATION_COST_LOG) {
      console.log(
        `invalidation-cost ${label} split=${splitPrerenderHtml} reached=${reached.length} statements=${statements} ms=${ms.toFixed(1)}\n  ${slowest.join('\n  ')}`,
      );
    }
    return {
      reached: new Set(reached.map((url) => url.slice(testRealm.length))),
      statements,
    };
  }

  // The one-query walk takes a handful of statements whatever it reaches; the
  // node-by-node walk takes several per card. Bounding the count is what shows
  // a realm with no registered prefix took the one-query path, since both
  // walks reach the same cards.
  const ONE_QUERY_STATEMENTS = 15;

  test('a module that 600 cards adopt from', async function (assert) {
    let cards = Array.from({ length: 600 }, (_, i) => ({
      path: `cards/${i}.json`,
      deps: ['card'],
    }));
    await seed(cards);
    for (let split of [false, true]) {
      let { reached, statements } = await measure(
        'module-fan',
        'card.gts',
        split,
      );
      assert.strictEqual(reached.size, 601, `split=${split}: module and cards`);
      assert.ok(reached.has('cards/599.json'));
      assert.ok(
        statements <= ONE_QUERY_STATEMENTS,
        `split=${split}: one query (${statements} statements)`,
      );
    }
  });

  // A from-scratch pass over an existing index, and a commit's validation
  // round, invalidate every changed file in one call, so the walk starts from
  // a realm-sized seed list rather than from one URL.
  test('a module and the 600 cards that adopt from it, invalidated together', async function (assert) {
    let cards = Array.from({ length: 600 }, (_, i) => ({
      path: `cards/${i}.json`,
      deps: ['card'],
    }));
    await seed(cards);
    for (let split of [false, true]) {
      let { reached, statements } = await measure(
        'many-seeds',
        ['card.gts', ...cards.map(({ path }) => path)],
        split,
      );
      assert.strictEqual(reached.size, 601, `split=${split}: module and cards`);
      assert.ok(
        statements <= ONE_QUERY_STATEMENTS,
        `split=${split}: one query (${statements} statements)`,
      );
    }
  });

  test('a hub linked through 30 cards by 600 more', async function (assert) {
    let entries = [{ path: 'hub.json', deps: [] as string[] }];
    for (let i = 0; i < 30; i++) {
      entries.push({ path: `mid/${i}.json`, deps: ['hub.json'] });
      for (let j = 0; j < 20; j++) {
        entries.push({ path: `leaf/${i}-${j}.json`, deps: [`mid/${i}.json`] });
      }
    }
    await seed(entries);
    for (let split of [false, true]) {
      let { reached, statements } = await measure(
        'link-tree',
        'hub.json',
        split,
      );
      assert.ok(
        statements <= ONE_QUERY_STATEMENTS,
        `split=${split}: one query (${statements} statements)`,
      );
      assert.strictEqual(
        reached.size,
        631,
        `split=${split}: hub, mids, leaves`,
      );
      assert.ok(reached.has('leaf/29-19.json'));
    }
  });

  test('a chain 80 cards long', async function (assert) {
    let entries = Array.from({ length: 80 }, (_, i) => ({
      path: `chain/${i}.json`,
      deps: i === 0 ? [] : [`chain/${i - 1}.json`],
    }));
    await seed(entries);
    for (let split of [false, true]) {
      let { reached, statements } = await measure(
        'chain',
        'chain/0.json',
        split,
      );
      assert.strictEqual(reached.size, 80, `split=${split}: the whole chain`);
      assert.ok(
        statements <= ONE_QUERY_STATEMENTS,
        `split=${split}: one query (${statements} statements)`,
      );
    }
  });

  test('without dependents, a hub reaches only itself', async function (assert) {
    let entries = [{ path: 'hub.json', deps: [] as string[] }];
    for (let i = 0; i < 30; i++) {
      entries.push({ path: `mid/${i}.json`, deps: ['hub.json'] });
      for (let j = 0; j < 20; j++) {
        entries.push({ path: `leaf/${i}-${j}.json`, deps: [`mid/${i}.json`] });
      }
    }
    await seed(entries);
    for (let splitPrerenderHtml of [false, true]) {
      let batch = await indexWriter.createBatch(
        new URL(testRealm),
        virtualNetwork,
        undefined,
        { splitPrerenderHtml },
      );
      await batch.invalidate([new URL('hub.json', testRealm)], {
        withoutDependents: true,
      });
      assert.deepEqual(
        batch.invalidations.map((u) => u.replace(testRealm, '')),
        ['hub.json'],
        `split=${splitPrerenderHtml}: only the hub is visited`,
      );
      assert.deepEqual(
        [...batch.renderOnlyInvalidations],
        [],
        `split=${splitPrerenderHtml}: nothing is stamped or re-rendered`,
      );
    }
  });

  test('an edit nothing depends on', async function (assert) {
    await seed([
      { path: 'lonely.json', deps: [] },
      { path: 'other.json', deps: ['card'] },
    ]);
    for (let split of [false, true]) {
      let { reached } = await measure('leaf-edit', 'lonely.json', split);
      assert.deepEqual([...reached], ['lonely.json'], `split=${split}`);
    }
  });

  // A realm named by a registered prefix stores its dependencies in prefix
  // form, which only the virtual network can spell, so its walk goes node by
  // node and must still reach every dependent.
  test('a realm named by a prefix reaches its prefix-form dependents', async function (assert) {
    virtualNetwork.addRealmMapping('@fanout-test/realm/', testRealm);
    let entries = [{ path: 'hub.json', deps: [] as string[] }];
    for (let i = 0; i < 5; i++) {
      entries.push({ path: `mid/${i}.json`, deps: ['hub.json'] });
      for (let j = 0; j < 4; j++) {
        entries.push({ path: `leaf/${i}-${j}.json`, deps: [`mid/${i}.json`] });
      }
    }
    await seed(entries);
    let [stored] = (await adapter.execute(
      `SELECT deps FROM boxel_index WHERE url = $1`,
      { bind: [`${testRealm}mid/0.json`] },
    )) as { deps: string[] }[];
    assert.deepEqual(
      stored?.deps,
      ['@fanout-test/realm/hub.json'],
      'the dependency is stored in prefix form',
    );
    for (let split of [false, true]) {
      let { reached, statements } = await measure(
        'prefixed-realm',
        'hub.json',
        split,
      );
      assert.strictEqual(reached.size, 26, `split=${split}: hub, mids, leaves`);
      assert.ok(
        statements > ONE_QUERY_STATEMENTS,
        `split=${split}: node by node (${statements} statements)`,
      );
    }
  });
});
