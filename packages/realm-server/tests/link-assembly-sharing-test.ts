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

const testRealm = new URL('http://127.0.0.1:4452/test/');
// Two disjoint sets of source cards that link to the same targets — the shape
// the ticket measured on a Tessar-shaped realm, where eight searches returned
// 1,513 included resources of which 868 were distinct.
const SOURCES_PER_GROUP = 4;
const NUM_TARGETS = 3;

let testDbAdapter: DBAdapter;
// Owned by the test so it can read the cache's own account of what it spared,
// and so a test that needs a cold start can stand up its own.
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

    test('a target two searches both reach is assembled once, and both documents still carry it', async function (assert) {
      // Count the batched row hydrations — the read the cache exists to skip.
      // Distinguished from the freshness pre-read by its `SELECT i.*`, which
      // pulls the pristine doc, the search doc and every prerendered format.
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
        let before = { ...assemblyCache.stats };
        let groupA = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          groupQuery('a'),
          { loadLinks: true },
        );
        let afterA = { ...assemblyCache.stats };
        let hydrationsForA = hydrations;
        hydrations = 0;
        let groupB = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          groupQuery('b'),
          { loadLinks: true },
        );
        let afterB = { ...assemblyCache.stats };

        assert.strictEqual(
          groupA.data.length,
          SOURCES_PER_GROUP,
          'the first search returned its own group',
        );
        assert.strictEqual(
          groupB.data.length,
          SOURCES_PER_GROUP,
          'the second search returned its own group',
        );

        // The positive control for every count below: the first search had
        // nothing to reuse, so it assembled the whole closure itself and read
        // the rows to do it.
        assert.strictEqual(
          afterA.misses - before.misses,
          EXPECTED_CLOSURE_SIZE,
          `the first search assembled all ${EXPECTED_CLOSURE_SIZE} linked resources, got ${
            afterA.misses - before.misses
          }`,
        );
        assert.ok(
          hydrationsForA > 0,
          `the first search hydrated the rows it assembled from, got ${hydrationsForA}`,
        );

        assert.strictEqual(
          afterB.misses - afterA.misses,
          0,
          `the second search assembled nothing new, got ${
            afterB.misses - afterA.misses
          }`,
        );
        assert.strictEqual(
          afterB.hits - afterA.hits,
          EXPECTED_CLOSURE_SIZE,
          `the second search reused all ${EXPECTED_CLOSURE_SIZE} assemblies, got ${
            afterB.hits - afterA.hits
          }`,
        );
        assert.strictEqual(
          hydrations,
          0,
          `the second search hydrated no linked row, got ${hydrations}`,
        );

        // …and it is nonetheless a complete document on its own.
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
      } finally {
        dbExecute.execute = originalExecute;
      }
    });

    test('a write to a shared target supersedes its assembly rather than leaving it readable', async function (assert) {
      let warm = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        groupQuery('a'),
        { loadLinks: true },
      );
      let warmTarget = warm.included.find((r) =>
        r.id?.endsWith('/target-0'),
      ) as CardResource | undefined;
      assert.strictEqual(
        (warmTarget?.attributes as { name?: string } | undefined)?.name,
        'Target 0',
        'the assembled target carries its indexed name',
      );

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
      let after = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        groupQuery('b'),
        { loadLinks: true },
      );
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
        `the written row was assembled again rather than served from the held copy, got ${
          stats.misses - before.misses
        }`,
      );
      assert.deepEqual(
        danglingRelationshipIds(after),
        [],
        'and the document is still complete',
      );
    });
  });
});
