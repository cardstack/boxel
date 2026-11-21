import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  CachingDefinitionLookup,
  internalKeyFor,
  rri,
  VirtualNetwork,
  type ModulePrerenderArgs,
  type ModuleRenderResponse,
  type Prerenderer,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres/pg-adapter';
import {
  createVirtualNetwork,
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testCreatePrerenderAuth,
} from './helpers/index.ts';

// A request's definition lookups (`requestDefinitionLookup`) ask to
// `remember` the module's definitions row: a realm policy judges every search
// a visitor sends by the definitions of the queried type and its adoption
// chain, and each was read afresh on every request. A remembered row is
// served while the definition generation it was read under stands, for at
// most REMEMBERED_ROW_MS. The lookup context, and the realm permissions it
// reads, is built on every lookup, so a permission change takes effect on
// the next one.
module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let counted: PgAdapter;
  let lookup: CachingDefinitionLookup;
  let realmURL = 'http://127.0.0.1:4454/';
  let moduleURL = `${realmURL}person.gts`;
  let testUserId = '@user1:localhost';
  let reads: { modules: number; permissions: number };
  let visibilityReads = 0;

  let personRef = () => ({ module: rri(moduleURL), name: 'Person' });

  function moduleResponse(url: string): ModuleRenderResponse {
    let id = internalKeyFor(
      { module: rri(url), name: 'Person' },
      undefined,
      new VirtualNetwork(),
    );
    return {
      id: url,
      status: 'ready',
      nonce: 'test-nonce',
      isShimmed: false,
      lastModified: Date.now(),
      createdAt: Date.now(),
      deps: [],
      definitions: {
        [id]: {
          type: 'definition',
          moduleURL: url,
          definition: {
            type: 'card-def',
            codeRef: { module: rri(url), name: 'Person' },
            displayName: 'Person',
            fields: {},
            fieldDefs: {},
          },
          types: [],
        },
      },
    } as unknown as ModuleRenderResponse;
  }

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    reads = { modules: 0, permissions: 0 };
    // Counts the statements the lookup sends, by the table they read.
    counted = new Proxy(adapter, {
      get(target, prop) {
        if (prop === 'execute') {
          return (sql: string, opts?: unknown) => {
            if (/^\s*select/i.test(sql)) {
              if (/realm_user_permissions/.test(sql)) {
                reads.permissions++;
              } else if (/\bmodules\b/.test(sql)) {
                reads.modules++;
              }
            }
            return (target.execute as any).call(target, sql, opts);
          };
        }
        let v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as PgAdapter;
    let prerenderer: Prerenderer = {
      async prerenderModule(args: ModulePrerenderArgs) {
        return moduleResponse(args.url);
      },
      async prerenderVisit() {
        throw new Error('Not implemented in mock');
      },
      async runCommand() {
        throw new Error('Not implemented in mock');
      },
    };
    lookup = new CachingDefinitionLookup(
      counted,
      prerenderer,
      createVirtualNetwork(),
      testCreatePrerenderAuth,
    );
    lookup.registerRealm({
      url: realmURL,
      async getRealmOwnerUserId() {
        return testUserId;
      },
      // Where a realm's permissions reach the lookup: a served realm reads
      // them from realm_user_permissions here.
      async visibility() {
        visibilityReads++;
        return 'private';
      },
    });
    await adapter.execute(
      `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
       VALUES ($1, $2, true, true, true)`,
      { bind: [realmURL, testUserId] },
    );
    // The first lookup prerenders and writes the row; the tests count from
    // a populated cache.
    await lookup.lookupDefinition(personRef());
    reads = { modules: 0, permissions: 0 };
    visibilityReads = 0;
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  test('a lookup that does not ask holds the row too, until an invalidation', async function (assert) {
    await lookup.lookupDefinition(personRef());
    await lookup.lookupDefinition(personRef());
    assert.strictEqual(reads.modules, 1, 'two lookups, one row read');
    await lookup.invalidate(moduleURL);
    let before = reads.modules;
    await lookup.lookupDefinition(personRef());
    assert.true(
      reads.modules > before,
      'the lookup after an invalidation reads the row again',
    );
  });

  test('a lookup that asks reads the row once per generation', async function (assert) {
    let first = await lookup.lookupDefinition(personRef(), { remember: true });
    let modulesAfterFirst = reads.modules;
    let second = await lookup.lookupDefinition(personRef(), { remember: true });
    assert.strictEqual(
      reads.modules,
      modulesAfterFirst,
      'the second lookup reads no row',
    );
    assert.deepEqual(second, first, 'and answers the same definition');
  });

  test('the permissions are read on every lookup, remembered or not', async function (assert) {
    await lookup.lookupDefinition(personRef(), { remember: true });
    let afterFirst = visibilityReads;
    await lookup.lookupDefinition(personRef(), { remember: true });
    assert.true(afterFirst > 0, 'the first lookup reads the permissions');
    assert.strictEqual(
      visibilityReads,
      afterFirst * 2,
      'the remembered lookup reads them again',
    );
  });

  test('an invalidation ends the remembered row', async function (assert) {
    await lookup.lookupDefinition(personRef(), { remember: true });
    await lookup.invalidate(moduleURL);
    let before = reads.modules;
    await lookup.lookupDefinition(personRef(), { remember: true });
    assert.true(
      reads.modules > before,
      'the lookup after the invalidation reads the row again',
    );
  });
});
