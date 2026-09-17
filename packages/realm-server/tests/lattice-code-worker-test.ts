import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { basename } from 'node:path';
import QUnit from 'qunit';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  VirtualNetwork,
  rri,
  type FileEntry,
} from '@cardstack/runtime-common';
import { analyzeLatticeGtsSource } from '@cardstack/runtime-common/lattice-gts-analysis';
import { query, param } from '@cardstack/runtime-common/expression';
import { latticeOwnerCodeStatuses } from '@cardstack/runtime-common/lattice-code-reference';
import {
  persistFileMeta,
  removeFileMeta,
} from '@cardstack/runtime-common/file-meta';
import { createLatticeCodeWorker } from '../lib/lattice-code-worker.ts';
import {
  registerLatticeCodePolicies,
  readLatticeCodeAdmission,
} from '../lib/lattice-code-admission.ts';
import type { LatticeNativeRealmPolicy } from '../lib/lattice-postgres-admission.ts';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-code-worker.example/';
const actor = '@linker:example';
const username = 'linker';
const api = 'export class CardDef {}';
const imports = `import {CardDef,field,contains,NumberField} from './api';`;
const code = `${imports} export class Counter extends CardDef { @field amount = contains(NumberField); }`;
const hash = (text: string) => createHash('md5').update(text).digest('hex');

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let network: VirtualNetwork;
  let policy: LatticeNativeRealmPolicy;
  let writer: IndexWriter;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      network = new VirtualNetwork();
      writer = new IndexWriter(db, {
        lattice: new LatticeRealmConfig([realm]),
      });
      policy = {
        realmURL: realm,
        actorUserId: actor,
        runtimeRevision: 'code-runtime-1',
        roots: [],
        definitions: [],
        noScreenshotThumbnail: true,
        modules: [
          {
            url: realm + 'api',
            realmURL: realm,
            sourcePath: 'api.gts',
            sourceMD5: hash(api),
            cacheScope: 'realm-auth',
            authUserId: actor,
          },
        ],
        codeLinking: {
          trustedModules: [
            {
              moduleURL: realm + 'api',
              moduleURLs: [realm + 'api'],
              exports: ['CardDef', 'field', 'contains', 'NumberField'],
            },
          ],
        },
      };
      await db.execute('INSERT INTO realm_metadata (url) VALUES ($1)', {
        bind: [realm],
      });
      await db.execute(
        'INSERT INTO realm_user_permissions (realm_url,username,read,write) VALUES ($1,$2,TRUE,TRUE)',
        { bind: [realm, actor] },
      );
      await writeSource('api.gts', api);
      await registerLatticeCodePolicies(db, [policy]);
    },
  });

  async function writeSource(path: string, source: string) {
    await persistFileMeta(
      db,
      realm,
      [
        {
          path,
          contentHash: hash(source),
          contentSize: Buffer.byteLength(source),
        },
      ],
      true,
    );
  }

  async function publish(path: string, source: string, native = true) {
    await writeSource(path, source);
    const url = new URL(path, realm);
    const batch = await writer.createBatch(new URL(realm), network);
    const entry: FileEntry = {
      type: 'file',
      lastModified: 1,
      resourceCreatedAt: 1,
      searchData: { latticeAnalysis: null },
      resource: {
        id: rri(url.href),
        type: 'file-meta',
        attributes: {
          latticeAnalysis: analyzeLatticeGtsSource(url.href, source),
        },
        meta: {
          adoptsFrom: {
            module: rri(realm + 'gts-file-def'),
            name: 'GtsFileDef',
          },
        },
      },
      types: [realm + 'gts-file-def/GtsFileDef'],
      displayNames: ['GTS Module'],
      iconHTML: '<svg></svg>',
      deps: new Set(),
      ...(native ? { diagnostics: { latticeNativeFile: true } } : {}),
    };
    await batch.updateEntry(url, entry);
    await batch.done({
      latticeRealmUsername: username,
      carryForwardRealmMeta: true,
      countIndexEntries: false,
    });
  }
  const run = () =>
    createLatticeCodeWorker({
      db,
      network,
      policies: [policy],
      runtimeRevision: () => policy.runtimeRevision,
    })({ realmURL: realm, realmUsername: username });
  const artifacts = () =>
    query(
      db,
      [
        'SELECT file_url,dirty,work_version,runtime_revision,actor_user_id,receipt,dependency_keys FROM lattice_code_artifacts ORDER BY file_url',
      ],
      { receipt: 'JSON', dependency_keys: 'JSON' },
    );

  test('transport mappings do not replace indexed realm identities during linking', async function (assert) {
    network.addURLMapping(new URL(realm), new URL('http://127.0.0.1:52797/'));
    await publish('counter.gts', code);
    assert.strictEqual((await run()).published, 1);
    const [artifact] = await artifacts();
    assert.strictEqual(
      (artifact.receipt as any).exports.Counter.state,
      'requires-admission',
    );
    assert.strictEqual(artifact.file_url, realm + 'counter.gts');
  });

  test('a served realm keeps its indexed identity when it also has a virtual alias', async function (assert) {
    network.addURLMapping(
      new URL('https://virtual-base.example/'),
      new URL(realm),
    );
    await publish('counter.gts', code);
    assert.strictEqual((await run()).published, 1);
    const [artifact] = await artifacts();
    assert.strictEqual(
      (artifact.receipt as any).exports.Counter.state,
      'requires-admission',
    );
    assert.strictEqual(artifact.file_url, realm + 'counter.gts');
  });

  test('source index publication enqueues a separate job and the worker publishes file-owned receipts', async function (assert) {
    await publish('counter.gts', code);
    const [pending] = await artifacts();
    assert.true(pending.dirty);
    assert.strictEqual(
      pending.receipt,
      null,
      'no linking happened on the index swap',
    );
    const jobs = await query(db, [
      "SELECT job_type,priority,concurrency_group FROM jobs WHERE job_type='lattice-link-code'",
    ]);
    assert.strictEqual(jobs.length, 1);
    assert.strictEqual(jobs[0].concurrency_group, `lattice-code:${realm}`);
    assert.strictEqual(Number(jobs[0].priority), 7);
    assert.strictEqual((await run()).published, 1);
    const [ready] = await artifacts();
    assert.false(ready.dirty);
    assert.strictEqual(ready.actor_user_id, actor);
    const receipt = ready.receipt as any;
    assert.strictEqual(
      receipt.exports.Counter.state,
      'requires-admission',
      JSON.stringify(receipt),
    );
    assert.strictEqual(receipt.exports.Counter.files.length, 2);
    assert.deepEqual(
      (await run()).published,
      0,
      'an already current file needs no work',
    );
  });

  test('template publication preserves bound data and obligations; computation edits dirty its owner', async function (assert) {
    const text = code.replace(
      ' }',
      ' static isolated = <template>{{@model.amount}}</template>; }',
    );
    await publish('counter.gts', text);
    await run();
    const admitted = await readLatticeCodeAdmission(
      db,
      policy,
      realm + 'counter.gts',
      'Counter',
    );
    assert.ok(admitted, 'the original code is admitted');
    const owner = realm + 'Counter/one.json';
    await db.execute(
      `INSERT INTO lattice_owners
      (realm_url,owner_url,published_generation,input_generation,definition_revision,code_bound,attributes_json,attributes_generation,stale_within)
      VALUES ($1,$2,1,1,'original-definition',TRUE,'{"amount":7}',1,2)`,
      { bind: [realm, owner] },
    );
    await db.execute(
      'INSERT INTO lattice_owner_code (realm_url,owner_url,generation,reference) VALUES ($1,$2,1,$3)',
      {
        bind: [realm, owner, JSON.stringify(admitted!.reference)],
      },
    );
    const owners = () =>
      query(db, ['SELECT * FROM lattice_owners ORDER BY owner_url']);
    const before = await owners();
    const current = async () => {
      const single = (
        await db.execute(
          "SELECT lattice_owner_code_current($1,$2,'new-loader') AS current",
          { bind: [realm, owner] },
        )
      )[0].current;
      const bulk = await query(
        db,
        latticeOwnerCodeStatuses([param(realm)], [param('new-loader')]),
      );
      assert.strictEqual(
        bulk.find((row) => row.owner_url === owner)?.current,
        single,
        'bulk proof validation has the same code/source fence as the per-owner check',
      );
      return single;
    };
    assert.true(await current());
    await publish(
      'counter.gts',
      text.replace(
        '{{@model.amount}}',
        '<h1>{{@model.amount}}</h1><style scoped>h1 { color: red; }</style>',
      ),
    );
    assert.deepEqual(
      await owners(),
      before,
      'pending classification preserves the data and its freshness windows',
    );
    assert.false(
      await current(),
      'source freshness remains fenced until new analysis is linked',
    );
    await run();
    assert.true(
      await current(),
      'same data program restores the existing binding with the new source fence',
    );
    assert.deepEqual(
      await owners(),
      before,
      'no value, output revision, obligation or deadline changed',
    );
    assert.strictEqual(
      (
        await query(db, [
          "SELECT id FROM jobs WHERE job_type='lattice-materialize'",
        ])
      ).length,
      0,
      'template change schedules no data materialization',
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=1 WHERE realm_url=$1 AND owner_url=$2',
      { bind: [realm, owner] },
    );
    await publish('counter.gts', text + '\n// presentation comment');
    await run();
    assert.strictEqual(
      Number((await owners())[0].dirty_generation),
      1,
      'an unrelated pending data obligation is never cleared',
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=NULL WHERE realm_url=$1 AND owner_url=$2',
      { bind: [realm, owner] },
    );
    await publish(
      'counter.gts',
      text.replace(
        '@field amount',
        '@field another = contains(NumberField); @field amount',
      ),
    );
    await run();
    assert.false(
      await current(),
      'changed data code cannot reuse the old binding',
    );
    assert.ok(
      (await owners())[0].dirty_generation,
      'changed computation schedules the affected owner',
    );
    assert.strictEqual(
      (await owners())[0].attributes_json,
      before[0].attributes_json,
      'last published data survives while replacement is pending',
    );
  });

  test('ordinary metadata writes have no Lattice trigger or invalidation side effects', async function (assert) {
    await publish('counter.gts', code);
    await run();
    const before = await artifacts();
    assert.deepEqual(
      await query(db, [
        "SELECT tgname FROM pg_trigger WHERE tgrelid='realm_file_meta'::regclass AND tgname LIKE 'lattice_%' AND NOT tgisinternal",
      ]),
      [],
      'the shared table has no Lattice trigger',
    );
    await persistFileMeta(db, realm, [
      {
        path: 'api.gts',
        contentHash: hash(api + '\n'),
        contentSize: Buffer.byteLength(api + '\n'),
      },
    ]);
    assert.deepEqual(
      await artifacts(),
      before,
      'disabled writes do not schedule code work',
    );
    assert.strictEqual(
      await readLatticeCodeAdmission(
        db,
        policy,
        realm + 'counter.gts',
        'Counter',
      ),
      undefined,
      'the source hash still fences old code without a trigger',
    );
    await removeFileMeta(db, realm, ['api.gts']);
    assert.deepEqual(
      await artifacts(),
      before,
      'disabled deletions do not schedule code work',
    );
    await writeSource('api.gts', api);
    assert.true(
      (await artifacts())[0].dirty,
      'enabled writes invalidate atomically',
    );
  });

  test('source changes invalidate just their registered code consumers before reindexing', async function (assert) {
    await publish('counter.gts', code);
    await publish('unrelated.gts', 'export class Independent {}');
    await run();
    const before = await artifacts();
    await writeSource('some-record.json', '{"count":2}');
    assert.deepEqual(
      await artifacts(),
      before,
      'a record write does not dirty code',
    );
    await writeSource('api.gts', api + '\n');
    const after = await artifacts();
    assert.true(
      after.find((row) => row.file_url === realm + 'counter.gts')!.dirty,
    );
    assert.false(
      after.find((row) => row.file_url === realm + 'unrelated.gts')!.dirty,
    );
    await writeSource('counter.gts', code + '\n');
    assert.strictEqual(
      (
        await query(db, [
          "SELECT id FROM jobs WHERE job_type='lattice-link-code' AND status='unfulfilled'",
        ])
      ).length,
      1,
      'unreserved wakeups coalesce',
    );
    const index = await query(db, [
      "SELECT indexdef FROM pg_indexes WHERE indexname='lattice_code_dependencies'",
    ]);
    assert.true(String(index[0].indexdef).includes('USING gin'));
  });

  test('Chrome-produced analysis enters the same file-owned registry only in an enabled realm', async function (assert) {
    await db.execute('DELETE FROM lattice_code_realms');
    await publish('counter.gts', code, false);
    assert.deepEqual(
      await artifacts(),
      [],
      'ordinary realms acquire no linking jobs',
    );
    assert.deepEqual(
      await query(db, [
        "SELECT id FROM jobs WHERE job_type='lattice-link-code'",
      ]),
      [],
    );
    await registerLatticeCodePolicies(db, [policy]);
    await publish('counter.gts', code, false);
    assert.strictEqual(
      (await run()).published,
      1,
      'unchanged, previously indexed analysis can be registered',
    );
    assert.ok(
      await readLatticeCodeAdmission(
        db,
        policy,
        realm + 'counter.gts',
        'Counter',
      ),
    );
  });

  test('code admission checks semantic source and authority, not stored transaction IDs', async function (assert) {
    await publish('counter.gts', code);
    await run();
    const before = await artifacts();
    await writeSource('api.gts', api);
    assert.deepEqual(
      await artifacts(),
      before,
      'identical bytes do not dirty the artifact',
    );
    const admitted = await readLatticeCodeAdmission(
      db,
      policy,
      realm + 'counter.gts',
      'Counter',
    );
    assert.ok(admitted, 'a new xmin for identical content is still usable');
    await db.withWriteLock('code-admission-test', (tx) => admitted!(tx!));
    await writeSource('api.gts', api + '\n');
    assert.strictEqual(
      await readLatticeCodeAdmission(
        db,
        policy,
        realm + 'counter.gts',
        'Counter',
      ),
      undefined,
    );
    await assert.rejects(
      db.withWriteLock('code-admission-test', (tx) => admitted!(tx!)),
      /code inputs|classification changed/,
    );
    // Even if code is otherwise current, revoked authority cannot be reused.
    await writeSource('api.gts', api);
    await run();
    const current = await readLatticeCodeAdmission(
      db,
      policy,
      realm + 'counter.gts',
      'Counter',
    );
    assert.ok(current);
    await db.execute(
      'UPDATE realm_user_permissions SET read=FALSE WHERE realm_url=$1',
      { bind: [realm] },
    );
    assert.strictEqual(
      await readLatticeCodeAdmission(
        db,
        policy,
        realm + 'counter.gts',
        'Counter',
      ),
      undefined,
    );
    await assert.rejects(
      db.withWriteLock('code-admission-test', (tx) => current!(tx!)),
      /code inputs or authority changed/,
    );
  });

  test('installing a new review invalidates old code and fences old workers', async function (assert) {
    await publish('counter.gts', code);
    await run();
    const before = await artifacts();
    const current = await readLatticeCodeAdmission(
      db,
      policy,
      realm + 'counter.gts',
      'Counter',
    );
    assert.ok(current);
    await registerLatticeCodePolicies(db, [policy]);
    assert.deepEqual(
      await artifacts(),
      before,
      'another processor with the same policy is a no-op',
    );
    const replacement = { ...policy, runtimeRevision: 'code-runtime-2' };
    await registerLatticeCodePolicies(db, [replacement]);
    assert.true((await artifacts())[0].dirty);
    await assert.rejects(
      run(),
      /processor policy changed/,
      'an old worker cannot republish its old runtime',
    );
    await assert.rejects(
      db.withWriteLock('code-admission-test', (tx) => current!(tx!)),
      /processor policy changed/,
    );
    assert.strictEqual(
      await readLatticeCodeAdmission(
        db,
        policy,
        realm + 'counter.gts',
        'Counter',
      ),
      undefined,
    );
    policy = replacement;
    await run();
    assert.ok(
      await readLatticeCodeAdmission(
        db,
        policy,
        realm + 'counter.gts',
        'Counter',
      ),
    );
  });

  test('published analysis wakes blocked consumers and stale linked work cannot win', async function (assert) {
    await publish(
      'counter.gts',
      `import {Parent} from './parent'; export class Counter extends Parent {}`,
    );
    await run();
    let [row] = await artifacts();
    assert.strictEqual((row.receipt as any).exports.Counter.state, 'blocked');
    await publish(
      'parent.gts',
      `${imports} export class Parent extends CardDef {}`,
    );
    assert.true(
      (await artifacts()).find(
        (item) => item.file_url === realm + 'counter.gts',
      )!.dirty,
    );
    await run();
    row = (await artifacts()).find(
      (item) => item.file_url === realm + 'counter.gts',
    )!;
    assert.strictEqual(
      (row.receipt as any).exports.Counter.state,
      'requires-admission',
    );
    const fingerprint = (row.receipt as any).exports.Counter.fingerprint;
    await publish(
      'counter.gts',
      `import {Parent} from './parent'; export class Counter extends Parent {}\n`,
    );
    const withLock = db.withWriteLock.bind(db);
    let raced = false;
    db.withWriteLock = async (name, callback) => {
      if (!raced) {
        raced = true;
        await writeSource('parent.gts', 'new unpublished source');
      }
      return withLock(name, callback);
    };
    const result = await run();
    db.withWriteLock = withLock;
    assert.strictEqual(result.superseded, 1);
    const [stale] = await artifacts();
    assert.true(stale.dirty);
    assert.strictEqual(
      (stale.receipt as any).exports.Counter.fingerprint,
      fingerprint,
      'old candidate never replaces the previous receipt',
    );
  });

  test('failed source publication rolls back its linking obligation too', async function (assert) {
    const withLock = db.withWriteLock.bind(db);
    db.withWriteLock = (name, callback) =>
      withLock(name, async (tx) => {
        await callback(tx);
        throw new Error('fail before commit');
      });
    await assert.rejects(publish('counter.gts', code), /fail before commit/);
    db.withWriteLock = withLock;
    assert.deepEqual(await artifacts(), []);
    assert.deepEqual(
      await query(db, [
        "SELECT id FROM jobs WHERE job_type='lattice-link-code'",
      ]),
      [],
    );
    assert.deepEqual(await query(db, ['SELECT url FROM boxel_index']), []);
  });

  test('a changed runtime or revoked read grant cannot publish a receipt', async function (assert) {
    await publish('counter.gts', code);
    const worker = createLatticeCodeWorker({
      db,
      network,
      policies: [policy],
      runtimeRevision: () => 'new-runtime',
    });
    await assert.rejects(
      worker({ realmURL: realm, realmUsername: username }),
      /current realm processor policy/,
    );
    await db.execute(
      'UPDATE realm_user_permissions SET read=FALSE WHERE realm_url=$1 AND username=$2',
      { bind: [realm, actor] },
    );
    await assert.rejects(run(), /No authorized code dependency/);
    assert.true((await artifacts())[0].dirty);
  });

  test('an unavailable external dependency does not prevent other files from being classified', async function (assert) {
    await publish(
      'external.gts',
      `import {CardDef} from 'https://external.example/api'; export class External extends CardDef {}`,
    );
    await publish('counter.gts', code);
    assert.strictEqual((await run()).published, 2);
    const rows = await artifacts();
    const external = rows.find(
      (row) => row.file_url === realm + 'external.gts',
    )!;
    assert.false(
      external.dirty,
      'the blocked outcome is a published classification',
    );
    assert.strictEqual(
      (external.receipt as any).exports.External.state,
      'blocked',
    );
    assert.strictEqual(
      await readLatticeCodeAdmission(
        db,
        policy,
        realm + 'external.gts',
        'External',
      ),
      undefined,
    );
    assert.ok(
      await readLatticeCodeAdmission(
        db,
        policy,
        realm + 'counter.gts',
        'Counter',
      ),
    );
  });

  test('a real child process claims the durable job and publishes its result', async function (assert) {
    await publish('counter.gts', code);
    const [sourceJob] = await query(db, [
      `INSERT INTO jobs (job_type,concurrency_group,priority,timeout,args)
       VALUES ('incremental-index','indexing:${realm}',10,60,'{}') RETURNING id`,
    ]);
    const [database] = await query(db, ['SELECT current_database() AS name']);
    const child = fork(
      fileURLToPath(
        new URL('./fixtures/lattice-code-processor.ts', import.meta.url),
      ),
      [],
      {
        env: { ...process.env, PGDATABASE: String(database.name) },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    let logs = '';
    child.stdout?.on('data', (chunk) => {
      logs += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      logs += chunk.toString();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = once(child, 'message');
      child.send(policy);
      const [message] = await Promise.race([
        ready,
        once(child, 'exit').then(() => {
          throw new Error(`Code child exited before readiness: ${logs}`);
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Code child readiness timed out: ${logs}`)),
            10000,
          );
        }),
      ]);
      clearTimeout(timer);
      assert.strictEqual(message.ready, child.pid);
      assert.notStrictEqual(
        child.pid,
        process.pid,
        'linking runs outside the requesting process',
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      const reservations = await query(db, [
        `SELECT r.job_id FROM job_reservations r JOIN jobs j ON j.id=r.job_id WHERE j.job_type='lattice-link-code'`,
      ]);
      assert.strictEqual(
        reservations.length,
        0,
        'pending source indexing keeps linking work unreserved',
      );
      await db.execute("UPDATE jobs SET status='resolved' WHERE id=$1", {
        bind: [sourceJob.id],
      });
      await db.execute('NOTIFY jobs');
      let job;
      for (let i = 0; i < 100; i++) {
        [job] = await query(
          db,
          [
            "SELECT status,result FROM jobs WHERE job_type='lattice-link-code' ORDER BY id DESC LIMIT 1",
          ],
          { result: 'JSON' },
        );
        if (job?.status !== 'unfulfilled') break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.strictEqual(job?.status, 'resolved', logs);
      assert.strictEqual((job?.result as any).processorPid, child.pid);
      assert.false((await artifacts())[0].dirty);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = once(child, 'exit');
        const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
        if (child.connected) child.send('stop');
        else child.kill();
        await stopped;
        clearTimeout(kill);
      }
    }
  });
});
