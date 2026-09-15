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
  type Prerenderer,
} from '@cardstack/runtime-common';
import { IndexRunner } from '@cardstack/runtime-common/index-runner';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { latticeMaterialize } from '@cardstack/runtime-common/tasks/lattice';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const ordinaryRealm = 'https://lattice-opt-in.example/ordinary/';
const enabledRealm = 'https://lattice-opt-in.example/enabled/';

module('lattice-opt-in-test.ts | config', function () {
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

module('lattice-opt-in-test.ts | writer', function (hooks) {
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

  test('a full event backlog rejects source promotion without losing transitions and retries after matching', async function (assert) {
    let writer = new IndexWriter(db, {
      lattice: new LatticeRealmConfig([enabledRealm]),
    });
    let publication = writer.latticePublication(lookup, network);
    let url = new URL(enabledRealm + 'card.json');
    let source = await writer.createBatch(new URL(enabledRealm), network);
    await source.updateEntry(url, entry(enabledRealm, 1, 0));
    await source.done({ lattice: publication });
    let changed = await writer.createBatch(new URL(enabledRealm), network);
    await changed.updateEntry(url, entry(enabledRealm, 2, 0));
    await changed.done({ lattice: publication, latticeRealmUsername: 'test' });

    // Bulk fixture of independent, unmatched inputs in the same generation.
    // Keep one real owner transition so the normal matcher also exercises it.
    await db.execute(
      `INSERT INTO lattice_index_events (realm_url, generation, url, next_row)
       SELECT $1::text, 2, $1 || 'padding/' || n || '.json',
         jsonb_build_object('url', $1 || 'padding/' || n || '.json',
           'type', 'instance', 'search_doc', jsonb_build_object('value', n),
           'types', '[]'::jsonb)
       FROM generate_series(1, 99999) n`,
      { bind: [enabledRealm] },
    );
    let overflow = await writer.createBatch(new URL(enabledRealm), network);
    await overflow.updateEntry(url, entry(enabledRealm, 3, 0));
    await assert.rejects(
      overflow.done({ lattice: publication, latticeRealmUsername: 'test' }),
      /Lattice index event backlog limit.*drain.*retry/,
    );
    let [row] = await db.execute(
      `SELECT generation, pristine_doc->'attributes'->>'value' AS value
       FROM boxel_index WHERE realm_url=$1 AND url=$2 AND type='instance'`,
      { bind: [enabledRealm, url.href] },
    );
    assert.strictEqual(
      Number(row.generation),
      2,
      'source promotion rolled back',
    );
    assert.strictEqual(row.value, '2', 'failed generation is not exposed');
    let count = async () =>
      Number(
        (
          await db.execute(
            'SELECT count(*) FROM lattice_index_events WHERE realm_url=$1',
            { bind: [enabledRealm] },
          )
        )[0].count,
      );
    assert.strictEqual(
      await count(),
      100000,
      'no pending transition was dropped',
    );
    assert.true(await publication.hasUnmatched(enabledRealm));
    let checkpoints = await db.execute(
      'SELECT generation FROM lattice_pending_generations WHERE realm_url=$1 ORDER BY generation',
      { bind: [enabledRealm] },
    );
    assert.deepEqual(
      checkpoints.map((r) => Number(r.generation)),
      [2],
    );

    let ordinary = await writer.createBatch(new URL(ordinaryRealm), network);
    await ordinary.updateEntry(
      new URL(ordinaryRealm + 'card.json'),
      entry(ordinaryRealm, 4),
    );
    await ordinary.done();
    assert.strictEqual(
      await count(),
      100000,
      'ordinary writes leave this backlog alone',
    );

    assert.true(await publication.matchPending(enabledRealm, 'test'));
    assert.strictEqual(
      await count(),
      99750,
      'only a committed matching chunk frees capacity',
    );
    let retry = await writer.createBatch(new URL(enabledRealm), network);
    await retry.updateEntry(url, entry(enabledRealm, 3, 0));
    await retry.done({ lattice: publication, latticeRealmUsername: 'test' });
    assert.strictEqual(
      await count(),
      99751,
      'retry records its own transition',
    );
    [row] = await db.execute(
      `SELECT generation, pristine_doc->'attributes'->>'value' AS value
       FROM boxel_index WHERE realm_url=$1 AND url=$2 AND type='instance'`,
      { bind: [enabledRealm, url.href] },
    );
    assert.strictEqual(Number(row.generation), 3);
    assert.strictEqual(row.value, '3');
    assert.true(
      await publication.hasUnmatched(enabledRealm),
      'remaining obligations stay pending',
    );
  });

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

  test('successful full indexing refreshes PostgreSQL planner statistics only for enabled realms', async function (assert) {
    let writer = new IndexWriter(db, {
      lattice: new LatticeRealmConfig([enabledRealm]),
    });
    let definitions = {
      ...lookup,
      forRealm() {
        return this;
      },
    } as unknown as DefinitionLookup;
    let run = (realm: string, fail = false) =>
      IndexRunner.fromScratch(
        new IndexRunner({
          realmURL: new URL(realm),
          indexWriter: writer,
          virtualNetwork: network,
          definitionLookup: definitions,
          reader: {
            mtimes: async () => {
              if (fail) throw new Error('source unavailable');
              return { [realm + 'card.json']: 1 };
            },
            readFile: async () => undefined,
            readStream: async () => undefined,
          },
          prerenderer: {
            prerenderVisit: async () => {
              throw new Error('unchanged source must not render');
            },
          } as unknown as Prerenderer,
          auth: 'test',
          fetch: globalThis.fetch,
          realmOwnerUserId: '@test:matrix.example',
          latticeRealmUsername: 'test',
        }),
      );
    for (let realm of [ordinaryRealm, enabledRealm]) {
      let batch = await writer.createBatch(new URL(realm), network);
      await batch.updateEntry(new URL(realm + 'card.json'), entry(realm, 1));
      await batch.done();
    }
    let before = statements.length;
    await run(ordinaryRealm);
    assert.false(
      statements.slice(before).some((sql) => /^ANALYZE\b/i.test(sql)),
      'flag off retains ordinary full-index statements',
    );
    before = statements.length;
    await run(enabledRealm);
    assert.strictEqual(
      statements.slice(before).filter((sql) => /^ANALYZE\b/i.test(sql)).length,
      1,
    );
    let [stats] = await db.execute(
      "SELECT reltuples::int AS rows FROM pg_class WHERE oid='boxel_index'::regclass",
    );
    let [actual] = await db.execute(
      'SELECT count(*)::int AS rows FROM boxel_index',
    );
    assert.strictEqual(
      stats.rows,
      actual.rows,
      'planner sees the actual tiny fixture after the committed full index',
    );
    before = statements.length;
    await assert.rejects(run(enabledRealm, true), /source unavailable/);
    assert.false(
      statements.slice(before).some((sql) => /^ANALYZE\b/i.test(sql)),
      'failed full indexing does not refresh statistics',
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
