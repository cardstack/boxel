import QUnit from 'qunit';
import supertest, { type SuperTest, type Test } from 'supertest';
import { dirSync, type DirResult } from 'tmp';
import type { PgAdapter } from '@cardstack/postgres';
import {
  CachingDefinitionLookup,
  IndexWriter,
  VirtualNetwork,
  rri,
  type Realm,
} from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { RealmServer, type RealmHttpServer } from '../server.ts';
import {
  retrieveHeadHTML,
  retrieveIsolatedHTML,
} from '../lib/index-html-injection.ts';
import {
  awaitListening,
  closeServer,
  createRealm,
  grafanaSecret,
  getTestPrerenderer,
  makeTestReconciler,
  matrixRegistrationSecret,
  realmSecretSeed,
  realmServerSecretSeed,
  realmServerTestMatrix,
  setupDB,
  setupPermissionedRealm,
  testCreatePrerenderAuth,
} from './helpers/index.ts';
import {
  maxPrerenderHtmlJobId,
  prerenderedHtmlRowFor,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';

const { module, test } = QUnit;
const origin = 'http://127.0.0.1:4456/';
const ordinary = origin + 'ordinary/';
const enabled = origin + 'enabled/';
const lattice = new LatticeRealmConfig([enabled]);
const latticeSQL = (sql: string) =>
  /\b(?:lattice_|lattice_)|AS lattice\b/.test(sql);

function shell() {
  return `<html><head><meta name="@cardstack/host/config/environment" content="${encodeURIComponent(
    JSON.stringify({
      matrixURL: 'http://localhost:8008',
      matrixServerName: 'localhost',
      realmServerURL: origin,
      publishedRealmBoxelSpaceDomain: 'localhost:4201',
      publishedRealmBoxelSiteDomain: 'localhost:4201',
    }),
  )}"><meta data-boxel-head-start><meta data-boxel-head-end></head><body><script id="boxel-isolated-start"></script><script id="boxel-isolated-end"></script></body></html>`;
}

module('Lattice | render and HTML read opt-in', (hooks) => {
  let db: PgAdapter;
  let statements: string[];
  let realms: Realm[];
  let dirs: DirResult[];
  let server: RealmHttpServer;
  let request: SuperTest<Test>;
  let network: VirtualNetwork;
  setupDB(hooks, {
    beforeEach: async (adapter, publisher) => {
      db = adapter;
      statements = [];
      dirs = [];
      realms = [];
      network = new VirtualNetwork();
      const lookup = new CachingDefinitionLookup(
        db,
        await getTestPrerenderer(),
        network,
        testCreatePrerenderAuth,
      );
      for (const root of [ordinary, enabled]) {
        const dir = dirSync({ unsafeCleanup: true });
        dirs.push(dir);
        const { realm } = await createRealm({
          dir: dir.name,
          realmURL: root,
          definitionLookup: lookup,
          dbAdapter: db,
          publisher,
          virtualNetwork: network,
          lattice,
        });
        realms.push(realm);
        await db.execute(
          "INSERT INTO realm_generations(realm_url,current_generation,loader_epoch) VALUES($1,2,'code-1')",
          { bind: [root] },
        );
        // These fixtures represent a completed index, including its completion
        // marker. Without it startup correctly waits for a recovery index job,
        // but this read-only fixture intentionally has no indexing worker.
        await db.execute(
          "INSERT INTO realm_meta(realm_url,generation,value) VALUES($1,2,'{}'::jsonb)",
          { bind: [root] },
        );
        const resource = {
          id: root + 'day',
          type: 'card',
          attributes: { count: 7 },
          meta: {
            adoptsFrom: { module: root + 'day-definition', name: 'Day' },
            publication: {
              version: 1,
              state: 'ready',
              computedFields: ['count'],
              queryFields: [],
              watches: [],
              validatedThrough: 1,
              outputRevision: 2,
              definitionRevision: 'code-1',
            },
          },
        };
        await db.execute(
          "INSERT INTO boxel_index(url,file_alias,realm_url,type,generation,pristine_doc,is_deleted,has_error) VALUES($1,$2,$3,'instance',2,$4::jsonb,FALSE,FALSE)",
          {
            bind: [
              root + 'day.json',
              root + 'day',
              root,
              JSON.stringify(resource),
            ],
          },
        );
        await db.execute(
          "INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,definition_revision) VALUES($1,$2,2,1,'code-1')",
          { bind: [root, root + 'day.json'] },
        );
        await db.execute(
          "INSERT INTO prerendered_html(url,file_alias,realm_url,type,generation,head_html,isolated_html,is_deleted) VALUES($1,$2,$3,'instance',2,$4,$5,FALSE)",
          {
            bind: [
              root + 'day.json',
              root + 'day',
              root,
              '<title>Day seven</title>',
              '<p>Confirmed count seven</p>',
            ],
          },
        );
      }
      const dir = dirSync({ unsafeCleanup: true });
      dirs.push(dir);
      const realmServer = new RealmServer({
        realms,
        lattice,
        reconciler: makeTestReconciler(db, realms),
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
        realmsRootPath: dir.name,
        dbAdapter: db,
        queue: publisher,
        definitionLookup: lookup,
        getIndexHTML: async () => shell(),
        serverURL: new URL(origin),
        assetsURL: new URL('http://example.com/assets/'),
      });
      server = await awaitListening(realmServer.listen(4456));
      request = supertest(server);
      await realmServer.start();
      const execute = db.execute.bind(db);
      db.execute = async (sql, opts) => {
        statements.push(sql);
        return execute(sql, opts);
      };
    },
    afterEach: async () => {
      for (const realm of realms) realm.unsubscribe();
      if (server) await closeServer(server);
      for (const dir of dirs) dir.removeCallback();
    },
  });

  async function html(root: string, config?: LatticeRealmConfig) {
    const opts = {
      cardURL: new URL(root + 'day'),
      realmURL: root,
      dbAdapter: db,
      lattice: config,
    };
    return Promise.all([retrieveHeadHTML(opts), retrieveIsolatedHTML(opts)]);
  }

  test('ordinary HTML reads ignore authored stamps and project no Lattice metadata', async (assert) => {
    await db.execute('UPDATE lattice_owners SET dirty_generation=3');
    for (const [root, config] of [
      [ordinary, lattice],
      [enabled, undefined],
    ] as const) {
      statements.length = 0;
      assert.deepEqual(await html(root, config), [
        '<title>Day seven</title>',
        '<p>Confirmed count seven</p>',
      ]);
      assert.false(
        statements.some(latticeSQL),
        'no registry lookup or Lattice projection',
      );
      assert.false(
        statements.some((sql) =>
          /pristine_doc|html_generation|html_error/.test(sql),
        ),
        'ordinary projection does not parse card JSON',
      );
    }
  });

  test('enabled HTML rejects dirty, mismatched and failed publications, then recovers', async (assert) => {
    assert.deepEqual(await html(enabled, lattice), [
      '<title>Day seven</title>',
      '<p>Confirmed count seven</p>',
    ]);
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=3 WHERE realm_url=$1',
      { bind: [enabled] },
    );
    assert.deepEqual(await html(enabled, lattice), [null, null]);
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=NULL WHERE realm_url=$1',
      { bind: [enabled] },
    );
    await db.execute(
      'UPDATE prerendered_html SET generation=1 WHERE realm_url=$1',
      { bind: [enabled] },
    );
    assert.deepEqual(await html(enabled, lattice), [null, null]);
    await db.execute(
      "UPDATE prerendered_html SET generation=2,error_doc='{}' WHERE realm_url=$1",
      { bind: [enabled] },
    );
    assert.deepEqual(await html(enabled, lattice), [null, null]);
    await db.execute(
      'UPDATE prerendered_html SET error_doc=NULL WHERE realm_url=$1',
      { bind: [enabled] },
    );
    assert.deepEqual(await html(enabled, lattice), [
      '<title>Day seven</title>',
      '<p>Confirmed count seven</p>',
    ]);
  });

  test('the real HTML handler gates its cache probe and publication reads by routed realm', async (assert) => {
    await db.execute('UPDATE lattice_owners SET dirty_generation=3');
    statements.length = 0;
    const off = await request
      .get('/ordinary/day')
      .set('Accept', 'text/html')
      .expect(200);
    assert.true(
      off.text.includes('<title>Day seven</title>'),
      'ordinary HTML remains available',
    );
    assert.false(
      statements.some(latticeSQL),
      'composition root keeps ordinary HTTP free of registry work',
    );
    assert.notStrictEqual(off.headers['cache-control'], 'no-store');
    assert.true(off.text.includes('<p>Confirmed count seven</p>'));
    statements.length = 0;
    const on = await request
      .get('/enabled/day')
      .set('Accept', 'text/html')
      .expect(200);
    assert.false(
      on.text.includes('<title>Day seven</title>'),
      'pending enabled output is not injected',
    );
    assert.strictEqual(on.headers['cache-control'], 'no-store');
    assert.true(statements.some(latticeSQL));
    assert.false(on.text.includes('<p>Confirmed count seven</p>'));
  });

  test('enabled retrieval cannot apply one realm policy to a different realm row', async (assert) => {
    const opts = {
      cardURL: new URL(ordinary + 'day'),
      realmURL: enabled,
      lattice,
      dbAdapter: db,
    };
    assert.deepEqual(
      await Promise.all([retrieveHeadHTML(opts), retrieveIsolatedHTML(opts)]),
      [null, null],
    );
  });

  test('HTML dependency expansion needs writer enablement even with an explicit expansion argument', async (assert) => {
    const writer = new IndexWriter(db, { lattice });
    for (const root of [ordinary, enabled]) {
      await db.execute(
        'UPDATE prerendered_html SET deps=$1::jsonb WHERE realm_url=$2',
        { bind: [JSON.stringify([root + 'input.json']), root] },
      );
      const batch = await writer.createBatch(
        new URL(root),
        network,
        undefined,
        { prerenderHtmlOnly: true, generation: 3 },
      );
      await batch.seedPrerenderedHtmlInvalidations(
        [{ url: root + 'input.json', operation: 'update' }],
        { expandDependencies: true },
      );
      assert.deepEqual(
        batch.invalidations.sort(),
        (root === enabled
          ? [root + 'input.json', root + 'day.json']
          : [root + 'input.json']
        ).sort(),
      );
      await batch.done();
    }
  });
});

