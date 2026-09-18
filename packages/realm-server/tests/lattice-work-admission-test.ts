import QUnit from 'qunit';
import { basename } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  VirtualNetwork,
  rri,
  type DefinitionLookup,
  type InstanceEntry,
  type JobInfo,
  type Prerenderer,
} from '@cardstack/runtime-common';
import { IndexRunner } from '@cardstack/runtime-common/index-runner';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import type { LatticeNativeCardIndexer } from '@cardstack/runtime-common/lattice-native-index';
import { LatticeWorkSuperseded } from '@cardstack/runtime-common/lattice-work';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-work-admission.example/';
const owner = realm + 'Dashboard/one.json';
const actor = '@reader:example';
const root = { module: rri(realm + 'cards'), name: 'Dashboard' };
const resource = {
  id: owner.slice(0, -5),
  type: 'card' as const,
  attributes: { count: 7 },
  meta: { adoptsFrom: root },
};

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let writer: IndexWriter;
  let network: VirtualNetwork;
  const lookup = {
    forRealm() {
      return this;
    },
    async lookupDefinition() {
      return {
        type: 'card-def',
        codeRef: { module: rri(realm + 'cards'), name: 'Record' },
        displayName: 'Record',
        fields: {},
        fieldDefs: {},
      };
    },
  } as unknown as DefinitionLookup;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      writer = new IndexWriter(db, {
        lattice: new LatticeRealmConfig([realm]),
      });
      network = new VirtualNetwork();
      await db.execute(
        "INSERT INTO realm_generations(realm_url,current_generation,loader_epoch) VALUES($1,5,'epoch')",
        { bind: [realm] },
      );
      await db.execute('INSERT INTO realm_metadata(url) VALUES($1)', {
        bind: [realm],
      });
      await db.execute(
        'INSERT INTO realm_user_permissions(realm_url,username,read,write) VALUES($1,$2,TRUE,FALSE)',
        { bind: [realm, actor] },
      );
      await db.execute(
        `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired)
        VALUES($1,$2,4,3,5,'epoch',FALSE)`,
        { bind: [realm, owner] },
      );
      await db.execute(
        `INSERT INTO boxel_index(url,file_alias,realm_url,type,generation,pristine_doc,search_doc,types)
        VALUES($1,$2,$3,'instance',4,$4,'{}',$5)`,
        {
          bind: [
            owner,
            owner.slice(0, -5),
            realm,
            JSON.stringify(resource),
            JSON.stringify([`${realm}cards/Dashboard`]),
          ],
        },
      );
    },
  });

  const changes = {
    obligation: async () =>
      db.execute('UPDATE lattice_owners SET dirty_generation=6'),
    source: async () =>
      db.execute(
        `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args) VALUES('incremental-index',$1,10,10,'{}')`,
        { bind: ['indexing:' + realm] },
      ),
    matching: async () =>
      db.execute(
        "INSERT INTO lattice_pending_generations(realm_url,generation,definition_revision) VALUES($1,5,'epoch')",
        { bind: [realm] },
      ),
    retired: async () => db.execute('UPDATE lattice_owners SET retired=TRUE'),
    satisfied: async () =>
      db.execute('UPDATE lattice_owners SET dirty_generation=NULL'),
    generation: async () =>
      db.execute('UPDATE realm_generations SET current_generation=6'),
    epoch: async () =>
      db.execute("UPDATE realm_generations SET loader_epoch='new-code'"),
    analysis: async () => {
      const fileURL = realm + 'cards.gts';
      await db.execute(
        "INSERT INTO lattice_code_artifacts(realm_url,file_url,realm_username) VALUES($1,$2,'reader')",
        { bind: [realm, fileURL] },
      );
      await db.execute(
        'INSERT INTO lattice_owner_code(realm_url,owner_url,generation,reference) VALUES($1,$2,4,$3)',
        { bind: [realm, owner, JSON.stringify({ fileURL })] },
      );
    },
    permission: async () =>
      db.execute('UPDATE realm_user_permissions SET read=FALSE'),
    archive: async () =>
      db.execute('UPDATE realm_metadata SET archived_at=NOW()'),
  };

  function runner(
    read: () => Promise<void>,
    native?: LatticeNativeCardIndexer,
    browser?: () => Promise<never>,
    jobInfo?: JobInfo,
  ) {
    const unexpected = async (): Promise<never> => {
      throw new Error('Unexpected producer entry');
    };
    const prerenderer: Prerenderer = {
      prerenderVisit: browser ?? unexpected,
      prerenderModule: unexpected,
      runCommand: unexpected,
    };
    return new IndexRunner({
      realmURL: new URL(realm),
      jobInfo,
      indexWriter: writer,
      virtualNetwork: network,
      definitionLookup: lookup,
      realmOwnerUserId: actor,
      auth: '',
      fetch: network.fetch,
      nativeCardIndexer: native,
      prerenderer,
      reader: {
        readFile: async () => {
          await read();
          return {
            path: 'Dashboard/one.json',
            content: JSON.stringify({ data: resource }),
            lastModified: 1,
            created: 1,
          };
        },
        mtimes: async () => ({ [owner]: 1 }),
        readStream: unexpected,
      },
    });
  }

  async function unchanged(assert: Assert) {
    const [row] = await db.execute(
      "SELECT pristine_doc,generation FROM boxel_index WHERE url=$1 AND type='instance'",
      { bind: [owner] },
    );
    assert.deepEqual(
      row.pristine_doc,
      resource,
      'no obsolete or error output was promoted',
    );
    assert.strictEqual(Number(row.generation), 4);
    const [obligation] = await db.execute(
      'SELECT published_generation FROM lattice_owners WHERE owner_url=$1',
      { bind: [owner] },
    );
    assert.strictEqual(
      Number(obligation.published_generation),
      4,
      'the old receipt is not republished',
    );
  }

  for (const placement of ['native', 'chrome'])
    for (const [reason, change] of Object.entries(changes))
      test(`${reason} after source read prevents ${placement} execution`, async (assert) => {
        let calls = 0;
        const trip = async (): Promise<never> => {
          calls++;
          throw new Error('Obsolete producer was entered');
        };
        const attempt = runner(
          async () => {
            await change();
          },
          placement === 'native' ? trip : undefined,
          trip,
        );
        const result = await IndexRunner.materialize(
          attempt,
          'reader',
          0,
        ).catch((error: unknown) => ({ error }));
        assert.strictEqual(calls, 0, 'obsolete work never enters a producer');
        assert.true(
          Boolean('superseded' in result ? result.superseded : undefined),
          'a scheduling outcome, not a computation failure',
        );
        if ('waitForRead' in result)
          assert.deepEqual(
            result.waitForRead,
            ['permission', 'archive'].includes(reason)
              ? { realmURL: realm, actor }
              : undefined,
          );
        await unchanged(assert);
      });

  test('a native decline cannot send superseded work into Chrome', async (assert) => {
    let calls = 0;
    const attempt = runner(
      async () => {},
      async () => {
        await changes.obligation();
        return undefined;
      },
      async () => {
        calls++;
        throw new Error('Stale fallback');
      },
    );
    const result = await IndexRunner.materialize(attempt, 'reader', 0).catch(
      (error: unknown) => ({ error }),
    );
    assert.strictEqual(calls, 0);
    assert.true(
      Boolean('superseded' in result ? result.superseded : undefined),
    );
    await unchanged(assert);
  });

  test('browser query preparation cannot hide a new source obligation', async (assert) => {
    let calls = 0,
      warmed = false;
    const execute = db.execute.bind(db);
    db.execute = async (sql, options) => {
      const result = await execute(sql, options);
      if (sql.includes('SELECT query FROM lattice_query_watches')) {
        warmed = true;
        await changes.obligation();
      }
      return result;
    };
    const attempt = runner(
      async () => {},
      undefined,
      async () => {
        calls++;
        throw new Error('Stale prepared work');
      },
    );
    const result = await IndexRunner.materialize(attempt, 'reader', 0).catch(
      (error: unknown) => ({ error }),
    );
    assert.true(warmed, 'the race was reached');
    assert.strictEqual(calls, 0);
    assert.true(
      Boolean('superseded' in result ? result.superseded : undefined),
    );
    await unchanged(assert);
  });

  test('new ordinary writes immediately join source backlog and preserve admission fences', async (assert) => {
    const registry = writer.latticePublication(lookup, network).registry;
    const [job] = await db.execute(
      `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args)
       VALUES('incremental-index',$1,10,10,'{}') RETURNING id`,
      { bind: ['indexing:' + realm] },
    );
    for (const batch of [
      { atomic: false, immediate: false },
      { atomic: false, immediate: true },
      { atomic: true },
      null,
    ]) {
      await db.execute('UPDATE jobs SET args=$1 WHERE id=$2', {
        bind: [JSON.stringify({ latticeBatch: batch }), job.id],
      });
      assert.true(await registry.hasSourceBacklog(realm));
      await assert.rejects(
        registry.assertWorkCurrent(receipt),
        /new source work has priority/,
      );
    }
    await changes.generation();
    await assert.rejects(
      registry.assertWorkCurrent(receipt),
      LatticeWorkSuperseded,
      'removing the collection delay never bypasses generation fences',
    );
  });

  test('another realm source job does not suppress eligible work', async (assert) => {
    let calls = 0;
    const entered = new Error('Producer boundary reached');
    const attempt = runner(
      async () => {
        await db.execute(
          `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args) VALUES('incremental-index','indexing:https://other.example/',10,10,'{}')`,
        );
      },
      undefined,
      async () => {
        calls++;
        throw entered;
      },
    );
    await assert.rejects(
      IndexRunner.materialize(attempt, 'reader', 0),
      /Producer boundary reached/,
    );
    assert.strictEqual(calls, 1);
    await unchanged(assert);
  });

  const receipt = {
    realmURL: realm,
    actor,
    claim: { id: owner, obligation: 5 },
    inputGeneration: 5,
    definitionRevision: 'epoch',
  };
  test('continuation ignores queued priority but not changed inputs or authority', async (assert) => {
    const registry = writer.latticePublication(lookup, network).registry;
    await registry.assertWorkCurrent(receipt);
    await db.execute(
      `INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args)
       VALUES('incremental-index',$1,10,10,'{}')`,
      { bind: ['indexing:' + realm] },
    );
    await assert.rejects(
      registry.assertWorkCurrent(receipt),
      /new source work has priority/,
    );
    await registry.assertWorkCurrent(receipt, undefined, {
      phase: 'continuation',
    });
    await changes.obligation();
    await assert.rejects(
      registry.assertWorkCurrent(receipt, undefined, { phase: 'continuation' }),
      /newer owner obligation/,
    );
    await db.execute('UPDATE lattice_owners SET dirty_generation=5');
    await db.execute('UPDATE realm_generations SET current_generation=6');
    await assert.rejects(
      registry.assertWorkCurrent(receipt, undefined, { phase: 'continuation' }),
      /input or module revision changed/,
    );
    await db.execute('UPDATE realm_generations SET current_generation=5');
    await db.execute('UPDATE realm_user_permissions SET read=FALSE');
    await assert.rejects(
      registry.assertWorkCurrent(receipt, undefined, { phase: 'continuation' }),
      /read authority changed/,
    );
  });
  for (const [reason, change] of Object.entries(changes))
    test(`failure recording fences ${reason} without consuming the current budget`, async (assert) => {
      await change();
      const publication = writer.latticePublication(lookup, network);
      await assert.rejects(
        publication.failWork(receipt, 'obsolete computation', 'reader', 0),
        LatticeWorkSuperseded,
      );
      assert.deepEqual(
        await db.execute('SELECT * FROM lattice_work_failures'),
        [],
      );
      await unchanged(assert);
    });

  test('an expired failure receipt cannot suppress a replacement claim', async (assert) => {
    const jobInfo = await reserve();
    await db.execute(
      'UPDATE job_reservations SET locked_until=clock_timestamp() WHERE id=$1',
      { bind: [jobInfo.reservationId] },
    );
    await assert.rejects(
      writer
        .latticePublication(lookup, network)
        .failWork(
          { ...receipt, reservation: jobInfo },
          'expired computation',
          'reader',
          0,
        ),
      LatticeWorkSuperseded,
    );
    assert.deepEqual(
      await db.execute('SELECT * FROM lattice_work_failures'),
      [],
    );
    await unchanged(assert);
  });

  test('failure and successor roll back together on a queue write failure', async (assert) => {
    await db.execute(
      "CREATE FUNCTION reject_lattice_successor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'queue write unavailable'; END $$",
    );
    await db.execute(
      'CREATE TRIGGER reject_lattice_successor BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION reject_lattice_successor()',
    );
    await assert.rejects(
      writer
        .latticePublication(lookup, network)
        .failWork(receipt, 'temporary failure', 'reader', 0),
      /queue write unavailable/,
    );
    assert.deepEqual(
      await db.execute('SELECT * FROM lattice_work_failures'),
      [],
      'no lost retry without its durable wake-up',
    );
    await unchanged(assert);
  });

  test('file-owned code revisions renew retry eligibility without moving the realm clock', async (assert) => {
    const fileURL = realm + 'cards.gts';
    await db.execute(
      "INSERT INTO lattice_code_artifacts(realm_url,file_url,realm_username,dirty) VALUES($1,$2,'reader',FALSE)",
      { bind: [realm, fileURL] },
    );
    await db.execute(
      'INSERT INTO lattice_owner_code(realm_url,owner_url,generation,reference) VALUES($1,$2,4,$3)',
      { bind: [realm, owner, JSON.stringify({ fileURL })] },
    );
    const publication = writer.latticePublication(lookup, network);
    const [selected] = await publication.registry.ready(realm);
    assert.ok(selected.codeVersion);
    const work = { ...receipt, codeVersion: selected.codeVersion };
    for (let i = 0; i < 3; i++)
      await publication.failWork(work, 'bad formula', 'reader', 0);
    assert.deepEqual(
      await publication.registry.ready(realm),
      [],
      'unchanged code exhausts its budget',
    );
    await db.execute(
      'UPDATE lattice_code_artifacts SET work_version=work_version+1 WHERE realm_url=$1',
      { bind: [realm] },
    );
    const [fresh] = await publication.registry.ready(realm);
    assert.strictEqual(fresh.ownerURL, owner);
    assert.notEqual(fresh.codeVersion, selected.codeVersion);
    await assert.rejects(
      publication.failWork(work, 'obsolete code failure', 'reader', 0),
      LatticeWorkSuperseded,
    );
    await publication.failWork(
      { ...receipt, codeVersion: fresh.codeVersion },
      'new formula failed',
      'reader',
      0,
    );
    const [failure] = await db.execute(
      'SELECT attempts,code_version FROM lattice_work_failures',
    );
    assert.strictEqual(
      failure.attempts,
      1,
      'old attempts never spend the new code budget',
    );
    assert.strictEqual(failure.code_version, fresh.codeVersion);
    await unchanged(assert);
  });

  async function reserve(): Promise<JobInfo> {
    const [job] = await db.execute(
      "INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args) VALUES('lattice-materialize',$1,8,600,$2) RETURNING id",
      {
        bind: [
          'indexing:' + realm,
          JSON.stringify({ realmURL: realm, realmUsername: 'reader' }),
        ],
      },
    );
    const [reservation] = await db.execute(
      "INSERT INTO job_reservations(job_id,worker_id,locked_until) VALUES($1,'lattice-admission-test',clock_timestamp()+INTERVAL '10 minutes') RETURNING id",
      { bind: [job.id] },
    );
    return {
      jobId: Number(job.id),
      reservationId: Number(reservation.id),
      priority: 8,
      queueWaitMs: 0,
    };
  }

  for (const placement of ['native', 'chrome'])
    test(`a lease lost during source reading prevents ${placement} execution`, async (assert) => {
      const jobInfo = await reserve();
      let calls = 0;
      const trip = async (): Promise<never> => {
        calls++;
        throw new Error('Expired producer entered');
      };
      const attempt = runner(
        async () => {
          await db.execute(
            'UPDATE job_reservations SET locked_until=clock_timestamp() WHERE id=$1',
            { bind: [jobInfo.reservationId] },
          );
        },
        placement === 'native' ? trip : undefined,
        trip,
        jobInfo,
      );
      const result = await IndexRunner.materialize(attempt, 'reader', 0).catch(
        (error: unknown) => ({ error }),
      );
      assert.strictEqual(calls, 0);
      assert.strictEqual(
        'superseded' in result ? result.superseded : undefined,
        'queue reservation no longer current',
      );
      await unchanged(assert);
    });

  for (const state of ['expired', 'completed', 'job-done', 'wrong-group'])
    test(`publication rejects a ${state} queue reservation with unchanged inputs`, async (assert) => {
      const jobInfo = await reserve();
      const publication = writer.latticePublication(lookup, network);
      const batch = await staged();
      // Change the lease after this publication transaction has begun. For
      // expiration, transaction NOW() is too old; use the actual check time.
      batch.registerLatticePublicationCheck(owner, async () => {
        if (state === 'expired')
          await db.execute(
            'UPDATE job_reservations SET locked_until=clock_timestamp() WHERE id=$1',
            { bind: [jobInfo.reservationId] },
          );
        else if (state === 'completed')
          await db.execute(
            'UPDATE job_reservations SET completed_at=NOW() WHERE id=$1',
            { bind: [jobInfo.reservationId] },
          );
        else if (state === 'job-done')
          await db.execute("UPDATE jobs SET status='resolved' WHERE id=$1", {
            bind: [jobInfo.jobId],
          });
        else
          await db.execute(
            "UPDATE jobs SET concurrency_group='indexing:https://other.example/' WHERE id=$1",
            { bind: [jobInfo.jobId] },
          );
      });
      const reserved = { ...receipt, reservation: jobInfo };
      batch.registerLatticePublicationCheck(owner, (tx) =>
        publication.registry.assertWorkCurrent(reserved, tx),
      );
      await assert.rejects(
        batch.done({ lattice: publication, latticeInputGeneration: 5 }),
        (error: unknown) =>
          error instanceof LatticeWorkSuperseded &&
          error.reason === 'queue reservation no longer current',
      );
      await unchanged(assert);
    });

  async function staged() {
    const batch = await writer.createBatch(new URL(realm), network);
    const entry: InstanceEntry = {
      type: 'instance',
      lastModified: 1,
      resourceCreatedAt: 1,
      resource: {
        ...resource,
        id: rri(owner.slice(0, -5)),
        attributes: { count: 999 },
        meta: {
          ...resource.meta,
          publication: {
            version: 1,
            state: 'ready',
            computedFields: ['count'],
            queryFields: [],
            watches: [],
            validatedThrough: 5,
          },
        },
      },
      searchData: { count: 999 },
      types: [`${realm}cards/Dashboard`],
      displayNames: ['Dashboard'],
      deps: new Set([realm + 'cards']),
    };
    await batch.updateEntry(new URL(owner), entry);
    return batch;
  }

  for (const reason of [
    'obligation',
    'source',
    'retired',
    'epoch',
    'permission',
    'archive',
  ] as const)
    test(`publication rechecks ${reason} after staging and composes with native validation`, async (assert) => {
      const publication = writer.latticePublication(lookup, network);
      const batch = await staged();
      batch.registerLatticePublicationCheck(owner, (tx) =>
        publication.registry.assertWorkCurrent(receipt, tx),
      );
      let nativeChecks = 0;
      batch.registerLatticeNativeResult(owner, async () => {
        nativeChecks++;
      });
      await changes[reason]();
      await assert.rejects(
        batch.done({ lattice: publication, latticeInputGeneration: 5 }),
        (error: unknown) => error instanceof LatticeWorkSuperseded,
      );
      assert.strictEqual(
        nativeChecks,
        0,
        'the earlier work guard was not replaced by native registration',
      );
      await unchanged(assert);
    });

  test('registering a work guard cannot replace an earlier native input fence', async (assert) => {
    const publication = writer.latticePublication(lookup, network);
    const batch = await staged();
    const failure = new Error('Native input receipt changed');
    batch.registerLatticeNativeResult(owner, async () => {
      throw failure;
    });
    batch.registerLatticePublicationCheck(owner, (tx) =>
      publication.registry.assertWorkCurrent(receipt, tx),
    );
    await assert.rejects(
      batch.done({ lattice: publication, latticeInputGeneration: 5 }),
      (error: unknown) => error === failure,
    );
    await unchanged(assert);
  });

  test('a failed work-state read stays an error rather than becoming supersession', async (assert) => {
    const failure = new Error('Database unavailable');
    const execute = db.execute.bind(db);
    db.execute = async (sql, options) => {
      if (sql.includes('AS code_ready')) throw failure;
      return execute(sql, options);
    };
    const publication = writer.latticePublication(lookup, network);
    await assert.rejects(
      publication.registry.assertWorkCurrent(receipt),
      (error: unknown) => error === failure,
    );
    await unchanged(assert);
  });
});
