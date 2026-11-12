import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeContentHash } from '@cardstack/runtime-common';
import {
  BackgroundScheduler,
  type BackgroundKind,
  type BackgroundResult,
} from '../src/background.ts';
import {
  Recorder,
  type BackgroundContext,
  type BackgroundJob,
  type BackgroundOutcome,
  type ManagedRecorder,
} from '../src/recorder.ts';
import { Historian } from '../src/historian.ts';
import { Heartbeat } from '../src/health.ts';
import { LeaseManager, shardOf } from '../src/lease.ts';
import { Semaphore } from '../src/semaphore.ts';
import type { RecordedRealm } from '../src/realms.ts';
import {
  appendEvent,
  insertRealm,
  setupTestDatabase,
  sleep,
  waitUntil,
  type TestRealm,
} from './helpers.ts';
import { fsck } from './git-objects-test.ts';

const MINUTE = 60_000;

function realmNamed(name: string): RecordedRealm {
  return {
    id: `id-${name}`,
    url: `http://localhost:4201/test-user/${name}/`,
    kind: 'source',
    shard: 0,
    directory: `/realms/test-user/${name}`,
    cursor: { xid: '0', seq: 0 },
    head: undefined,
  };
}

function realmsOf(...realms: RecordedRealm[]): Map<string, RecordedRealm> {
  return new Map(realms.map((realm) => [realm.id, realm]));
}

// A recorder that runs each job at once, or ends it as `outcome` says.
class FakeRecorder implements ManagedRecorder {
  jobs: string[] = [];
  outcome: () => BackgroundOutcome | 'run' = () => 'run';
  async record(): Promise<void> {}
  async runBackground(job: BackgroundJob): Promise<BackgroundOutcome> {
    let outcome = this.outcome();
    if (outcome !== 'run') {
      return outcome;
    }
    this.jobs.push(job.kind);
    await job.run({
      gitDir: '/history/realm.git',
      head: undefined,
      signal: new AbortController().signal,
    });
    return 'ran';
  }
}

// A job that waits until released, recording how many run at once.
function gate() {
  let waiting: (() => void)[] = [];
  let running = 0;
  let most = 0;
  let ran: string[] = [];
  return {
    get running() {
      return running;
    },
    get most() {
      return most;
    },
    ran,
    async run(realm: RecordedRealm, kind: string): Promise<void> {
      running++;
      most = Math.max(most, running);
      await new Promise<void>((resolve) => waiting.push(resolve));
      ran.push(`${kind}:${realm.id}`);
      running--;
    },
    releaseAll() {
      for (let release of waiting.splice(0)) {
        release();
      }
    },
    get waiting() {
      return waiting.length;
    },
  };
}

