import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  VirtualNetwork,
  rri,
  logger,
  type DefinitionLookup,
  type InstanceEntry,
  type QueuePublisher,
} from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { latticeMaterialize } from '@cardstack/runtime-common/tasks/lattice';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const ordinaryRealm = 'https://lattice-opt-in.example/ordinary/';
const enabledRealm = 'https://lattice-opt-in.example/enabled/';

module('Lattice | explicit realm configuration', function () {
  test('missing configuration is off and enablement matches exact roots', function (assert) {
    assert.false(LatticeRealmConfig.parse(undefined).isEnabled(enabledRealm));
    assert.false(LatticeRealmConfig.parse('').isEnabled(enabledRealm));
    let realms = [enabledRealm];
    let config = new LatticeRealmConfig(realms);
    assert.deepEqual(config.enabledRealms, [enabledRealm]);
    assert.true(
      Object.isFrozen(config.enabledRealms),
      'SQL adapter policy cannot be mutated',
    );
    realms.push(ordinaryRealm);
    assert.true(config.isEnabled(enabledRealm));
    assert.true(config.isEnabled(new URL(enabledRealm)));
    assert.false(
      config.isEnabled(ordinaryRealm),
      'caller mutations cannot opt in another realm',
    );
    assert.false(
      config.isEnabled(enabledRealm + 'child/'),
      'no implicit descendant enablement',
    );
    assert.false(config.isEnabled(enabledRealm.replace('https:', 'http:')));
  });

  test('operator input must be an explicit list of HTTP realm roots', function (assert) {
    assert.true(
      LatticeRealmConfig.parse(JSON.stringify([enabledRealm])).isEnabled(
        enabledRealm,
      ),
    );
    for (let value of ['true', '"*"', '{}', '[null]', '[1]']) {
      assert.throws(() => LatticeRealmConfig.parse(value), /JSON array/, value);
    }
    for (let value of [
      '*',
      'file:///tmp/',
      enabledRealm + '?all=true',
      enabledRealm + '#all',
      enabledRealm.slice(0, -1),
    ]) {
      assert.throws(
        () => LatticeRealmConfig.parse(JSON.stringify([value])),
        undefined,
        value,
      );
    }
  });
});

