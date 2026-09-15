import QUnit from 'qunit';
import { basename } from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { PgAdapter } from '@cardstack/postgres';
import { IndexWriter, VirtualNetwork, param } from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { enqueueLattice } from '@cardstack/runtime-common/jobs/lattice';
import { finalizeOrphanedReservations } from '../lib/finalize-orphan-reservations.ts';
import { setupDB, waitUntil } from './helpers/index.ts';
import {
  workActor,
  workExecution,
  workOwner,
  workQuery,
  workRealms,
  workRef,
  workSource,
} from './helpers/lattice-work-fixture.ts';

const { module, test } = QUnit;
const [realmA, realmB] = workRealms;
type Message = {
  type: string;
  realmURL?: string;
  workerId: string;
  pid: number;
  id?: number;
  url?: string;
  attributes?: unknown;
  superseded?: string;
  jobInfo?: { jobId: number; reservationId: number };
};

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      const network = new VirtualNetwork();
      const execution = workExecution(db, network);
      const writer = new IndexWriter(db, {
        lattice: new LatticeRealmConfig(workRealms),
      });
      const publication = writer.latticePublication(execution.lookup, network);
      try {
        for (const [i, realm] of workRealms.entries()) {
          await db.execute(
            "INSERT INTO realm_generations(realm_url,current_generation,loader_epoch) VALUES($1,1,'epoch')",
            { bind: [realm] },
          );
          await db.execute('INSERT INTO realm_metadata(url) VALUES($1)', {
            bind: [realm],
          });
          await db.execute(
            'INSERT INTO realm_user_permissions(realm_url,username,read,write) VALUES($1,$2,TRUE,FALSE)',
            { bind: [realm, workActor] },
          );
          for (const [name, attributes, type] of [
            ['Record/one', { amount: 3 + i }, 'Record'],
            ['Record/two', { amount: 7 + i }, 'Record'],
            ['Dashboard/one', { count: 0, total: 0 }, 'Dashboard'],
          ] as const) {
            const id = realm + name;
            await db.execute(
              "INSERT INTO boxel_index(url,file_alias,realm_url,type,generation,is_deleted,has_error,pristine_doc,search_doc,types,deps) VALUES($1,$2,$3,'instance',1,FALSE,FALSE,$4,$5,$6,$7)",
              {
                bind: [
                  id + '.json',
                  id,
                  realm,
                  JSON.stringify({
                    id,
                    type: 'card',
                    attributes,
                    meta: { adoptsFrom: workRef(realm, type) },
                  }),
                  JSON.stringify({ id, ...attributes }),
                  JSON.stringify([`${realm}cards/${type}`]),
                  JSON.stringify([realm + 'cards']),
                ],
              },
            );
          }
          await db.withWriteLock('lattice:index:' + realm, async (tx) => {
            if (!tx) throw new Error('Expected publication transaction');
            await publication.registry.publish(tx, {
              realmURL: realm,
              ownerURL: workOwner(realm),
              generation: 1,
              inputGeneration: 0,
              definitionRevision: 'epoch',
              pending: true,
              watches: [
                { fieldPath: 'members', query: workQuery(realm), terms: [] },
              ],
            });
          });
        }
      } finally {
        await execution.worker.close();
      }
    },
  });

  async function enqueue(realm: string) {
    await db.withWriteLock('lattice:index:' + realm, async (tx) => {
      if (!tx) throw new Error('Expected transaction');
      await enqueueLattice(tx, realm, 'reader');
    });
  }
  async function owner(realm: string) {
    const [row] = await db.execute(
      `SELECT i.pristine_doc,i.generation,o.dirty_generation,o.published_generation
       FROM boxel_index i JOIN lattice_owners o ON o.realm_url=i.realm_url AND o.owner_url=i.url
       WHERE i.url=$1 AND i.type='instance'`,
      { bind: [workOwner(realm)] },
    );
    return row;
  }
  async function assertPublished(assert: Assert, realm: string) {
    await waitUntil(async () => (await owner(realm)).dirty_generation == null, {
      timeout: 15_000,
      interval: 20,
    });
    const row = await owner(realm);
    const doc = row.pristine_doc as any;
    assert.deepEqual(
      doc.attributes,
      { count: 2, total: realm === realmA ? 10 : 12 },
      'all computed values match the raw input oracle',
    );
    assert.strictEqual(doc.meta.publication.state, 'ready');
    assert.strictEqual(
      Number(row.published_generation),
      2,
      'exactly one owner publication',
    );
    assert.deepEqual(
      doc.relationships.members.data
        .map((ref: { id: string }) => ref.id)
        .sort(),
      [realm + 'Record/one', realm + 'Record/two'],
      'query membership is complete',
    );
  }

  async function scenario(
    assert: Assert,
    run: (
      start: (options?: {
        pauseRealm?: string;
        maxReservationCount?: number;
      }) => Promise<Processor>,
    ) => Promise<void>,
  ) {
    const children: Processor[] = [];
    async function start(options = {}) {
      const child = fork(
        fileURLToPath(
          new URL(
            './fixtures/lattice-materialization-processor.ts',
            import.meta.url,
          ),
        ),
        [],
        {
          env: { ...process.env },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        },
      );
      const processor = new Processor(child, db);
      children.push(processor);
      child.send(options);
      const ready = await processor.wait('ready');
      console.log(
        `LATTICE_WORK_QUEUE worker=${ready.workerId} pid=${ready.pid} parent=${process.pid}`,
      );
      assert.strictEqual(ready.pid, child.pid);
      assert.notStrictEqual(
        child.pid,
        process.pid,
        'materialization executes in a separate process',
      );
      return processor;
    }
    try {
      await run(start);
    } finally {
      for (const child of children) await child.kill();
    }
  }

  test('a permanently failing owner yields to healthy work in the same realm', async (assert) => {
    assert.timeout(60_000);
    const broken = realmA + 'Dashboard/000-broken.json';
    const dependent = realmA + 'Dashboard/zzz-dependent.json';
    await db.execute(
      `INSERT INTO boxel_index(url,file_alias,realm_url,type,generation,is_deleted,has_error,pristine_doc,search_doc,types,deps)
       SELECT $1,$2,realm_url,type,generation,is_deleted,has_error,pristine_doc,search_doc,types,deps
       FROM boxel_index WHERE url=$3`,
      { bind: [broken, broken.slice(0, -5), workOwner(realmA)] },
    );
    await db.execute(
      `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired)
       SELECT realm_url,$1,published_generation,input_generation,dirty_generation,definition_revision,retired
       FROM lattice_owners WHERE owner_url=$2`,
      { bind: [broken, workOwner(realmA)] },
    );
    await db.execute(
      `INSERT INTO boxel_index(url,file_alias,realm_url,type,generation,is_deleted,has_error,pristine_doc,search_doc,types,deps)
       SELECT $1,$2,realm_url,type,generation,is_deleted,has_error,pristine_doc,search_doc,types,$4
       FROM boxel_index WHERE url=$3`,
      {
        bind: [
          dependent,
          dependent.slice(0, -5),
          workOwner(realmA),
          JSON.stringify([broken]),
        ],
      },
    );
    await db.execute(
      `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired)
       SELECT realm_url,$1,published_generation,input_generation,dirty_generation,definition_revision,retired
       FROM lattice_owners WHERE owner_url=$2`,
      { bind: [dependent, workOwner(realmA)] },
    );
    const settled = () =>
      waitUntil(
        async () =>
          !(
            await db.execute(
              "SELECT 1 FROM jobs WHERE job_type='lattice-materialize' AND status='unfulfilled' LIMIT 1",
            )
          ).length,
        { timeout: 15_000, interval: 20 },
      );
    const failures = () =>
      db.execute('SELECT * FROM lattice_work_failures WHERE realm_url=$1', {
        bind: [realmA],
      });
    await scenario(assert, async (start) => {
      const worker = await start();
      worker.sources.set(broken, workSource(realmA, 'TruncatedDashboard'));
      await enqueue(realmA);
      await assertPublished(assert, realmA);
      const readURLs = worker.messages
        .filter((m) => m.type === 'read')
        .map((m) => m.url);
      assert.deepEqual(
        readURLs.slice(0, 2),
        [broken, workOwner(realmA)],
        'healthy work gets its first attempt before retrying the broken owner',
      );
      await settled();
      assert.deepEqual(
        (await failures()).map((f) => [
          f.owner_url,
          Number(f.obligation),
          f.definition_revision,
          f.attempts,
        ]),
        [[broken, 1, 'epoch', 3]],
        'budget survives the healthy publication advancing the realm clock',
      );
      assert.true(
        String((await failures())[0].reason).includes(
          'Incomplete Lattice query membership',
        ),
        'bounded failure diagnosis retained',
      );
      const pending = await db.execute(
        'SELECT owner_url,dirty_generation,published_generation FROM lattice_owners WHERE realm_url=$1 AND dirty_generation IS NOT NULL ORDER BY owner_url',
        { bind: [realmA] },
      );
      assert.deepEqual(
        pending.map((r) => [
          r.owner_url,
          Number(r.dirty_generation),
          Number(r.published_generation),
        ]),
        [
          [broken, 1, 1],
          [dependent, 1, 1],
        ],
        'failed owner and its dependent retain their obligations and last receipts',
      );
      assert.false(
        worker.messages.some((m) => m.type === 'read' && m.url === dependent),
        'dependent never executes against failed input',
      );
      await worker.kill();
      const replacement = await start();
      replacement.sources.set(broken, workSource(realmA, 'TruncatedDashboard'));
      await enqueue(realmA);
      await enqueue(realmB);
      await assertPublished(assert, realmB);
      await settled();
      assert.false(
        replacement.messages.some(
          (m) => m.type === 'read' && m.realmURL === realmA,
        ),
        'restart and duplicate wake-up do not retry exhausted work',
      );
      assert.strictEqual((await failures())[0].attempts, 3);

      // Code-fence control, not GTS admission: a new revision is a new budget.
      await db.execute(
        "UPDATE realm_generations SET loader_epoch='epoch-2' WHERE realm_url=$1",
        { bind: [realmA] },
      );
      await enqueue(realmA);
      await settled();
      assert.deepEqual(
        (await failures()).map((f) => [f.definition_revision, f.attempts]),
        [['epoch-2', 3]],
      );
      assert.strictEqual(
        replacement.messages.filter(
          (m) => m.type === 'read' && m.url === broken,
        ).length,
        3,
      );

      replacement.sources.set(broken, workSource(realmA));
      const execution = workExecution(db, new VirtualNetwork());
      try {
        const publication = new IndexWriter(db, {
          lattice: new LatticeRealmConfig(workRealms),
        }).latticePublication(execution.lookup, new VirtualNetwork());
        await db.withWriteLock('lattice:index:' + realmA, async (tx) => {
          if (!tx) throw new Error('Expected transaction');
          const [generation] = await tx([
            'UPDATE realm_generations SET current_generation=current_generation+1 WHERE realm_url=',
            param(realmA),
            'RETURNING current_generation',
          ]);
          await publication.registry.markDirty(
            tx,
            realmA,
            [broken],
            Number(generation.current_generation),
          );
          await publication.enqueuePending(tx, realmA, 'reader');
        });
      } finally {
        await execution.worker.close();
      }
      await settled();
      assert.deepEqual(
        await failures(),
        [],
        'successful publication removes its failure budget',
      );
      const restored = await db.execute(
        'SELECT o.owner_url,o.dirty_generation,i.pristine_doc FROM lattice_owners o JOIN boxel_index i ON i.realm_url=o.realm_url AND i.url=o.owner_url WHERE o.realm_url=$1 ORDER BY o.owner_url',
        { bind: [realmA] },
      );
      assert.strictEqual(restored.length, 3);
      for (const row of restored) {
        assert.strictEqual(
          row.dirty_generation,
          null,
          `${row.owner_url} recovers`,
        );
        assert.deepEqual(
          (row.pristine_doc as any).attributes,
          { count: 2, total: 10 },
          'all recovered computed values match the input oracle',
        );
        assert.deepEqual(
          (row.pristine_doc as any).relationships.members.data
            .map((r: { id: string }) => r.id)
            .sort(),
          [realmA + 'Record/one', realmA + 'Record/two'],
        );
      }
    });
  });

  test('an older source barrier in A does not starve B or consume a materialization reservation', async (assert) => {
    assert.timeout(60_000);
    await enqueue(realmA);
    const [source] = await db.execute(
      "INSERT INTO jobs(job_type,concurrency_group,priority,timeout,args) VALUES('incremental-index',$1,10,60,$2) RETURNING id",
      { bind: ['indexing:' + realmA, JSON.stringify({ realmURL: realmA })] },
    );
    await enqueue(realmB);
    await scenario(assert, async (start) => {
      const worker = await start();
      await worker.wait('finished', realmB);
      await assertPublished(assert, realmB);
      assert.deepEqual(
        await db.execute(
          "SELECT r.id FROM job_reservations r JOIN jobs j ON j.id=r.job_id WHERE j.args->>'realmURL'=$1",
          { bind: [realmA] },
        ),
        [],
        'A has no derived reservation while its source work is pending',
      );
      // Only a source-barrier control: source-index correctness has separate
      // coverage. The synthetic input rows are already committed above.
      await db.execute("UPDATE jobs SET status='resolved' WHERE id=$1", {
        bind: [source.id],
      });
      await db.execute('NOTIFY jobs');
      await worker.wait('finished', realmA);
      await assertPublished(assert, realmA);
    });
  });

  test('B publishes while A is held; killing A retains its job for a replacement process', async (assert) => {
    assert.timeout(60_000);
    await enqueue(realmA);
    await scenario(assert, async (start) => {
      const first = await start({ pauseRealm: realmA, maxReservationCount: 1 });
      const staged = await first.wait('computed', realmA);
      assert.deepEqual(
        staged.attributes,
        { count: 2, total: 10 },
        'real BXL has completed before interruption',
      );
      const claim = (await first.wait('started', realmA)).jobInfo!;
      await enqueue(realmB);
      const peer = await start({ maxReservationCount: 1 });
      await peer.wait('finished', realmB);
      await assertPublished(assert, realmB);
      assert.strictEqual(
        Number((await owner(realmA)).published_generation),
        1,
        'A has not published its staged result',
      );
      const [claims] = await db.execute(
        'SELECT COUNT(*)::int AS count FROM job_reservations WHERE job_id=$1',
        { bind: [claim.jobId] },
      );
      assert.strictEqual(
        claims.count,
        1,
        'the live claim excludes another A writer',
      );
      await peer.kill();
      await first.kill();
      const [job] = await db.execute('SELECT status FROM jobs WHERE id=$1', {
        bind: [claim.jobId],
      });
      assert.strictEqual(
        job.status,
        'unfulfilled',
        'manager cleanup preserves the durable job',
      );
      assert.strictEqual(
        Number((await owner(realmA)).dirty_generation),
        1,
        'dirty work survives process loss',
      );
      const replacement = await start({ maxReservationCount: 1 });
      const resumed = await replacement.wait('finished', realmA);
      assert.strictEqual(
        resumed.jobInfo!.jobId,
        claim.jobId,
        'the original job is recovered, not replaced',
      );
      assert.notStrictEqual(
        resumed.jobInfo!.reservationId,
        claim.reservationId,
      );
      await assertPublished(assert, realmA);
      await waitUntil(
        async () =>
          (
            await db.execute('SELECT status FROM jobs WHERE id=$1', {
              bind: [claim.jobId],
            })
          )[0].status === 'resolved',
        { timeout: 10_000, interval: 20 },
      );
      const attempts = await db.execute(
        'SELECT worker_id,completion_reason FROM job_reservations WHERE job_id=$1 ORDER BY id',
        { bind: [claim.jobId] },
      );
      assert.deepEqual(
        attempts.map((row) => row.completion_reason),
        ['interrupted', 'completed'],
        'an interruption does not exhaust the one-attempt failure cap',
      );
    });
  });

  test('an expired computed attempt cannot publish ahead of the replacement claim', async (assert) => {
    assert.timeout(60_000);
    await enqueue(realmA);
    await scenario(assert, async (start) => {
      const old = await start({ pauseRealm: realmA });
      await old.wait('computed', realmA);
      const oldClaim = (await old.wait('started', realmA)).jobInfo!;
      // Advance only this test reservation's lease instead of sleeping out a
      // production lease. The original process remains alive with real output.
      await db.execute(
        "UPDATE job_reservations SET locked_until=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
        { bind: [oldClaim.reservationId] },
      );
      const replacement = await start({ pauseRealm: realmA });
      await replacement.wait('computed', realmA);
      const newClaim = (await replacement.wait('started', realmA)).jobInfo!;
      assert.strictEqual(newClaim.jobId, oldClaim.jobId);
      assert.notStrictEqual(newClaim.reservationId, oldClaim.reservationId);
      old.release();
      const obsolete = await old.wait('finished', realmA);
      assert.strictEqual(
        obsolete.superseded,
        'queue reservation no longer current',
      );
      assert.strictEqual(
        Number((await owner(realmA)).published_generation),
        1,
        'expired result never becomes visible',
      );
      assert.strictEqual(
        Number((await owner(realmA)).dirty_generation),
        1,
        'expired work cannot satisfy the obligation',
      );
      await old.kill();
      replacement.release();
      await replacement.wait('finished', realmA);
      await assertPublished(assert, realmA);
    });
  });
});