module('background scheduler', (hooks) => {
  let clock: number;
  let recorders: Map<string, FakeRecorder>;
  let schedulers: BackgroundScheduler[];

  hooks.beforeEach(() => {
    clock = Date.parse('2026-11-12T10:00:00.000Z');
    recorders = new Map();
    schedulers = [];
  });

  hooks.afterEach(async () => {
    for (let scheduler of schedulers.splice(0)) {
      await scheduler.stop();
    }
  });

  function recorderOf(realm: RecordedRealm): FakeRecorder {
    let recorder = recorders.get(realm.id);
    if (!recorder) {
      recorder = new FakeRecorder();
      recorders.set(realm.id, recorder);
    }
    return recorder;
  }

  function scheduler(
    kinds: BackgroundKind[],
    { concurrency }: { concurrency?: number } = {},
  ): BackgroundScheduler {
    let created = new BackgroundScheduler({
      kinds,
      concurrency,
      recorderFor: recorderOf,
      now: () => clock,
    });
    schedulers.push(created);
    return created;
  }

  async function drained(target: BackgroundScheduler): Promise<void> {
    await waitUntil(() => target.running === 0, { what: 'the jobs to end' });
  }

  // The kinds each realm's recorder ran, by realm id.
  function ran(): Record<string, string[]> {
    return Object.fromEntries(
      [...recorders].map(([id, recorder]) => [id, recorder.jobs]),
    );
  }

  test('due work runs at most `concurrency` jobs at once, and one at a time on each realm', async (assert) => {
    let held = gate();
    let kinds: BackgroundKind[] = ['first', 'second'].map((name) => ({
      name,
      atStart: true,
      run: (realm) => held.run(realm, name),
    }));
    let target = scheduler(kinds, { concurrency: 2 });
    let [a, b, c] = ['a', 'b', 'c'].map(realmNamed);
    target.setRealms(realmsOf(a, b, c));

    target.dispatch();
    await waitUntil(() => held.running === 2, { what: 'two jobs to start' });
    target.dispatch();
    await sleep(20);
    assert.strictEqual(held.running, 2, 'a third job waits for a slot');

    while (held.ran.length < 6) {
      held.releaseAll();
      await sleep(5);
    }
    await drained(target);
    assert.strictEqual(held.most, 2);
    assert.deepEqual(
      [...held.ran].sort(),
      [
        'first:id-a',
        'first:id-b',
        'first:id-c',
        'second:id-a',
        'second:id-b',
        'second:id-c',
      ],
      'every kind ran once on every realm',
    );
  });

  test('a kind with `everyMs` comes due again that long after it last ran', async (assert) => {
    let target = scheduler([
      {
        name: 'periodic',
        atStart: true,
        everyMs: 5 * MINUTE,
        run: async () => {},
      },
      { name: 'later', everyMs: 10 * MINUTE, run: async () => {} },
    ]);
    let realm = realmNamed('a');
    target.setRealms(realmsOf(realm));

    target.dispatch();
    await drained(target);
    assert.deepEqual(
      ran(),
      { 'id-a': ['periodic'] },
      'only `atStart` runs at load',
    );

    clock += 5 * MINUTE - 1;
    target.dispatch();
    await drained(target);
    assert.deepEqual(ran(), { 'id-a': ['periodic'] });

    clock += 1;
    target.dispatch();
    await drained(target);
    assert.deepEqual(ran(), { 'id-a': ['periodic', 'periodic'] });

    clock += 5 * MINUTE;
    target.dispatch();
    await drained(target);
    assert.deepEqual(
      [...ran()['id-a']].sort(),
      ['later', 'periodic', 'periodic', 'periodic'],
      'both come due ten minutes after the load',
    );
  });

  test('a kind due by commits waits for `afterCommits` revisions, and with `quietMs` for a quiet spell', async (assert) => {
    let target = scheduler([
      { name: 'by-count', afterCommits: 3, run: async () => {} },
      {
        name: 'when-quiet',
        afterCommits: 1,
        quietMs: 5 * MINUTE,
        run: async () => {},
      },
    ]);
    let realm = realmNamed('a');
    target.setRealms(realmsOf(realm));

    target.commitsRecorded(realm.id, 2);
    target.dispatch();
    await drained(target);
    assert.deepEqual(ran(), {}, 'nothing is due yet');

    clock += 4 * MINUTE;
    target.commitsRecorded(realm.id, 1);
    target.dispatch();
    await drained(target);
    assert.deepEqual(ran(), { 'id-a': ['by-count'] }, 'the third commit');

    clock += 5 * MINUTE - 1;
    target.dispatch();
    await drained(target);
    assert.deepEqual(ran(), { 'id-a': ['by-count'] }, 'not yet quiet');

    clock += 1;
    target.dispatch();
    await drained(target);
    assert.deepEqual(ran(), { 'id-a': ['by-count', 'when-quiet'] });

    clock += 10 * MINUTE;
    target.dispatch();
    await drained(target);
    assert.deepEqual(
      ran(),
      { 'id-a': ['by-count', 'when-quiet'] },
      'a run resets the count',
    );
  });

  test('a request makes a kind due, now or after a delay, and one made during a run is kept for after it', async (assert) => {
    let held = gate();
    let target = scheduler([
      { name: 'on-request', run: (realm) => held.run(realm, 'on-request') },
    ]);
    let realm = realmNamed('a');
    target.setRealms(realmsOf(realm));

    target.request(realm.id, 'on-request', { delayMs: MINUTE });
    target.dispatch();
    assert.strictEqual(target.running, 0, 'not before the delay');

    clock += MINUTE;
    target.dispatch();
    await waitUntil(() => held.running === 1, { what: 'the job to start' });
    target.request(realm.id, 'on-request');
    held.releaseAll();
    await waitUntil(() => held.ran.length === 1 && held.waiting === 1, {
      what: 'the request made during the run to start another',
    });
    held.releaseAll();
    await drained(target);
    assert.deepEqual(held.ran, ['on-request:id-a', 'on-request:id-a']);

    clock += 60 * MINUTE;
    target.dispatch();
    await drained(target);
    assert.strictEqual(held.ran.length, 2, 'a met request is gone');
  });

  test('a run that asks to run again comes due again then', async (assert) => {
    let results: (BackgroundResult | void)[] = [{ againAfterMs: MINUTE }];
    let runs = 0;
    let target = scheduler([
      {
        name: 'again',
        atStart: true,
        run: async () => {
          runs++;
          return results.shift();
        },
      },
    ]);
    target.setRealms(realmsOf(realmNamed('a')));

    target.dispatch();
    await drained(target);
    clock += MINUTE - 1;
    target.dispatch();
    await drained(target);
    assert.strictEqual(runs, 1);

    clock += 1;
    target.dispatch();
    await drained(target);
    assert.strictEqual(runs, 2);

    clock += 60 * MINUTE;
    target.dispatch();
    await drained(target);
    assert.strictEqual(
      runs,
      2,
      'a run that asks for nothing comes due no more',
    );
  });

  test('a realm `isDue` says needs nothing gets no recorder, and the check counts as a run', async (assert) => {
    let checks = 0;
    let target = scheduler([
      {
        name: 'checked',
        atStart: true,
        everyMs: 5 * MINUTE,
        isDue: async () => {
          checks++;
          return checks > 1;
        },
        run: async () => {},
      },
    ]);
    target.setRealms(realmsOf(realmNamed('a')));

    target.dispatch();
    await drained(target);
    assert.strictEqual(checks, 1);
    assert.strictEqual(recorders.size, 0, 'no recorder was started');

    target.dispatch();
    await drained(target);
    assert.strictEqual(checks, 1, 'not due again until `everyMs` has passed');

    clock += 5 * MINUTE;
    target.dispatch();
    await drained(target);
    assert.strictEqual(checks, 2);
    assert.deepEqual(ran(), { 'id-a': ['checked'] });
  });

  test('a skipped job is tried again a moment later, and a failed or unrunnable one after the retry delay', async (assert) => {
    let fail = true;
    let target = scheduler([
      { name: 'skippy', atStart: true, run: async () => {} },
      {
        name: 'flaky',
        atStart: true,
        retryAfterMs: 10 * MINUTE,
        run: async () => {
          if (fail) {
            throw new Error('boom');
          }
        },
      },
    ]);
    let realm = realmNamed('a');
    target.setRealms(realmsOf(realm));
    let recorder = recorderOf(realm);
    let outcomes: (BackgroundOutcome | 'run')[] = ['skipped'];
    recorder.outcome = () => outcomes.shift() ?? 'run';

    target.dispatch();
    await drained(target);
    target.dispatch();
    await drained(target);
    assert.deepEqual(recorder.jobs, ['flaky'], 'the skipped job waits');

    clock += 1000;
    target.dispatch();
    await drained(target);
    assert.deepEqual(recorder.jobs, ['flaky', 'skippy'], 'then runs');

    fail = false;
    clock += 10 * MINUTE - 1001;
    target.dispatch();
    await drained(target);
    assert.deepEqual(recorder.jobs, ['flaky', 'skippy'], 'the failure waits');
    clock += 1;
    target.dispatch();
    await drained(target);
    assert.deepEqual(recorder.jobs, ['flaky', 'skippy', 'flaky']);

    target.request(realm.id, 'skippy');
    outcomes = ['unavailable'];
    target.dispatch();
    await drained(target);
    clock += 1000;
    target.dispatch();
    await drained(target);
    assert.deepEqual(
      recorder.jobs,
      ['flaky', 'skippy', 'flaky'],
      'an unrunnable job waits for the retry delay',
    );
    clock += 60_000;
    target.dispatch();
    await drained(target);
    assert.deepEqual(recorder.jobs, ['flaky', 'skippy', 'flaky', 'skippy']);
  });

  test('only the realms the task records are scheduled', async (assert) => {
    let target = scheduler([
      { name: 'every', atStart: true, everyMs: MINUTE, run: async () => {} },
    ]);
    let [a, b] = ['a', 'b'].map(realmNamed);
    target.setRealms(realmsOf(a, b));
    target.dispatch();
    await drained(target);
    assert.deepEqual(ran(), { 'id-a': ['every'], 'id-b': ['every'] });

    target.setRealms(realmsOf(b));
    clock += MINUTE;
    target.request(a.id, 'every');
    target.dispatch();
    await drained(target);
    assert.deepEqual(ran(), { 'id-a': ['every'], 'id-b': ['every', 'every'] });
  });

  test('a stopped scheduler starts nothing more and waits for the jobs running', async (assert) => {
    let held = gate();
    let target = scheduler([
      { name: 'held', atStart: true, run: (realm) => held.run(realm, 'held') },
    ]);
    target.setRealms(realmsOf(realmNamed('a'), realmNamed('b')));

    target.dispatch();
    await waitUntil(() => held.running === 2, { what: 'both jobs to start' });
    let stopped = false;
    let stopping = target.stop().then(() => (stopped = true));
    await sleep(20);
    assert.false(stopped, 'the stop waits for the jobs');
    held.releaseAll();
    await stopping;
    target.request('id-a', 'held');
    target.dispatch();
    assert.strictEqual(target.running, 0);
  });
});