module('Lattice | writer opt-in', function (hooks) {
  let db: PgAdapter;
  let publisher: QueuePublisher;
  let statements: string[];
  let locks: string[];
  setupDB(hooks, {
    beforeEach: async (adapter, queuePublisher) => {
      db = adapter;
      publisher = queuePublisher;
      statements = [];
      locks = [];
      let execute = db.execute.bind(db);
      db.execute = (...args) => {
        statements.push(args[0]);
        return execute(...args);
      };
      let withWriteLock = db.withWriteLock.bind(db);
      db.withWriteLock = async (key, fn) => {
        locks.push(key);
        return withWriteLock(key, fn);
      };
    },
  });

  let network = new VirtualNetwork();
  let lookup = {
    async lookupDefinition() {
      throw new Error(
        'A publication with no query watches needs no definition',
      );
    },
  } as unknown as DefinitionLookup;

  function entry(
    realm: string,
    value: number,
    inputGeneration?: number,
  ): InstanceEntry {
    return {
      type: 'instance',
      lastModified: 1,
      resourceCreatedAt: 1,
      resource: {
        id: rri(realm + 'card'),
        type: 'card',
        attributes: { value },
        meta: {
          adoptsFrom: { module: rri(realm + 'model'), name: 'Value' },
          ...(inputGeneration !== undefined
            ? {
                publication: {
                  version: 1 as const,
                  state: 'pending' as const,
                  computedFields: ['value'],
                  queryFields: [],
                  watches: [],
                  validatedThrough: inputGeneration,
                },
              }
            : {}),
        },
      },
      searchData: { value },
      types: [realm + 'model/Value'],
      displayNames: ['Value'],
      deps: new Set(),
    };
  }

  function applicationLatticeSQL() {
    return statements.filter((sql) => /\b(lattice_|lattice_)/.test(sql));
  }

  test('enabled batch setup initializes archive locking without changing authority', async function (assert) {
    let writer = new IndexWriter(db, {
      lattice: new LatticeRealmConfig([enabledRealm]),
    });
    await writer.createBatch(new URL(ordinaryRealm), network);
    assert.false(
      statements.some((sql) => sql.includes('realm_metadata')),
      'ordinary setup does not read or write metadata for Lattice',
    );
    assert.deepEqual(
      await db.execute('SELECT url FROM realm_metadata WHERE url=$1', {
        bind: [ordinaryRealm],
      }),
      [],
    );
    await writer.createBatch(new URL(enabledRealm), network);
    assert.deepEqual(
      await db.execute('SELECT archived_at FROM realm_metadata WHERE url=$1', {
        bind: [enabledRealm],
      }),
      [{ archived_at: null }],
      'a static enabled realm now has an archive row to lock',
    );
    assert.deepEqual(
      await db.execute(
        'SELECT * FROM realm_user_permissions WHERE realm_url=$1',
        {
          bind: [enabledRealm],
        },
      ),
      [],
      'initialization grants no permissions',
    );
    await db.execute(
      'UPDATE realm_metadata SET archived_at=NOW(), publishable=FALSE WHERE url=$1',
      { bind: [enabledRealm] },
    );
    const before = await db.execute(
      'SELECT xmin::text AS revision,archived_at,publishable FROM realm_metadata WHERE url=$1',
      { bind: [enabledRealm] },
    );
    await writer.createBatch(new URL(enabledRealm), network);
    assert.deepEqual(
      await db.execute(
        'SELECT xmin::text AS revision,archived_at,publishable FROM realm_metadata WHERE url=$1',
        { bind: [enabledRealm] },
      ),
      before,
      'repeated setup preserves existing metadata, its version and archive',
    );
  });

  test('one writer preserves ordinary updates/deletes while publishing an enabled realm', async function (assert) {
    let writer = new IndexWriter(db, {
      lattice: new LatticeRealmConfig([enabledRealm]),
    });
    let ordinaryURL = new URL('card.json', ordinaryRealm);
    let batch = await writer.createBatch(new URL(ordinaryRealm), network);
    assert.false(batch.latticeEnabled);
    assert.strictEqual((await batch.getModifiedTimes()).size, 0);
    await batch.updateEntry(ordinaryURL, entry(ordinaryRealm, 1));
    await batch.done();
    let deletion = await writer.createBatch(new URL(ordinaryRealm), network);
    await deletion.invalidate([ordinaryURL]);
    await deletion.done();
    assert.deepEqual(locks, [], 'ordinary publication takes no Lattice lock');
    assert.deepEqual(
      applicationLatticeSQL(),
      [],
      'ordinary discovery, invalidation and swaps issue no Lattice SQL',
    );
    let [deleted] = await db.execute(
      "SELECT is_deleted FROM boxel_index WHERE url=$1 AND type='instance'",
      { bind: [ordinaryURL.href] },
    );
    assert.true(deleted.is_deleted, 'the ordinary deletion still publishes');

    let enabled = await writer.createBatch(new URL(enabledRealm), network);
    assert.true(enabled.latticeEnabled);
    await enabled.updateEntry(
      new URL('card.json', enabledRealm),
      entry(enabledRealm, 7, 0),
    );
    await enabled.done({ lattice: writer.latticePublication(lookup, network) });
    // First registration is pending. Only a subsequent computation against
    // that committed generation may publish a ready snapshot.
    let computed = await writer.createBatch(new URL(enabledRealm), network);
    await computed.updateEntry(
      new URL('card.json', enabledRealm),
      entry(enabledRealm, 7, enabled.currentGeneration),
    );
    await computed.done({
      lattice: writer.latticePublication(lookup, network),
      latticeInputGeneration: enabled.currentGeneration,
    });
    assert.deepEqual(
      locks,
      [`lattice:index:${enabledRealm}`, `lattice:index:${enabledRealm}`],
      'only enabled publication takes the guarded lock',
    );
    let [published] = await db.execute(
      `SELECT pristine_doc->'attributes' AS attributes,
              pristine_doc->'meta'->'publication'->>'state' AS state
       FROM boxel_index WHERE realm_url=$1 AND type='instance'`,
      { bind: [enabledRealm] },
    );
    assert.deepEqual(published.attributes, { value: 7 });
    assert.strictEqual(
      published.state,
      'ready',
      'enabled computed output remains guarded and ready',
    );

    statements = [];
    locks = [];
    let next = await writer.createBatch(new URL(ordinaryRealm), network);
    await next.getModifiedTimes();
    await next.updateEntry(ordinaryURL, entry(ordinaryRealm, 2));
    await next.done();
    assert.deepEqual(
      applicationLatticeSQL(),
      [],
      'enabled work does not leak into the next ordinary swap',
    );
    assert.deepEqual(locks, []);
  });

  test('publication options and native closures cannot enable an unconfigured realm', async function (assert) {
    let writer = new IndexWriter(db);
    let batch = await writer.createBatch(new URL(ordinaryRealm), network);
    assert.throws(
      () =>
        batch.registerLatticeNativeResult(
          ordinaryRealm + 'card',
          async () => {},
        ),
      /Lattice is disabled/,
    );
    assert.throws(
      () =>
        batch.registerLatticePublicationCheck(
          ordinaryRealm + 'card',
          async () => {},
        ),
      /Lattice is disabled/,
    );
    await assert.rejects(
      batch.done({ lattice: writer.latticePublication(lookup, network) }),
      /Lattice is disabled/,
    );
    assert.deepEqual(applicationLatticeSQL(), []);
    assert.deepEqual(locks, []);
  });

  test('a previously queued disabled-realm job stops before reads or retry publication', async function (assert) {
    let statuses: string[] = [];
    let unexpectedWork = () => {
      throw new Error('A disabled job must not execute this dependency');
    };
    let task = latticeMaterialize({
      dbAdapter: db,
      queuePublisher: publisher,
      indexWriter: new IndexWriter(db),
      definitionLookup: lookup,
      virtualNetwork: network,
      log: logger('lattice-opt-in-test'),
      matrixURL: 'https://matrix.example/',
      getReader: unexpectedWork,
      getAuthedFetch: unexpectedWork,
      createPrerenderAuth: unexpectedWork,
      prerenderer: {
        prerenderVisit: unexpectedWork,
        prerenderModule: unexpectedWork,
        runCommand: unexpectedWork,
      },
      nativeCardIndexer: unexpectedWork,
      reportStatus: (_job, status) => statuses.push(status),
      reportRealmEvent: unexpectedWork,
    });
    await assert.rejects(
      task({
        realmURL: ordinaryRealm,
        realmUsername: 'operator',
        wave: 0,
        attempt: 0,
      }),
      /Lattice is disabled/,
    );
    assert.deepEqual(statuses, ['start', 'finish']);
    assert.deepEqual(
      statements,
      [],
      'no query, including permissions or retry enqueue',
    );
    assert.deepEqual(locks, []);
  });
});