class Processor {
  messages: Message[] = [];
  exited: Promise<void>;
  readonly child: ChildProcess;
  private db: PgAdapter;
  private logs = '';
  private stopped = false;
  sources = new Map<string, string>();
  constructor(child: ChildProcess, db: PgAdapter) {
    this.child = child;
    this.db = db;
    this.exited = new Promise((resolve) => child.once('exit', () => resolve()));
    for (const output of [child.stdout, child.stderr])
      output?.on('data', (chunk) => {
        this.logs += chunk.toString();
      });
    child.on('message', (message: Message) => {
      this.messages.push(message);
      if (message.type === 'read' && workRealms.includes(message.realmURL!))
        child.send({
          type: 'source',
          id: message.id,
          source:
            this.sources.get(message.url!) ?? workSource(message.realmURL!),
        });
    });
  }
  async wait(type: string, realmURL?: string) {
    const match = (m: Message) =>
      m.type === type && (!realmURL || m.realmURL === realmURL);
    try {
      await waitUntil(async () => this.messages.some(match), {
        timeout: 15_000,
        interval: 20,
      });
    } catch (error) {
      throw new Error(
        `Worker ${this.child.pid} waiting for ${type}: ${String(error)}\n${this.logs}`,
      );
    }
    return this.messages.find(match)!;
  }
  release() {
    if (this.child.connected) this.child.send({ type: 'release' });
  }
  async kill() {
    if (this.stopped) return;
    this.stopped = true;
    this.child.kill('SIGKILL');
    await this.exited;
    // Same cleanup used by the existing process manager, after confirmed exit.
    await finalizeOrphanedReservations(
      this.db,
      `lattice-materialization-test-${this.child.pid}`,
    );
    if (this.logs)
      console.log(`LATTICE_WORK_QUEUE child ${this.child.pid}:\n${this.logs}`);
  }
}
