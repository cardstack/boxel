import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { rri } from '@cardstack/runtime-common';
import type {
  DBAdapter,
  LooseSingleCardDocument,
  Realm,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  searchCardsForTest,
} from './helpers/index.ts';

const testRealm = new URL('http://127.0.0.1:4451/test/');
const NUM_SOURCES = 50;
const NUM_TARGETS = 5;

let testDbAdapter: DBAdapter;

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['target.gts'] = `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Target extends CardDef {
      @field name = contains(StringField);
    }
  `;

  fs['source.gts'] = `
    import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Target } from "./target";

    export class Source extends CardDef {
      @field name = contains(StringField);
      @field link0 = linksTo(() => Target);
      @field link1 = linksTo(() => Target);
      @field link2 = linksTo(() => Target);
      @field link3 = linksTo(() => Target);
      @field link4 = linksTo(() => Target);
    }
  `;

  for (let i = 0; i < NUM_TARGETS; i++) {
    fs[`target-${i}.json`] = {
      data: {
        attributes: { name: `Target ${i}` },
        meta: {
          adoptsFrom: {
            module: rri('./target'),
            name: 'Target',
          },
        },
      },
    } as LooseSingleCardDocument;
  }

  for (let i = 0; i < NUM_SOURCES; i++) {
    let relationships: Record<string, { links: { self: string } }> = {};
    for (let j = 0; j < NUM_TARGETS; j++) {
      relationships[`link${j}`] = { links: { self: `./target-${j}` } };
    }
    fs[`source-${i}.json`] = {
      data: {
        attributes: { name: `Source ${i}` },
        relationships,
        meta: {
          adoptsFrom: {
            module: rri('./source'),
            name: 'Source',
          },
        },
      },
    } as LooseSingleCardDocument;
  }

  return fs;
}

