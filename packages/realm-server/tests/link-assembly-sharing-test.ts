import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { LinkAssemblyCache, rri } from '@cardstack/runtime-common';
import type {
  CardResource,
  DBAdapter,
  FileMetaResource,
  LooseSingleCardDocument,
  Realm,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

const testRealm = new URL('http://127.0.0.1:4460/test/');
// Two disjoint sets of source cards linking to the same targets: the shape a
// dashboard render has, where many searches over different types reach one
// pool of staff, students and settings cards.
const SOURCES_PER_GROUP = 4;
const NUM_TARGETS = 3;

let testDbAdapter: DBAdapter;
// Held by the test rather than defaulted by the helper, so the assertions can
// read the cache's own account of what it spared.
let assemblyCache = new LinkAssemblyCache({ telemetryIntervalMs: 0 });

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['detail.gts'] = `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Detail extends CardDef {
      @field note = contains(StringField);
    }
  `;

  // A second layer below each target, so the assertions cover the closure
  // BEHIND a shared card and not just the card itself.
  fs['target.gts'] = `
    import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Detail } from "./detail";

    export class Target extends CardDef {
      @field name = contains(StringField);
      @field detail = linksTo(() => Detail);
    }
  `;

  fs['source.gts'] = `
    import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Target } from "./target";

    export class Source extends CardDef {
      @field name = contains(StringField);
      @field group = contains(StringField);
      @field link0 = linksTo(() => Target);
      @field link1 = linksTo(() => Target);
      @field link2 = linksTo(() => Target);
    }
  `;

  fs['detail-0.json'] = {
    data: {
      attributes: { note: 'shared detail' },
      meta: { adoptsFrom: { module: rri('./detail'), name: 'Detail' } },
    },
  } as LooseSingleCardDocument;

  for (let i = 0; i < NUM_TARGETS; i++) {
    fs[`target-${i}.json`] = {
      data: {
        attributes: { name: `Target ${i}` },
        relationships: { detail: { links: { self: './detail-0' } } },
        meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
      },
    } as LooseSingleCardDocument;
  }

  for (let group of ['a', 'b']) {
    for (let i = 0; i < SOURCES_PER_GROUP; i++) {
      let relationships: Record<string, { links: { self: string } }> = {};
      for (let j = 0; j < NUM_TARGETS; j++) {
        relationships[`link${j}`] = { links: { self: `./target-${j}` } };
      }
      fs[`source-${group}-${i}.json`] = {
        data: {
          attributes: { name: `Source ${group}${i}`, group },
          relationships,
          meta: { adoptsFrom: { module: rri('./source'), name: 'Source' } },
        },
      } as LooseSingleCardDocument;
    }
  }

  return fs;
}

function groupQuery(group: string) {
  return {
    filter: {
      on: { module: rri(`${testRealm}source`), name: 'Source' },
      eq: { group },
    },
  };
}

// Every resource the assembled targets + their details amount to: the targets
// themselves and the one detail they all link to.
const EXPECTED_CLOSURE_SIZE = NUM_TARGETS + 1;

function identities(resources: (CardResource | FileMetaResource)[]): string[] {
  return resources.map((r) => `${r.type}:${r.id}`).sort();
}

