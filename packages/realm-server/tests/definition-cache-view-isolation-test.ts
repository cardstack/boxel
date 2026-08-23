import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  CachingDefinitionLookup,
  internalKeyFor,
  rri,
  trimExecutableExtension,
  type ModulePrerenderArgs,
  type Prerenderer,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres/pg-adapter';
import {
  createTestPgAdapter,
  createVirtualNetwork,
  prepareTestDB,
  testCreatePrerenderAuth,
} from './helpers/index.ts';

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let definitionLookup: CachingDefinitionLookup;
  let prerenderModuleViews: (string | undefined)[];
  let realmURL = 'http://127.0.0.1:4453/';
  let testUserId = '@user1:localhost';

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    prerenderModuleViews = [];
    let virtualNetwork = createVirtualNetwork();
    let prerenderer: Prerenderer = {
      async prerenderModule(args: ModulePrerenderArgs) {
        prerenderModuleViews.push(args.realmView);
        let moduleURL = new URL(args.url);
        let modulePath = trimExecutableExtension(rri(moduleURL.href));
        let codeRef = { module: rri(modulePath), name: 'Person' };
        return {
          id: args.url,
          status: 'ready',
          nonce: 'view-isolation',
          isShimmed: false,
          lastModified: Date.now(),
          createdAt: Date.now(),
          deps: [],
          definitions: {
            [internalKeyFor(codeRef, undefined, virtualNetwork)]: {
              type: 'definition',
              moduleURL: moduleURL.href,
              definition: {
                type: 'card-def',
                codeRef,
                displayName: args.realmView
                  ? `Person at ${args.realmView}`
                  : 'Person',
                fields: {},
                fieldDefs: {},
              },
              types: [],
            },
          },
        };
      },
      async prerenderVisit() {
        throw new Error('Not implemented in mock');
      },
      async runCommand() {
        throw new Error('Not implemented in mock');
      },
    };
    definitionLookup = new CachingDefinitionLookup(
      adapter,
      prerenderer,
      virtualNetwork,
      testCreatePrerenderAuth,
    );
    definitionLookup.registerRealm({
      url: realmURL,
      async getRealmOwnerUserId() {
        return testUserId;
      },
      async visibility() {
        return 'private';
      },
    });
    await adapter.execute(
      `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
       VALUES ($1, $2, true, true, true)`,
      { bind: [realmURL, testUserId] },
    );
  });

  hooks.afterEach(async function () {
    await adapter.close();
  });

  test('live and checkpoint definitions use isolated cache identities', async function (assert) {
    let checkpointView = 'a'.repeat(64);
    let codeRef = {
      module: rri(`${realmURL}person.gts`),
      name: 'Person',
    };

    let live = await definitionLookup.lookupDefinition(codeRef);
    let checkpoint = await definitionLookup.lookupDefinition(codeRef, {
      realmView: checkpointView,
    });

    assert.strictEqual(live.displayName, 'Person', 'live bytes were used');
    assert.strictEqual(
      checkpoint.displayName,
      `Person at ${checkpointView}`,
      'checkpoint bytes were used',
    );
    assert.deepEqual(
      prerenderModuleViews,
      [undefined, checkpointView],
      'the prerender transport receives the selected view',
    );

    await definitionLookup.lookupDefinition(codeRef);
    await definitionLookup.lookupDefinition(codeRef, {
      realmView: checkpointView,
    });
    assert.strictEqual(
      prerenderModuleViews.length,
      2,
      'each view subsequently hits its own cache row',
    );

    await definitionLookup.invalidate(`${realmURL}person.gts`);
    await definitionLookup.lookupDefinition(codeRef, {
      realmView: checkpointView,
    });
    assert.strictEqual(
      prerenderModuleViews.length,
      2,
      'a live invalidation preserves immutable checkpoint cache rows',
    );
    await definitionLookup.lookupDefinition(codeRef);
    assert.strictEqual(
      prerenderModuleViews.length,
      3,
      'the invalidated live row is rebuilt',
    );

    let rows = await adapter.execute(
      `SELECT realm_view, COUNT(*)::int AS count
       FROM modules
       WHERE resolved_realm_url = $1
       GROUP BY realm_view
       ORDER BY realm_view`,
      { bind: [realmURL] },
    );
    assert.deepEqual(
      rows,
      [
        { realm_view: checkpointView, count: 1 },
        { realm_view: 'live', count: 1 },
      ],
      'both cache rows coexist durably',
    );
  });
});
