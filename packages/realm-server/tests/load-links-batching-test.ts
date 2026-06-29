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
    import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
    import StringField from "https://cardstack.com/base/string";

    export class Target extends CardDef {
      @field name = contains(StringField);
    }
  `;

  fs['source.gts'] = `
    import { contains, field, linksTo, CardDef } from "https://cardstack.com/base/card-api";
    import StringField from "https://cardstack.com/base/string";
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

// CS-11038 regression test: loadLinks must batch in-realm link resolution
// rather than issuing one DB round-trip per relationship. With 50 source
// cards each linking to 5 targets, the original implementation would have
// fired 250 sequential `WHERE i.url = $1` lookups. The new BFS path issues
// one batched `WHERE i.url IN (...)` per recursion depth.
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

      try {
        dbExecute.execute = async (sql, opts) => {
          // `param('instance')` becomes a `$N` placeholder in the rendered
          // SQL — we have to look at opts.bind to see whether this query
          // is filtering for instance rows.
          let bind = opts?.bind ?? [];
          let normalized = sql.replace(/\s+/g, ' ');
          let isBoxelIndexInstanceLookup =
            /FROM boxel_index\b/.test(normalized) &&
            bind.some((v) => v === 'instance');
          if (isBoxelIndexInstanceLookup) {
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
  });
});
