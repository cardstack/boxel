import QUnit from 'qunit';
import supertest from 'supertest';
import type { SuperTest, Test } from 'supertest';
import { dirSync, type DirResult } from 'tmp';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  VirtualNetwork,
  parseSearchEntryQueryFromPayload,
  rri,
  type Definition,
  type DefinitionLookup,
  type Realm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { LATTICE_INPUT_GENERATION_HEADER } from '@cardstack/runtime-common/lattice-materialization';
import { RealmServer, type RealmHttpServer } from '../server.ts';
import { LIVE_SEARCH_CACHE_HEADER } from '../handlers/handle-search.ts';
import { LiveSearchCache } from '../live-search-cache.ts';
import {
  awaitListening,
  closeServer,
  createRealm,
  grafanaSecret,
  makeTestReconciler,
  matrixRegistrationSecret,
  realmSecretSeed,
  realmServerSecretSeed,
  realmServerTestMatrix,
  setupDB,
} from './helpers/index.ts';

const { module, test } = QUnit;
const origin = 'http://127.0.0.1:4456/';
const ordinaryURL = origin + 'ordinary/';
const enabledURL = origin + 'enabled/';
const on = { module: rri(origin + 'record'), name: 'Record' };
const lattice = new LatticeRealmConfig([enabledURL]);