module('background work through the historian', (hooks) => {
  let database = setupTestDatabase(hooks);
  let root: string;
  let historians: Historian[] = [];
  let managers: LeaseManager[] = [];

  hooks.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'realm-historian-background-'));
  });

  hooks.afterEach(async (assert) => {
    for (let historian of historians.splice(0)) {
      await historian.stop();
    }
    for (let manager of managers.splice(0)) {
      await manager.abandon();
    }
    for (let repo of await readdir(join(root, 'history')).catch(
      () => [] as string[],
    )) {
      assert.strictEqual(await fsck(join(root, 'history', repo)), '');
    }
    await rm(root, { recursive: true, force: true });
  });

  function historian({
    kinds,
    shardCount = 1,
    taskCount = 1,
    created = [],
    createdFor = [],
    failures = [],
  }: {
    kinds: BackgroundKind[];
    shardCount?: number;
    taskCount?: number;
    created?: Recorder[];
    // The realm each recorder in `created` records, by registry id.
    createdFor?: string[];
    failures?: unknown[];
  }): Historian {
    let db = database.another();
    let historyRoot = join(root, 'history');
    let started = new Historian({
      db,
      historyRoot,
      realmsRoot: join(root, 'realms'),
      heartbeat: new Heartbeat(),
      pollMs: 50,
      lease: {
        shardCount,
        taskCount,
        renewMs: 50,
        expiryMs: 1000,
        holder: 'background-test-task',
      },
      // Long enough that only a recorder that never handled an event counts
      // as idle within a test.
      recording: { clockGraceMs: 0, idleAfterMs: 60_000 },
      background: { kinds },
      recorderFor: (realm, beat, onCommits) => {
        let recorder = new Recorder({
          db,
          realm,
          historyRoot,
          holder: 'background-test-task',
          io: new Semaphore(1),
          onFatal: (error) => failures.push(error),
          beat,
          onCommits,
        });
        created.push(recorder);
        createdFor.push(realm.id);
        return recorder;
      },
    });
    historians.push(started);
    started.run().catch((error) => failures.push(error));
    return started;
  }

  async function realmAt(name: string): Promise<TestRealm> {
    let realm = await insertRealm(database.db, {
      url: `http://localhost:4201/test-user/${name}/`,
      diskId: `test-user/${name}`,
    });
    await mkdir(join(root, 'realms', 'test-user', name), { recursive: true });
    return realm;
  }

  test('an idle realm with work due gets a recorder, which runs the job and is dropped once idle again', async (assert) => {
    let realm = await realmAt('quiet');
    let created: Recorder[] = [];
    let failures: unknown[] = [];
    let contexts: { realm: string; context: BackgroundContext }[] = [];
    historian({
      kinds: [
        {
          name: 'at-start',
          atStart: true,
          run: async (target, context) =>
            void contexts.push({ realm: target.id, context }),
        },
      ],
      created,
      failures,
    });

    await waitUntil(() => contexts.length === 1, {
      timeoutMs: 10_000,
      what: 'the job to run',
    });
    assert.strictEqual(contexts[0].realm, realm.id);
    assert.strictEqual(contexts[0].context.head, undefined, 'no revision yet');
    assert.strictEqual(created.length, 1, 'a recorder was started for it');
    await waitUntil(() => created[0].state === 'stopped', {
      what: 'the idle recorder to be dropped',
    });
    assert.deepEqual(failures, []);
  });

  test('a realm dropped while its job is checked gets no recorder, and the job does not run', async (assert) => {
    let dropped = await realmAt('dropped');
    let release!: () => void;
    let released = new Promise<void>((resolve) => (release = resolve));
    let checking = false;
    let ran: string[] = [];
    let createdFor: string[] = [];
    let failures: unknown[] = [];
    let started = historian({
      kinds: [
        {
          name: 'checked',
          atStart: true,
          isDue: async (target) => {
            if (target.id === dropped.id) {
              checking = true;
              await released;
            }
            return true;
          },
          run: async (target) => void ran.push(target.id),
        },
      ],
      createdFor,
      failures,
    });
    await waitUntil(() => checking, { what: "the dropped realm's check" });

    await database.db.execute(
      `UPDATE realm_history_state SET enabled = false WHERE realm_id = $1`,
      { bind: [dropped.id] },
    );
    // An event for a realm the task hasn't loaded makes it load the realms
    // again, which drops the realm whose recording is now off.
    let other = await realmAt('other');
    await writeFile(
      join(root, 'realms', 'test-user', 'other', 'card.json'),
      '{}',
    );
    await appendEvent(database.db, other, {
      changes: [
        {
          path: 'card.json',
          status: 'A',
          contentHash: computeContentHash('{}'),
          size: 2,
        },
      ],
    });
    await waitUntil(
      () => started.realms.has(other.id) && !started.realms.has(dropped.id),
      { timeoutMs: 10_000, what: 'the realms to be loaded again' },
    );
    release();
    await waitUntil(() => ran.includes(other.id), {
      timeoutMs: 10_000,
      what: "the other realm's job",
    });
    await sleep(100);

    assert.false(ran.includes(dropped.id), 'no job ran on the dropped realm');
    assert.deepEqual(
      createdFor,
      [other.id],
      'only the other realm got a recorder',
    );
    assert.deepEqual(failures, []);
  });

  test('only the realms of the shards the task holds are scheduled', async (assert) => {
    let shardCount = 2;
    let realms: TestRealm[] = [];
    for (let i = 0; realms.filter(Boolean).length < shardCount && i < 50; i++) {
      let realm = await realmAt(`realm-${i}`);
      realms[shardOf(realm.id, shardCount)] ??= realm;
    }
    let other = new LeaseManager(database.another(), {
      shardCount,
      taskCount: 2,
      renewMs: 50,
      expiryMs: 1000,
      holder: 'other',
    });
    managers.push(other);
    await other.start(() => {});
    let [otherShard] = other.held;
    let seen = new Set<string>();
    let failures: unknown[] = [];
    let started = historian({
      kinds: [
        {
          name: 'every',
          atStart: true,
          run: async (target) => void seen.add(target.id),
        },
      ],
      shardCount,
      taskCount: 2,
      failures,
    });

    await waitUntil(() => started.held.length === 1, {
      what: 'the task to take the free shard',
    });
    let held = 1 - otherShard;
    let mine = realms[held];
    await waitUntil(() => seen.has(mine.id), {
      timeoutMs: 10_000,
      what: "the job on the held shard's realm",
    });
    await sleep(200);
    assert.true(
      [...seen].every((id) => shardOf(id, shardCount) === held),
      'no realm of the shard another task holds was scheduled',
    );
    assert.deepEqual(failures, []);
  });
});
