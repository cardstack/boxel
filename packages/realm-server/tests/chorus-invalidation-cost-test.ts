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

// What an incremental pass spends finding the cards an edit reaches, in a
// realm shaped like Chorus (the computed-only social network): Posts; a
// Profile per Person linking its Person and Posts; one Analytics card linking
// every Profile; a SocialHome linking its viewer, their Profile, the
// Analytics card and a Feed. Every card adopts from `social` and links the
// Chorus theme. Rows carry the dependencies the indexer records for those
// links, at `CHORUS_PEOPLE` people (default 400, about 2,600 posts). The
// edits measured are the ones Chorus makes: a reaction on a post, a person
// edit, a theme edit and a definition edit. Each result is checked against
// the closure computed here from the same graph; with
// `INVALIDATION_COST_LOG=1` each reports its statements and wall time.
module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let indexWriter: IndexWriter;
  let virtualNetwork: VirtualNetwork;
  let people = Number(process.env.CHORUS_PEOPLE ?? 400);
  let cards: Card[];

  interface Card {
    path: string;
    deps: string[];
  }

  hooks.before(function () {
    cards = chorus(people);
  });

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    indexWriter = new IndexWriter(adapter);
    virtualNetwork = new VirtualNetwork();
    virtualNetwork.addRealmMapping(
      '@cardstack/base/',
      'http://localhost:4201/base/',
    );
    await seed(cards);
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  // A deterministic Chorus: each person writes 3–10 posts.
  function chorus(count: number): Card[] {
    let state = 20261103;
    let random = () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    let at = (path: string) => `${testRealm}${path}`;
    // Real cards also record every module and stylesheet their render
    // loaded, most of them shared across a realm: dev realms average 33-112
    // dependencies a row. `CHORUS_DEPS_PER_CARD` pads each card to about that
    // many with shared module dependencies, since a row's GIN maintenance
    // grows with how many keys it holds.
    let padding = Array.from(
      {
        length: Math.max(0, Number(process.env.CHORUS_DEPS_PER_CARD ?? 0) - 4),
      },
      (_, i) => at(`kit/module-${i}`),
    );
    let shared = [
      at('social'),
      at('social-kit'),
      at('Theme/chorus.json'),
      '@cardstack/base/card-api',
      ...padding,
    ];
    let result: Card[] = [
      { path: 'Theme/chorus.json', deps: ['@cardstack/base/card-api'] },
    ];
    let profiles: string[] = [];
    let post = 0;
    for (let i = 0; i < count; i++) {
      let person = `Person/p${i}.json`;
      result.push({ path: person, deps: shared });
      let posts: string[] = [];
      let written = 3 + Math.floor(random() * 8);
      for (let j = 0; j < written; j++) {
        let path = `Post/p${post++}.json`;
        posts.push(path);
        result.push({ path, deps: shared });
      }
      let profile = `Profile/p${i}.json`;
      profiles.push(profile);
      result.push({
        path: profile,
        deps: [...shared, at(person), ...posts.map(at)],
      });
    }
    result.push({
      path: 'Analytics/network.json',
      deps: [...shared, ...profiles.map(at)],
    });
    result.push({
      path: 'Feed/p0.json',
      deps: [...shared, at('Person/p0.json')],
    });
    result.push({
      path: 'SocialHome/home.json',
      deps: [
        ...shared,
        at('Person/p0.json'),
        at('Profile/p0.json'),
        at('Analytics/network.json'),
        at('Feed/p0.json'),
      ],
    });
    return result;
  }

  // Every card that depends on `changed`, transitively, and `changed`
  // itself: an instance is followed by its URL, a module by its alias.
  function expectedClosure(changed: string): Set<string> {
    let dependents = new Map<string, string[]>();
    for (let { path, deps } of cards) {
      for (let dep of deps) {
        let list = dependents.get(dep) ?? [];
        list.push(`${testRealm}${path}`);
        dependents.set(dep, list);
      }
    }
    let start = `${testRealm}${changed}`;
    let reached = new Set([start]);
    let frontier = [start.replace(/\.gts$/, '')];
    let seen = new Set(frontier);
    while (frontier.length > 0) {
      let next: string[] = [];
      for (let node of frontier) {
        for (let url of dependents.get(node) ?? []) {
          reached.add(url);
          if (!seen.has(url)) {
            seen.add(url);
            next.push(url);
          }
        }
      }
      frontier = next;
    }
    return reached;
  }

  // One row through the writer, as a template, then one statement per table
  // that replaces it with a copy per card, each with its own URL and
  // dependencies, in both channels. The tables are analyzed afterwards, as
  // production's are.
  async function seed(entries: Card[]) {
    await applyGinSettings();
    let batch = await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let template = new URL('template.json', testRealm);
    await batch.invalidate([template]);
    await batch.updateEntry(template, {
      type: 'instance',
      resource: {
        id: rri(template.href),
        type: 'card',
        attributes: {},
        meta: {
          adoptsFrom: { module: rri(`${testRealm}social`), name: 'Post' },
        },
      },
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: {},
      deps: new Set(),
      displayNames: ['Post'],
      types: [`${testRealm}social/Post`],
      isolatedHtml: '<div></div>',
    });
    await batch.done();
    let rows = JSON.stringify(
      entries.map(({ path, deps }) => [
        `${testRealm}${path}`,
        `${testRealm}${path.replace(/\.json$/, '')}`,
        deps,
      ]),
    );
    for (let table of ['boxel_index', 'prerendered_html']) {
      await adapter.execute(
        `WITH t AS (DELETE FROM ${table} WHERE url = $1 RETURNING *)
         INSERT INTO ${table}
         SELECT (jsonb_populate_record(NULL::${table}, to_jsonb(t) || jsonb_build_object(
           'url', r->>0, 'file_alias', r->>1, 'deps', r->2))).*
         FROM t, jsonb_array_elements($2::jsonb) AS r`,
        { bind: [template.href, rows] },
      );
      await adapter.execute(`ANALYZE ${table}`);
    }
  }

  // The GIN setting the run measures, applied before the rows are written so
  // the pending lists hold what that setting leaves in them: the migration's
  // 256 kB limit by default, `INVALIDATION_COST_GIN_DEFAULTS` for GIN's
  // defaults, `INVALIDATION_COST_FASTUPDATE_OFF` for no pending list.
  async function applyGinSettings() {
    let gin = (
      (await adapter.execute(
        `SELECT indexname FROM pg_indexes WHERE indexdef ILIKE '%USING gin%'`,
      )) as { indexname: string }[]
    ).map(({ indexname }) => indexname);
    for (let index of gin) {
      await adapter.execute(
        `ALTER INDEX ${index} RESET (gin_pending_list_limit, fastupdate)`,
      );
      if (process.env.INVALIDATION_COST_FASTUPDATE_OFF) {
        await adapter.execute(`ALTER INDEX ${index} SET (fastupdate = off)`);
      } else if (!process.env.INVALIDATION_COST_GIN_DEFAULTS) {
        await adapter.execute(
          `ALTER INDEX ${index} SET (gin_pending_list_limit = 256)`,
        );
      }
    }
  }

  async function measure(label: string, changed: string, split: boolean) {
    let batch = await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: split },
    );
    let execute = adapter.execute.bind(adapter);
    let statements = 0;
    let rttMs = Number(process.env.INVALIDATION_COST_RTT_MS ?? 0);
    let slowest: string[] = [];
    adapter.execute = (async (...args: Parameters<PgAdapter['execute']>) => {
      statements++;
      if (rttMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, rttMs));
      }
      let begun = process.hrtime.bigint();
      try {
        return await execute(...args);
      } finally {
        let took = Number(process.hrtime.bigint() - begun) / 1e6;
        if (took > 20) {
          slowest.push(
            `${took.toFixed(0)}ms ${String(args[0]).replace(/\s+/g, ' ').slice(0, 80)}`,
          );
        }
      }
    }) as PgAdapter['execute'];
    let start = process.hrtime.bigint();
    try {
      await batch.invalidate([new URL(changed, testRealm)]);
    } finally {
      adapter.execute = execute;
    }
    let ms = Number(process.hrtime.bigint() - start) / 1e6;
    let reached = new Set([
      ...batch.invalidations,
      ...batch.renderOnlyInvalidations,
    ]);
    if (process.env.INVALIDATION_COST_LOG) {
      console.log(
        `invalidation-cost chorus-${people} ${label} split=${split} reached=${reached.size} statements=${statements} ms=${ms.toFixed(1)}${rttMs ? ` rtt=${rttMs}` : ''}${slowest.length ? `\n  ${slowest.join('\n  ')}` : ''}`,
      );
    }
    return { reached, statements };
  }

  for (let [label, changed] of [
    ['post-reaction', 'Post/p7.json'],
    ['person-edit', 'Person/p0.json'],
    ['theme-edit', 'Theme/chorus.json'],
    ['definition-edit', 'social.gts'],
  ] as const) {
    test(`a ${label} reaches exactly its dependents`, async function (assert) {
      if (process.env.CHORUS_FULL_PASS) {
        assert.timeout(30 * 60 * 1000);
      }
      let expected = expectedClosure(changed);
      for (let split of [false, true]) {
        let { reached, statements } = await measure(label, changed, split);
        // Both walks reach the same cards; the count shows which one ran.
        assert.ok(
          statements <= 15,
          `split=${split}: one query (${statements} statements)`,
        );
        assert.strictEqual(
          reached.size,
          expected.size,
          `split=${split}: ${expected.size} cards`,
        );
        let missing = [...expected].filter((url) => !reached.has(url));
        let extra = [...reached].filter((url) => !expected.has(url));
        assert.deepEqual(
          { missing: missing.slice(0, 5), extra: extra.slice(0, 5) },
          { missing: [], extra: [] },
          `split=${split}: the same cards`,
        );
      }
    });
  }

  // The whole pass a theme edit costs, walk and commit, for comparing GIN
  // settings: the walk, then every card it reached staged again as a visit
  // would stage it, then the commit's swap, timed per table, with the WAL it
  // wrote. Opt-in (`CHORUS_FULL_PASS=1`), since it is a measurement rather than
  // a check. The pending list's size before the walk is reported beside the
  // walk, since that is what a probe has to scan.
  if (process.env.CHORUS_FULL_PASS) {
    for (let [edit, changed] of [
      ['theme edit', 'Theme/chorus.json'],
      ['post edit', 'Post/p7.json'],
    ] as const) {
      test(`a ${edit}, walk and commit`, async function (assert) {
        // At GIN's default pending list the walk alone can run for minutes.
        assert.timeout(30 * 60 * 1000);
        await adapter.execute(`CREATE EXTENSION IF NOT EXISTS pgstattuple`);
        let pending = (await adapter.execute(
          `SELECT 'boxel_index_deps_index' AS index, * FROM pgstatginindex('boxel_index_deps_index')
         UNION ALL SELECT 'prerendered_html_deps_index', * FROM pgstatginindex('prerendered_html_deps_index')`,
        )) as {
          index: string;
          pending_pages: number;
          pending_tuples: string;
        }[];
        let batch = await indexWriter.createBatch(
          new URL(testRealm),
          virtualNetwork,
          undefined,
          { splitPrerenderHtml: false },
        );
        let walkStart = process.hrtime.bigint();
        await batch.invalidate([new URL(changed, testRealm)]);
        let walkMs = Number(process.hrtime.bigint() - walkStart) / 1e6;
        let urls = JSON.stringify(batch.invalidations);
        for (let [table, constraint] of [
          ['boxel_index', 'boxel_index_pending_pkey'],
          ['prerendered_html', 'prerendered_html_pending_pkey'],
        ]) {
          let columns = (
            (await adapter.execute(
              `SELECT column_name FROM information_schema.columns WHERE table_name = $1
             AND column_name IN (SELECT column_name FROM information_schema.columns WHERE table_name = $2)
             ORDER BY ordinal_position`,
              { bind: [table, `${table}_pending`] },
            )) as { column_name: string }[]
          ).map(({ column_name }) => column_name);
          await adapter.execute(
            `INSERT INTO ${table}_pending (${columns.join(', ')}, staging_id)
           SELECT ${columns.join(', ')}, $1 FROM ${table}
           WHERE realm_url = $2 AND url IN (SELECT jsonb_array_elements_text($3::jsonb))
           ON CONFLICT ON CONSTRAINT ${constraint} DO UPDATE SET
           ${columns.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`,
            { bind: [batch.stagingId, testRealm, urls] },
          );
        }
        let perTable = { boxel_index: 0, prerendered_html: 0, other: 0 };
        let withTransaction = adapter.withTransaction.bind(adapter);
        adapter.withTransaction = (async (fn: any, opts: any) =>
          await withTransaction(
            async (query: any) =>
              await fn(async (expression: any, ...rest: any[]) => {
                let begun = process.hrtime.bigint();
                try {
                  return await query(expression, ...rest);
                } finally {
                  let took = Number(process.hrtime.bigint() - begun) / 1e6;
                  let text = (Array.isArray(expression) ? expression : [])
                    .filter((part: unknown) => typeof part === 'string')
                    .join(' ');
                  let target =
                    /(INSERT INTO|UPDATE|DELETE FROM)\s+(boxel_index|prerendered_html)\b(?!_)/.exec(
                      text,
                    )?.[2] as 'boxel_index' | 'prerendered_html' | undefined;
                  perTable[target ?? 'other'] += took;
                }
              }),
            opts,
          )) as typeof adapter.withTransaction;
        let [{ lsn: walBefore }] = (await adapter.execute(
          `SELECT pg_current_wal_lsn()::text AS lsn`,
        )) as { lsn: string }[];
        let doneStart = process.hrtime.bigint();
        try {
          await batch.done();
        } finally {
          adapter.withTransaction = withTransaction;
        }
        let doneMs = Number(process.hrtime.bigint() - doneStart) / 1e6;
        let [{ bytes }] = (await adapter.execute(
          `SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1::pg_lsn)::bigint AS bytes`,
          { bind: [walBefore] },
        )) as { bytes: string }[];
        let setting = process.env.INVALIDATION_COST_FASTUPDATE_OFF
          ? 'fastupdate-off'
          : process.env.INVALIDATION_COST_GIN_DEFAULTS
            ? 'gin-defaults'
            : 'pending-256kB';
        console.log(
          `chorus-full-pass edit=${edit.replace(' ', '-')} people=${people} deps-per-card=${process.env.CHORUS_DEPS_PER_CARD ?? 'about 5'} setting=${setting} reached=${batch.invalidations.length} ` +
            `walk=${walkMs.toFixed(0)}ms done=${doneMs.toFixed(0)}ms ` +
            `boxel_index-swap=${perTable.boxel_index.toFixed(0)}ms prerendered_html-swap=${perTable.prerendered_html.toFixed(0)}ms ` +
            `other-in-commit=${perTable.other.toFixed(0)}ms wal=${(Number(bytes) / 1e6).toFixed(1)}MB ` +
            `pending-before-walk=${pending.map((p) => `${p.index}:${p.pending_pages}pages/${p.pending_tuples}tuples`).join(',')}`,
        );
        assert.ok(batch.invalidations.length > 0);
      });
    }
  }
});