module('Lattice | search opt-in', function (hooks) {
  let db: PgAdapter;
  let network: VirtualNetwork;
  let ordinary: Realm;
  let enabled: Realm;
  let server: RealmHttpServer;
  let request: SuperTest<Test>;
  let dirs: DirResult[];
  let statements: { sql: string; bind?: unknown[] }[];
  let definitionReads: { ref: ResolvedCodeRef; priority?: number }[];
  let realmLookups: string[];
  const definition: Definition = {
    type: 'card-def',
    codeRef: on,
    displayName: 'Search fixture',
    fields: { value: 'value' },
    fieldDefs: {
      value: {
        type: 'contains',
        isPrimitive: true,
        isComputed: false,
        serializerName: 'number',
        fieldOrCard: { module: rri('@cardstack/base/number'), name: 'default' },
      },
    },
  };
  const lookup = {
    forRealm() {
      return this;
    },
    async lookupDefinition(ref: ResolvedCodeRef, opts?: { priority?: number }) {
      definitionReads.push({ ref, priority: opts?.priority });
      return definition;
    },
  } as unknown as DefinitionLookup;

  setupDB(hooks, {
    beforeEach: async (adapter, publisher) => {
      db = adapter;
      dirs = [];
      definitionReads = [];
      realmLookups = [];
      statements = [];
      network = new VirtualNetwork();
      network.addRealmMapping(
        '@cardstack/base/',
        'https://cardstack.com/base/',
      );
      const writer = new IndexWriter(db, { lattice });
      const realms: Realm[] = [];
      for (const root of [ordinaryURL, enabledURL]) {
        const dir = dirSync({ unsafeCleanup: true });
        dirs.push(dir);
        const batch = await writer.createBatch(new URL(root), network);
        for (const value of [7, 8]) {
          await batch.updateEntry(new URL(root + value + '.json'), {
            type: 'instance',
            lastModified: 1,
            resourceCreatedAt: 1,
            resource: {
              id: rri(root + value),
              type: 'card',
              attributes: { value },
              meta: { adoptsFrom: on },
            },
            searchData: { value },
            types: [on.module + '/' + on.name],
            displayNames: ['Record'],
            deps: new Set(),
          });
        }
        await batch.done();
        const { realm } = await createRealm({
          dir: dir.name,
          realmURL: root,
          dbAdapter: db,
          publisher,
          virtualNetwork: network,
          definitionLookup: lookup,
          lattice,
        });
        network.mount(realm.handle);
        realms.push(realm);
      }
      [ordinary, enabled] = realms;
      const rootDir = dirSync({ unsafeCleanup: true });
      dirs.push(rootDir);
      // Real composition root and authorization middleware; card data is
      // seeded through IndexWriter so the search boundary needs no browser.
      const reconciler = makeTestReconciler(db, realms);
      const lookupOrMount = reconciler.lookupOrMount.bind(reconciler);
      reconciler.lookupOrMount = (...args) => {
        realmLookups.push(args[0]);
        return lookupOrMount(...args);
      };
      const serverOpts = {
        realms,
        lattice,
        reconciler,
        virtualNetwork: network,
        matrixClient: new MatrixClient({
          matrixURL: realmServerTestMatrix.url,
          username: realmServerTestMatrix.username,
          seed: realmSecretSeed,
        }),
        realmServerSecretSeed,
        realmSecretSeed,
        grafanaSecret,
        matrixRegistrationSecret,
        realmsRootPath: rootDir.name,
        dbAdapter: db,
        queue: publisher,
        definitionLookup: lookup,
        getIndexHTML: async () => '<html></html>',
        serverURL: new URL(origin),
        assetsURL: new URL('http://example.com/assets/'),
        liveSearchCache: new LiveSearchCache({ ttlMs: 60_000 }),
      };
      const realmServer = new RealmServer(serverOpts);
      server = await awaitListening(realmServer.listen(4456));
      request = supertest(server);
      await realmServer.start();
      const execute = db.execute.bind(db);
      db.execute = async (sql, opts) => {
        statements.push({ sql, bind: opts?.bind });
        return execute(sql, opts);
      };
    },
    afterEach: async () => {
      ordinary?.unsubscribe();
      enabled?.unsubscribe();
      if (server) await closeServer(server);
      dirs?.forEach((dir) => dir.removeCallback());
    },
  });

  const searchQuery = () =>
    parseSearchEntryQueryFromPayload({
      filter: { 'item.on': on, range: { 'item.value': { gte: 7 } } },
      sort: [{ by: 'item.value', direction: 'desc' }],
      page: { size: 1 },
      fields: { entry: ['item'] },
    });

  function search(realms: string[], headers: Record<string, string> = {}) {
    return request
      .post('/_federated-search')
      .set('Accept', 'application/vnd.card+json')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set(headers)
      .send({
        realms,
        filter: { 'item.on': on, range: { 'item.value': { gte: 7 } } },
        fields: { entry: ['item'] },
      });
  }

  const latticeSQL = () =>
    statements.filter(({ sql }) => /\b(lattice_|lattice_)/.test(sql));

  test('ordinary compilation preserves the unscoped engine lookup behavior and results', async (assert) => {
    const parsed = searchQuery();
    const baseline = await new IndexQueryEngine(db, lookup, network).search(
      new URL(ordinaryURL),
      parsed.itemQuery,
      {},
      { kind: 'dataOnly' },
      'all',
    );
    const baselineReads = [...definitionReads];
    assert.ok(
      baselineReads.length > 1,
      'fixture exercises repeated schema walks',
    );
    definitionReads = [];
    const result = await ordinary.realmIndexQueryEngine.searchEntries(parsed, {
      priority: 10,
    });
    assert.deepEqual(
      result.data.map((entry) => entry.id),
      [ordinaryURL + '8'],
    );
    assert.strictEqual(result.meta.page.total, baseline.meta.page.total);
    assert.deepEqual(
      definitionReads,
      baselineReads,
      'ordinary compilation adds no scoped cache or priority override',
    );
    assert.deepEqual(latticeSQL(), []);
  });

  test('enabled compilation reuses definitions only within a request and isolates priority', async (assert) => {
    await Promise.all([
      enabled.realmIndexQueryEngine.searchEntries(searchQuery(), {
        priority: 10,
      }),
      enabled.realmIndexQueryEngine.searchEntries(searchQuery(), {
        priority: 0,
      }),
    ]);
    assert.deepEqual(
      definitionReads.map((read) => read.priority).sort(),
      [0, 10],
    );
    definitionReads = [];
    await enabled.realmIndexQueryEngine.searchEntries(searchQuery(), {
      priority: 8,
    });
    assert.deepEqual(
      definitionReads.map((read) => read.priority),
      [8],
      'a later request resolves current definitions again',
    );
  });

  test('ordinary federation ignores input headers and retains cache hits without registry probes', async (assert) => {
    const first = await search([ordinaryURL]);
    assert.strictEqual(first.status, 200, first.text);
    assert.strictEqual(first.body.meta.page.total, 2);
    assert.deepEqual(latticeSQL(), []);
    assert.deepEqual(
      realmLookups,
      [ordinaryURL],
      'cache miss resolves its realm',
    );
    definitionReads = [];
    realmLookups = [];
    statements = [];
    const second = await search([ordinaryURL], {
      [LATTICE_INPUT_GENERATION_HEADER]: 'not-a-generation',
    });
    assert.strictEqual(second.status, 200, second.text);
    assert.deepEqual(second.body, first.body);
    assert.strictEqual(second.headers[LIVE_SEARCH_CACHE_HEADER], 'hit');
    assert.deepEqual(
      definitionReads,
      [],
      'cache hit does not compile or execute search',
    );
    assert.deepEqual(
      realmLookups,
      [],
      'cache hit does not resolve or mount realms',
    );
    assert.deepEqual(latticeSQL(), []);
  });

  test('input options cannot bypass ordinary render errors, while enabled inputs remain data-only', async (assert) => {
    await db.execute(
      `INSERT INTO prerendered_html(url,file_alias,realm_url,type,generation,error_doc)
      SELECT url,file_alias,realm_url,type,generation,'{"status":500,"message":"Synthetic render failure"}'::jsonb
      FROM boxel_index WHERE type='instance' AND file_alias IN ($1,$2)`,
      {
        bind: [ordinaryURL + '8', enabledURL + '8'],
      },
    );
    const plain =
      await ordinary.realmIndexQueryEngine.searchEntries(searchQuery());
    const attempted = await ordinary.realmIndexQueryEngine.searchEntries(
      searchQuery(),
      { latticeInput: true },
    );
    assert.deepEqual(
      attempted,
      plain,
      'an internal option cannot opt an ordinary realm in',
    );
    assert.strictEqual(plain.meta.page.total, 1);
    assert.deepEqual(
      plain.data.map((entry) => entry.id),
      [ordinaryURL + '7'],
    );
    const input = await enabled.realmIndexQueryEngine.searchEntries(
      searchQuery(),
      { latticeInput: true },
    );
    assert.strictEqual(
      input.meta.page.total,
      2,
      'enabled data input remains independent of render errors',
    );
    assert.deepEqual(
      input.data.map((entry) => entry.id),
      [enabledURL + '8'],
    );
  });

  test('enabled federation enforces generation before and after the complete search', async (assert) => {
    const valid = await search([enabledURL], {
      [LATTICE_INPUT_GENERATION_HEADER]: '1',
    });
    assert.strictEqual(valid.status, 200, valid.text);
    assert.strictEqual(valid.body.meta.page.total, 2);
    assert.strictEqual(valid.headers['cache-control'], 'no-store');
    const invalid = await search([enabledURL], {
      [LATTICE_INPUT_GENERATION_HEADER]: '999',
    });
    assert.strictEqual(invalid.status, 409, invalid.text);
    const malformed = await search([enabledURL], {
      [LATTICE_INPUT_GENERATION_HEADER]: 'bad',
    });
    assert.strictEqual(malformed.status, 400, malformed.text);
    const original = enabled.searchEntries.bind(enabled);
    enabled.searchEntries = async (...args) => {
      const doc = await original(...args);
      await db.execute(
        'UPDATE realm_generations SET current_generation=current_generation+1 WHERE realm_url=$1',
        {
          bind: [enabledURL],
        },
      );
      return doc;
    };
    try {
      const raced = await search([enabledURL], {
        [LATTICE_INPUT_GENERATION_HEADER]: '1',
      });
      assert.strictEqual(
        raced.status,
        409,
        'a mid-search swap cannot return a pinned-input success',
      );
    } finally {
      enabled.searchEntries = original;
    }
  });

  async function publishFixture() {
    const [generation] = await db.execute(
      'SELECT current_generation,loader_epoch FROM realm_generations WHERE realm_url=$1',
      { bind: [enabledURL] },
    );
    const stamp = {
      version: 1,
      state: 'ready',
      computedFields: ['value'],
      queryFields: [],
      watches: [],
      validatedThrough: Number(generation.current_generation),
      outputRevision: Number(generation.current_generation),
      definitionRevision: generation.loader_epoch,
    };
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication}',$1::jsonb)
      WHERE realm_url=$2 AND file_alias=$3`,
      {
        bind: [JSON.stringify(stamp), enabledURL, enabledURL + '7'],
      },
    );
    await db.execute(
      `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,definition_revision)
      VALUES($1,$2,$3,$3,$4)`,
      {
        bind: [
          enabledURL,
          enabledURL + '7.json',
          stamp.outputRevision,
          stamp.definitionRevision,
        ],
      },
    );
    statements = [];
  }

  test('mixed federation revalidates only enabled publications and never grants mixed input authority', async (assert) => {
    await publishFixture();
    const first = await search([ordinaryURL, enabledURL]);
    assert.strictEqual(first.status, 200, first.text);
    assert.strictEqual(first.body.meta.page.total, 4);
    assert.strictEqual(first.headers['cache-control'], 'no-store');
    assert.ok(latticeSQL().length > 0);
    assert.false(
      latticeSQL().some(({ bind }) => bind?.includes(ordinaryURL)),
      'ordinary member is absent from registry probes',
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=2 WHERE realm_url=$1',
      { bind: [enabledURL] },
    );
    const pending = await search([ordinaryURL, enabledURL]);
    const items = pending.body.included.filter(
      (item: any) => item.type === 'card',
    );
    assert.strictEqual(
      items.find((item: any) => item.id === enabledURL + '7').meta.publication
        .state,
      'pending',
    );
    assert.true(
      items
        .filter((item: any) => item.id.startsWith(ordinaryURL))
        .every((item: any) => !item.meta.publication),
    );
    const invalid = await search([ordinaryURL, enabledURL], {
      [LATTICE_INPUT_GENERATION_HEADER]: '1',
    });
    assert.strictEqual(invalid.status, 400, invalid.text);
  });

  test('federated authorization runs before any enabled protocol work', async (assert) => {
    const denied = await search([enabledURL], {
      Authorization: 'Bearer invalid',
      [LATTICE_INPUT_GENERATION_HEADER]: 'bad',
    });
    assert.strictEqual(denied.status, 401, denied.text);
    assert.deepEqual(latticeSQL(), []);
    assert.deepEqual(definitionReads, []);
  });
});