module('Lattice | ordinary render worker gate', (hooks) => {
  const root = new URL('http://127.0.0.1:4445/test/');
  let realm: Realm;
  let db: PgAdapter;
  let statements: string[] = [];
  setupPermissionedRealm(hooks, {
    realmURL: root,
    permissions: { '*': ['read'] },
    fileSystem: {
      'counter.gts': `import { CardDef, Component, field, contains } from '@cardstack/base/card-api';
        import NumberField from '@cardstack/base/number';
        export class Counter extends CardDef {
          static materialized = true;
          @field count = contains(NumberField);
          static isolated = class Isolated extends Component<typeof this> {
            <template><p>Confirmed counter <@fields.count /></p></template>
          };
        }`,
      'counter.json': {
        data: {
          attributes: { count: 7 },
          meta: { adoptsFrom: { module: rri('./counter'), name: 'Counter' } },
        },
      },
    },
    onRealmSetup({ dbAdapter, testRealm }) {
      db = dbAdapter;
      realm = testRealm;
      const execute = db.execute.bind(db);
      db.execute = async (sql, opts) => {
        statements.push(sql);
        return execute(sql, opts);
      };
    },
  });
  test('a real ordinary write and Chrome render preserve output without managed-owner discovery', async (assert) => {
    assert.timeout(90_000);
    const afterJobId = await maxPrerenderHtmlJobId(db, root.href);
    await db.execute(
      "INSERT INTO lattice_owners(realm_url,owner_url,dirty_generation,published_generation,input_generation,definition_revision) VALUES($1,$2,999,0,0,'stale-fixture')",
      { bind: [root.href, root + 'counter.json'] },
    );
    statements = [];
    await realm.write(
      'counter.json',
      JSON.stringify({
        data: {
          attributes: { count: 8 },
          meta: { adoptsFrom: { module: './counter', name: 'Counter' } },
        },
      }),
    );
    await settlePrerenderHtmlJobs(db, root.href, { afterJobId });
    const row = await prerenderedHtmlRowFor(db, root + 'counter.json');
    assert.false(
      statements.some(latticeSQL),
      'task and visit loop do not query Lattice registries',
    );
    assert.strictEqual(row?.error_doc, null);
    assert.true(
      row?.isolated_html?.includes('Confirmed counter'),
      'existing template is rendered',
    );
    assert.true(
      row?.isolated_html?.includes('8'),
      'new card data reaches HTML',
    );
  });
});
