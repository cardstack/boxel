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
    let shared = [
      at('social'),
      at('social-kit'),
      at('Theme/chorus.json'),
      '@cardstack/base/card-api',
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
});