function canonical(resources: (CardResource | FileMetaResource)[]) {
  return [...resources]
    .sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`))
    .map((r) => JSON.stringify(r));
}

// Every id a document's own results name through a relationship must be
// resolvable inside that same document — this is the property sharing
// assembly must not trade away. A search that reads a target out of a cache
// another search populated still has to carry that target in its OWN
// `included[]`; a consumer holds one document and cannot see the other.
function danglingRelationshipIds(result: {
  data: (CardResource | FileMetaResource)[];
  included: (CardResource | FileMetaResource)[];
}): string[] {
  let present = new Set(
    [...result.data, ...result.included].map((r) => `${r.type}:${r.id}`),
  );
  let dangling: string[] = [];
  for (let resource of [...result.data, ...result.included]) {
    for (let relationship of Object.values(resource.relationships ?? {})) {
      let data = (
        relationship as { data?: { type: string; id: string } | null } | null
      )?.data;
      if (!data) {
        continue;
      }
      let identity = `${data.type}:${data.id}`;
      if (!present.has(identity)) {
        dangling.push(identity);
      }
    }
  }
  return dangling;
}

module(basename(import.meta.filename), function () {
  module('link assembly sharing', function (hooks) {
    let realm: Realm;

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: testRealm,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      linkAssemblyCache: assemblyCache,
      onRealmSetup({ dbAdapter, testRealm: r }) {
        testDbAdapter = dbAdapter;
        realm = r;
      },
    });

    // Counts the batched row hydrations that reach the link targets — the
    // read the cache exists to skip. Told apart from the freshness pre-read by
    // its `SELECT i.*`, which pulls the pristine doc, the search doc and every
    // prerendered format; the pre-read selects neither.
    async function countingLinkHydrations<T>(
      body: (readHydrations: () => number) => Promise<T>,
    ): Promise<T> {
      let originalExecute = testDbAdapter.execute.bind(testDbAdapter);
      let dbExecute = testDbAdapter as {
        execute: typeof testDbAdapter.execute;
      };
      let targetPrefix = `${testRealm.href}target-`;
      let detailPrefix = `${testRealm.href}detail-`;
      let hydrations = 0;
      dbExecute.execute = async (sql, opts) => {
        let bind = opts?.bind ?? [];
        let normalized = sql.replace(/\s+/g, ' ');
        if (
          /FROM boxel_index\b/.test(normalized) &&
          /SELECT i\.\*/.test(normalized) &&
          bind.some(
            (v) =>
              typeof v === 'string' &&
              (v.startsWith(targetPrefix) || v.startsWith(detailPrefix)),
          )
        ) {
          hydrations++;
        }
        return originalExecute(sql, opts);
      };
      try {
        return await body(() => hydrations);
      } finally {
        dbExecute.execute = originalExecute;
      }
    }

    // Each test warms or rotates for itself rather than relying on arriving at
    // a cold cache: the realm — and so the cache it holds — is built once for
    // the module, and QUnit is free to reorder.
    test('a target two searches both reach is assembled once, and both documents still carry it', async function (assert) {
      let groupA = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        groupQuery('a'),
        { loadLinks: true },
      );
      assert.strictEqual(
        groupA.data.length,
        SOURCES_PER_GROUP,
        'the first search returned its own group',
      );
      assert.strictEqual(
        groupA.included.length,
        EXPECTED_CLOSURE_SIZE,
        `and assembled the whole closure behind it — ${EXPECTED_CLOSURE_SIZE} resources`,
      );

      let before = { ...assemblyCache.stats };
      let groupB = await countingLinkHydrations(async (readHydrations) => {
        let result = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          groupQuery('b'),
          { loadLinks: true },
        );
        assert.strictEqual(
          readHydrations(),
          0,
          `the second search hydrated no linked row, got ${readHydrations()}`,
        );
        return result;
      });
      let after = assemblyCache.stats;

      assert.strictEqual(
        groupB.data.length,
        SOURCES_PER_GROUP,
        'the second search returned its own group',
      );
      assert.strictEqual(
        after.misses - before.misses,
        0,
        `the second search assembled nothing new, got ${
          after.misses - before.misses
        }`,
      );
      assert.strictEqual(
        after.hits - before.hits,
        EXPECTED_CLOSURE_SIZE,
        `it reused all ${EXPECTED_CLOSURE_SIZE} assemblies, got ${
          after.hits - before.hits
        }`,
      );

      // …and is nonetheless a complete document on its own. Sharing assembly
      // must not become sharing responses.
      assert.deepEqual(
        identities(groupB.included),
        identities(groupA.included),
        'the second document carries the same linked resources as the first',
      );
      assert.deepEqual(
        canonical(groupB.included),
        canonical(groupA.included),
        'and carries them with identical content',
      );
      assert.deepEqual(
        groupB.included.map((r) => `${r.type}:${r.id}`),
        groupA.included.map((r) => `${r.type}:${r.id}`),
        'and in the same order',
      );
      assert.deepEqual(
        danglingRelationshipIds(groupB),
        [],
        'every id the second document names is present in the second document',
      );
    });

    // The positive control for the zeros above: the same two instruments,
    // under the same harness, reading non-zero when the row's fingerprint has
    // moved. Without it, a cache that silently answered nothing — or a
    // hydration counter that matched no query — would look identical.
    test('a write to a shared target supersedes its assembly rather than leaving it readable', async function (assert) {
      await searchCardsForTest(realm.realmIndexQueryEngine, groupQuery('a'), {
        loadLinks: true,
      });

      await realm.write(
        'target-0.json',
        JSON.stringify({
          data: {
            attributes: { name: 'Target 0 renamed' },
            relationships: { detail: { links: { self: './detail-0' } } },
            meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
          },
        } as LooseSingleCardDocument),
      );

      let before = { ...assemblyCache.stats };
      let after = await countingLinkHydrations(async (readHydrations) => {
        let result = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          groupQuery('b'),
          { loadLinks: true },
        );
        assert.ok(
          readHydrations() >= 1,
          `the written row was read again rather than answered from the held copy, got ${readHydrations()} hydrations`,
        );
        return result;
      });
      let stats = assemblyCache.stats;

      let rewritten = after.included.find((r) =>
        r.id?.endsWith('/target-0'),
      ) as CardResource | undefined;
      assert.strictEqual(
        (rewritten?.attributes as { name?: string } | undefined)?.name,
        'Target 0 renamed',
        'the search that follows the write reads the written name',
      );
      assert.ok(
        stats.misses - before.misses >= 1,
        `and assembled it again, got ${stats.misses - before.misses} assemblies`,
      );
      assert.strictEqual(
        after.included.length,
        EXPECTED_CLOSURE_SIZE,
        'while the document still carries its whole closure',
      );
      assert.deepEqual(
        danglingRelationshipIds(after),
        [],
        'with nothing left dangling',
      );
    });
  });
});