// loadLinks resolves in-realm links in batches rather than one DB round-trip
// per relationship: each BFS layer issues a single `WHERE i.url IN (...)`
// lookup for every link it has to follow. Resolved per link with
// `WHERE i.url = $1`, 50 source cards with 5 links each would cost 250
// sequential queries.
module(basename(import.meta.filename), function () {
  module('loadLinks batching', function (hooks) {
    let realm: Realm;

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL: testRealm,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      onRealmSetup({ dbAdapter, testRealm: r }) {
        testDbAdapter = dbAdapter;
        realm = r;
      },
    });

    test(`searchCards with loadLinks issues 1 batched DB query per recursion depth (${NUM_SOURCES} cards × ${NUM_TARGETS} links)`, async function (assert) {
      let originalExecute = testDbAdapter.execute.bind(testDbAdapter);
      let perLinkLookupCount = 0;
      let batchedLinkLookupCount = 0;
      let dbExecute = testDbAdapter as {
        execute: typeof testDbAdapter.execute;
      };

      // Only lookups that bind one of the fixture's link targets count. The
      // search path issues one instance lookup of its own: assembling the
      // result runs attachRealmInfo → getRealmInfo → parseRealmInfo, which
      // overlays the indexed RealmConfig card through a single `i.url = $1`
      // query the first time after indexing has cleared the realm-info cache.
      // That query resolves no link, and neither would any other lookup the
      // search path grows; counting by shape alone would fail on all of them.
      let targetPrefix = `${testRealm.href}target-`;
      let looksUpALinkTarget = (bind: unknown[]) =>
        bind.some((v) => typeof v === 'string' && v.startsWith(targetPrefix));

      try {
        dbExecute.execute = async (sql, opts) => {
          // `param('instance')` becomes a `$N` placeholder in the rendered
          // SQL — we have to look at opts.bind to see whether this query
          // is filtering for instance rows.
          let bind = opts?.bind ?? [];
          let normalized = sql.replace(/\s+/g, ' ');
          let isLinkTargetInstanceLookup =
            /FROM boxel_index\b/.test(normalized) &&
            bind.some((v) => v === 'instance') &&
            looksUpALinkTarget(bind);
          if (isLinkTargetInstanceLookup) {
            // Old per-link path: WHERE i.url = $1 OR i.file_alias = $1
            // New batched path:  WHERE i.url IN ($1, ..., $N) OR i.file_alias IN (...)
            if (/\bi\.url\s+IN\s*\(/.test(normalized)) {
              batchedLinkLookupCount++;
            } else if (/\bi\.url\s*=\s*\$/.test(normalized)) {
              perLinkLookupCount++;
            }
          }
          return originalExecute(sql, opts);
        };

        let result = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          {
            filter: {
              type: { module: rri(`${testRealm}source`), name: 'Source' },
            },
          },
          { loadLinks: true },
        );

        assert.strictEqual(
          result.data.length,
          NUM_SOURCES,
          `search returned all ${NUM_SOURCES} source cards`,
        );
        assert.ok(result.included, 'included is present');
        let includedCount = result.included?.length ?? 0;
        assert.strictEqual(
          includedCount,
          NUM_TARGETS,
          `included contains all ${NUM_TARGETS} unique targets`,
        );

        assert.strictEqual(
          perLinkLookupCount,
          0,
          `expected 0 per-link DB lookups (the old N×M path), got ${perLinkLookupCount}`,
        );
        assert.ok(
          batchedLinkLookupCount > 0,
          `expected at least 1 batched-link DB query, got ${batchedLinkLookupCount}`,
        );
        assert.ok(
          batchedLinkLookupCount <= 2,
          `expected ≤ 2 batched-link DB queries (1 per recursion depth), got ${batchedLinkLookupCount}`,
        );
      } finally {
        dbExecute.execute = originalExecute;
      }
    });

    // The only place this is observable. The response is byte-identical either
    // way, so nothing asserted on the body can tell a read that fetches every
    // prerendered format from one that fetches none — the emitted SQL can.
    test('the link-target read fetches the stored document and none of the rendered output', async function (assert) {
      let originalExecute = testDbAdapter.execute.bind(testDbAdapter);
      let dbExecute = testDbAdapter as {
        execute: typeof testDbAdapter.execute;
      };
      let targetPrefix = `${testRealm.href}target-`;
      let linkTargetSelects: string[] = [];

      try {
        dbExecute.execute = async (sql, opts) => {
          let bind = opts?.bind ?? [];
          let normalized = sql.replace(/\s+/g, ' ');
          if (
            /FROM boxel_index\b/.test(normalized) &&
            /\bi\.url\s+IN\s*\(/.test(normalized) &&
            bind.some((v) => v === 'instance') &&
            bind.some(
              (v) => typeof v === 'string' && v.startsWith(targetPrefix),
            )
          ) {
            linkTargetSelects.push(normalized.split(' FROM ')[0]);
          }
          return originalExecute(sql, opts);
        };

        let result = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          {
            filter: {
              type: { module: rri(`${testRealm}source`), name: 'Source' },
            },
          },
          { loadLinks: true },
        );

        let includedCount = result.included?.length ?? 0;
        assert.strictEqual(
          includedCount,
          NUM_TARGETS,
          `the closure is still assembled in full — ${NUM_TARGETS} targets`,
        );
        assert.ok(
          linkTargetSelects.length > 0,
          `the link targets were read in a batch, got ${linkTargetSelects.length} such queries`,
        );

        // `loadLinks` expands only the `item` full projection; the `html`
        // fieldset is served by the render-set projection, which never reaches
        // this read. So a caller here cannot have asked for rendered output.
        for (let select of linkTargetSelects) {
          for (let column of [
            'isolated_html',
            'head_html',
            'atom_html',
            'embedded_html',
            'fitted_html',
            'markdown',
            'search_doc',
          ]) {
            assert.notOk(
              select.includes(column),
              `the link-target read does not fetch ${column} — got: ${select}`,
            );
          }
          assert.ok(
            select.includes('pristine_doc'),
            `the link-target read fetches the stored document — got: ${select}`,
          );
          assert.ok(
            select.includes('screenshots'),
            `and the declared-screenshot manifest it joins into meta — got: ${select}`,
          );
        }
      } finally {
        dbExecute.execute = originalExecute;
      }
    });

    // The one prerendered_html column this read keeps. It travels on a channel
    // the index row does not follow, so it is written here directly rather
    // than captured, and read back through the side-loading path.
    test('a side-loaded target still carries the declared-screenshot manifest joined into its meta', async function (assert) {
      let targetURL = `${testRealm.href}target-0.json`;
      let manifest = {
        hero: {
          specHash: 'spec-1',
          objectKey: 'abc123',
          contentType: 'image/png',
          width: 100,
          height: 100,
          deviceScaleFactor: 1,
        },
      };
      await testDbAdapter.execute(
        `UPDATE prerendered_html SET screenshots = $1 WHERE url = $2 AND type = 'instance'`,
        { bind: [JSON.stringify(manifest), targetURL] },
      );

      let result = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        {
          filter: {
            type: { module: rri(`${testRealm}source`), name: 'Source' },
          },
        },
        { loadLinks: true },
      );

      let target = result.included?.find((r) => r.id?.endsWith('/target-0'));
      assert.ok(target, 'the target is side-loaded');
      let screenshots = (
        target?.meta as { screenshots?: Record<string, unknown> } | undefined
      )?.screenshots;
      assert.ok(
        screenshots?.hero,
        `the manifest reaches the side-loaded resource's meta, got ${JSON.stringify(
          screenshots,
        )}`,
      );
    });

    // The narrow select is responsible for carrying the document itself, and
    // a read that addressed the wrong row or dropped a column would still
    // satisfy the count and SQL-shape assertions above. The singular read
    // still fetches every column, so it stands in here as the reference.
    test('a side-loaded target carries the document the singular read returns', async function (assert) {
      let result = await searchCardsForTest(
        realm.realmIndexQueryEngine,
        {
          filter: {
            type: { module: rri(`${testRealm}source`), name: 'Source' },
          },
        },
        { loadLinks: true },
      );

      let included = result.included ?? [];
      assert.strictEqual(
        included.length,
        NUM_TARGETS,
        `every target is side-loaded — ${NUM_TARGETS}`,
      );

      for (let resource of included) {
        let reference = await realm.realmIndexQueryEngine.instance(
          new URL(resource.id!),
        );
        assert.strictEqual(
          reference?.type,
          'instance',
          `${resource.id} reads back as a live instance`,
        );
        let stored =
          reference?.type === 'instance' ? reference.instance : undefined;
        assert.deepEqual(
          resource.attributes,
          stored?.attributes,
          `${resource.id} carries the stored attributes`,
        );
        assert.deepEqual(
          (resource.meta as { adoptsFrom?: unknown }).adoptsFrom,
          (stored?.meta as { adoptsFrom?: unknown } | undefined)?.adoptsFrom,
          `${resource.id} carries the stored adoptsFrom`,
        );
      }
    });

    // Error state is the one thing the narrow read still derives from the
    // prerendered_html join, which it keeps only for that. An errored target
    // is left out of the closure, and the relationship naming it keeps the
    // fallback form the document carries when a target cannot be resolved.
    test('an errored link target is left out of the closure and its relationship falls back', async function (assert) {
      let erroredURL = `${testRealm.href}target-1.json`;
      await testDbAdapter.execute(
        `UPDATE boxel_index SET has_error = TRUE, error_doc = $1 WHERE url = $2 AND type = 'instance'`,
        {
          bind: [
            JSON.stringify({ status: 500, title: 'test-induced index error' }),
            erroredURL,
          ],
        },
      );

      try {
        let result = await searchCardsForTest(
          realm.realmIndexQueryEngine,
          {
            filter: {
              type: { module: rri(`${testRealm}source`), name: 'Source' },
            },
          },
          { loadLinks: true },
        );

        let included = result.included ?? [];
        assert.strictEqual(
          included.length,
          NUM_TARGETS - 1,
          `the errored target is the only one missing from the closure — ${
            NUM_TARGETS - 1
          } remain`,
        );
        assert.notOk(
          included.some((r) => r.id?.endsWith('/target-1')),
          'the errored target is absent from the closure',
        );
        assert.ok(
          included.some((r) => r.id?.endsWith('/target-0')),
          'its unerrored siblings are still assembled',
        );

        // The pointer survives even though the target does not: dropping it
        // would cost the document a relationship it still declares.
        let source = result.data.find((r) => r.id?.endsWith('/source-0'));
        let fallback = (
          source?.relationships as
            | Record<string, { data?: { type?: string; id?: string } }>
            | undefined
        )?.link1?.data;
        assert.strictEqual(
          fallback?.type,
          'card',
          'the unresolved relationship still reports a card target',
        );
        assert.ok(
          fallback?.id?.endsWith('/target-1'),
          `and still names it, got ${fallback?.id}`,
        );
      } finally {
        await testDbAdapter.execute(
          `UPDATE boxel_index SET has_error = FALSE, error_doc = NULL WHERE url = $1 AND type = 'instance'`,
          { bind: [erroredURL] },
        );
      }
    });
  });
});
