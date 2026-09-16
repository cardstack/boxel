import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { DirResult } from 'tmp';
import type { PgAdapter } from '@cardstack/postgres';

import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import { JobClaimHold } from '@cardstack/runtime-common/jobs/claim-hold';
import { prerenderHtmlConcurrencyGroup } from '@cardstack/runtime-common/jobs/prerender-html';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  setupPermissionedRealmCached,
  setupMatrixRoom,
  createJWT,
  withRealmPath,
  waitUntil,
  type RealmRequest,
} from './helpers/index.ts';
import { settlePrerenderHtmlJobs } from './helpers/indexing.ts';

const testRealm = new URL('http://127.0.0.1:4445/test/');

// Coalescing merges an incoming job into one no worker has claimed yet, so it
// helps most when the queue is backed up and not at all when workers are free.
// A bulk import on an idle cluster is the second case: each write's render
// pass is claimed and finished before the next write ends, so cards touched by
// more than one write are re-rendered once per write. A batch write therefore
// holds its realm's render lane for its own duration, leaving the previous
// pass pending for the next one to merge into.
function makeFileSystem() {
  return {
    'person.gts': `
      import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import NumberField from "@cardstack/base/number";

      export class Person extends CardDef {
        @field firstName = contains(StringField);
        @field hourlyRate = contains(NumberField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName /> \${{@model.hourlyRate}}</h1>
          </template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h1>Embedded Person: <@fields.firstName/></h1>
          </template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <h1>Fitted Person: <@fields.firstName/></h1>
          </template>
        }
      }
    `,
  };
}

// The holds this adapter takes and gives back, in order. Recording the
// statements rather than polling for the row keeps the assertion off the wall
// clock: the hold exists only while the write is running, and a poll that
// arrives after a fast write cannot tell "never held" from "already
// released". Acquiring also sweeps the group's expired rows; that delete is
// housekeeping, not a hold changing hands, so it is not recorded.
function recordHoldStatements(adapter: DBAdapter) {
  let statements: ('acquire' | 'release')[] = [];
  let original = adapter.execute.bind(adapter);
  (adapter as unknown as { execute: unknown }).execute = async (
    ...execArgs: unknown[]
  ) => {
    let sql = execArgs[0];
    if (typeof sql === 'string' && sql.includes('job_claim_holds')) {
      if (sql.includes('INSERT')) {
        statements.push('acquire');
      } else if (sql.includes('holder_id =')) {
        statements.push('release');
      }
    }
    return (original as (...a: unknown[]) => unknown)(...execArgs);
  };
  return {
    statements,
    restore: () => {
      (adapter as unknown as { execute: unknown }).execute = original;
    },
  };
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let testDbAdapter: DBAdapter;
  let request: RealmRequest;
  let serverRequest: SuperTest<Test>;
  let testRealmHttpServer: Server;
  let dir: DirResult;

  setupPermissionedRealmCached(hooks, {
    mode: 'beforeEach',
    realmURL: testRealm,
    permissions: {
      '*': ['read', 'write'],
      '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
    },
    subscribeToRealmEvents: true,
    fileSystem: makeFileSystem(),
    onRealmSetup(args) {
      realm = args.testRealm;
      testDbAdapter = args.dbAdapter;
      request = withRealmPath(args.request, testRealm);
      serverRequest = args.request;
      testRealmHttpServer = args.testRealmHttpServer;
      dir = args.dir;
    },
  });

  setupMatrixRoom(hooks, () => ({
    testRealm: realm,
    testRealmHttpServer,
    request,
    serverRequest,
    dir,
    dbAdapter: testDbAdapter as PgAdapter,
  }));

  function instanceOps(from: number, count: number, revision = 0) {
    return Array.from({ length: count }, (_unused, i) => ({
      op: 'add',
      href: `person-${revision}-${from + i}.json`,
      data: {
        type: 'card',
        attributes: {
          firstName: `Person ${from + i}`,
          hourlyRate: from + i,
        },
        meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
      },
    }));
  }

  async function push(operations: unknown[]) {
    let response = await request
      .post('/_atomic')
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, 'user', ['read', 'write'])}`,
      )
      .send(JSON.stringify({ 'atomic:operations': operations }));
    if (response.status !== 201) {
      throw new Error(
        `/_atomic push failed with ${response.status}: ${JSON.stringify(
          response.body,
        ).slice(0, 500)}`,
      );
    }
  }

  async function unfulfilledPrerenderJobs(): Promise<
    { id: number; urls: string[]; reservations: number }[]
  > {
    return (await testDbAdapter.execute(
      `select j.id,
              coalesce(
                (select array_agg(change->>'url')
                   from jsonb_array_elements(j.args->'changes') as change),
                array[]::text[]
              ) as urls,
              (select count(*)::int from job_reservations r
                where r.job_id = j.id and r.completed_at is null) as reservations
         from jobs j
        where j.job_type = 'prerender_html'
          and j.concurrency_group = $1
          and j.status = 'unfulfilled'
        order by j.id`,
      { bind: [prerenderHtmlConcurrencyGroup(realm.url)] },
    )) as unknown as { id: number; urls: string[]; reservations: number }[];
  }

  async function liveHoldCount(): Promise<number> {
    let rows = (await testDbAdapter.execute(
      `select count(*)::int as n from job_claim_holds
        where concurrency_group = $1 and expires_at > now()`,
      { bind: [prerenderHtmlConcurrencyGroup(realm.url)] },
    )) as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  test('a batch write holds its realm render lane past the write, until its indexing settles', async function (assert) {
    assert.timeout(300_000);

    let recorder = recordHoldStatements(testDbAdapter);
    try {
      // Comfortably over RENDER_HOLD_MIN_BATCH_SIZE, so this is a batch the
      // hold is meant for.
      await push(instanceOps(0, 20));

      // The render job this write is responsible for does not exist yet — the
      // index pass the write just queued is what enqueues it. A hold that
      // ended with the write would free the lane in exactly that gap.
      assert.deepEqual(
        recorder.statements,
        ['acquire'],
        'the hold outlives the write that took it',
      );
      assert.strictEqual(
        await liveHoldCount(),
        1,
        'the lane is still held when the write returns',
      );

      await realm.incrementalIndexing();
      await waitUntil(async () => (await liveHoldCount()) === 0, {
        timeout: 30_000,
        timeoutMessage: () => 'the render hold was never released',
      });
      assert.deepEqual(
        recorder.statements,
        ['acquire', 'release'],
        'the write takes exactly one hold and gives it back',
      );
    } finally {
      recorder.restore();
    }

    await settlePrerenderHtmlJobs(testDbAdapter, realm.url, {
      timeout: 240_000,
    });
  });

  test('a release is not undone by a refresh already in flight', async function (assert) {
    // The heartbeat and the release race: `clearInterval` stops future
    // callbacks but not one already running. A refresh that lands after the
    // delete re-creates the holder for another lease, so the lane reads as
    // held moments after the NOTIFY told every worker it was free — and the
    // queued renders then wait for a lease nobody is watching.
    let group = prerenderHtmlConcurrencyGroup(testRealm.href);
    let hold = await JobClaimHold.acquire(testDbAdapter, group, 30_000);

    let held = async () => {
      let rows = (await testDbAdapter.execute(
        `SELECT COUNT(*)::int AS n FROM job_claim_holds
          WHERE concurrency_group = $1 AND expires_at > NOW()`,
        { bind: [group] },
      )) as unknown as { n: number }[];
      return rows[0].n;
    };
    assert.strictEqual(await held(), 1, 'the lane starts held');

    // Start a refresh and release without awaiting it, which is what the
    // heartbeat does.
    let refreshing = hold.refresh(30_000);
    await hold.release();
    await refreshing;

    assert.strictEqual(
      await held(),
      0,
      'the lane stays free once released, whatever was in flight',
    );
  });

  test('a chain of commits stops holding the lane once it outlives the cap', async function (assert) {
    assert.timeout(300_000);

    // The cap is minutes in production. Shortening it to something a test can
    // cross is the only way to reach the branch: what matters is that a chain
    // already older than the cap stops re-holding, not how long the cap is.
    process.env.RENDER_HOLD_MAX_MS = '1';
    let recorder = recordHoldStatements(testDbAdapter);
    try {
      // Opens the chain. Its release is deferred to this commit's indexing, so
      // the chain is still anchored when the next commit arrives — which is the
      // state the cap exists to bound.
      await push(instanceOps(0, 12, 1));
      assert.deepEqual(
        recorder.statements,
        ['acquire'],
        'the first commit of the chain holds the lane',
      );

      // Same shape, same realm, arriving while the chain is anchored — and now
      // past the cap. Holding here is what would starve the realm's rendering,
      // so this commit must take no lease at all: a fresh `acquire` writes a
      // full lease unconditionally, so declining to renew later is too late.
      await push(instanceOps(0, 12, 2));
      assert.deepEqual(
        recorder.statements,
        ['acquire'],
        'a commit past the cap adds no second hold',
      );
    } finally {
      delete process.env.RENDER_HOLD_MAX_MS;
      recorder.restore();
    }

    await realm.incrementalIndexing();
    await waitUntil(async () => (await liveHoldCount()) === 0, {
      timeout: 60_000,
      timeoutMessage: () => 'the chain never released the lane',
    });
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url, {
      timeout: 240_000,
    });
  });

  test('a commit that waits for its own indexing takes no hold', async function (assert) {
    assert.timeout(300_000);

    let recorder = recordHoldStatements(testDbAdapter);
    try {
      // `?waitForIndex=true` awaits the index pass inline, so the render job
      // exists and the realm is quiet again before the commit returns. There is
      // no window left for a later commit to merge into, so the hold would be
      // three queries buying nothing.
      let response = await request
        .post('/_atomic?waitForIndex=true')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(realm, 'user', ['read', 'write'])}`,
        )
        .send(JSON.stringify({ 'atomic:operations': instanceOps(0, 12, 3) }));
      assert.strictEqual(response.status, 201, 'the synchronous push lands');
    } finally {
      recorder.restore();
    }

    assert.deepEqual(
      recorder.statements,
      [],
      'a commit that indexes inline leaves the lane alone',
    );

    await realm.incrementalIndexing();
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url, {
      timeout: 240_000,
    });
  });

  test('a single-file write takes no hold', async function (assert) {
    assert.timeout(300_000);

    let recorder = recordHoldStatements(testDbAdapter);
    try {
      await push(instanceOps(0, 1));
      await realm.incrementalIndexing();
    } finally {
      recorder.restore();
    }

    assert.deepEqual(
      recorder.statements,
      [],
      'a write too small to outlast a render pass leaves the lane alone',
    );

    await realm.incrementalIndexing();
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url, {
      timeout: 240_000,
    });
  });

  test('work that lands on a held render lane waits there and merges into one pass', async function (assert) {
    assert.timeout(600_000);

    // Stand in for a long write still in progress. Taking the hold here rather
    // than racing a real one keeps the test off the wall clock; what it pins
    // down is the behaviour the write's own hold buys.
    let hold = await JobClaimHold.acquire(
      testDbAdapter,
      prerenderHtmlConcurrencyGroup(realm.url),
      120_000,
    );
    let released = false;
    try {
      await push(instanceOps(0, 12, 1));
      await realm.incrementalIndexing();

      let afterFirst = await unfulfilledPrerenderJobs();
      assert.strictEqual(
        afterFirst.length,
        1,
        'the first write leaves one prerender job on the lane',
      );
      assert.strictEqual(
        afterFirst[0].reservations,
        0,
        'no worker claimed it while the lane was held',
      );

      await push(instanceOps(0, 12, 2));
      await realm.incrementalIndexing();

      let afterSecond = await unfulfilledPrerenderJobs();
      assert.strictEqual(
        afterSecond.length,
        1,
        'the second write merges into the pending job instead of queueing behind it',
      );
      assert.strictEqual(
        afterSecond[0].id,
        afterFirst[0].id,
        'the merge target is the job that was already waiting',
      );
      let urls = new Set(afterSecond[0].urls);
      assert.strictEqual(
        afterSecond[0].urls.length,
        urls.size,
        'the merged set names each URL once',
      );
      for (let job of [afterFirst[0]]) {
        for (let url of job.urls) {
          assert.ok(urls.has(url), `${url} survived the merge`);
        }
      }

      await hold.release();
      released = true;
      // The writes took holds of their own, released off their indexing.
      // Waiting them out keeps the settle below measuring the render, not a
      // lane still held by something this test already drained.
      await waitUntil(async () => (await liveHoldCount()) === 0, {
        timeout: 60_000,
        timeoutMessage: () => 'a render hold outlived the writes that took it',
      });
      await settlePrerenderHtmlJobs(testDbAdapter, realm.url, {
        timeout: 240_000,
      });

      let rendered = (await testDbAdapter.execute(
        `select count(*)::int as n from prerendered_html
           where realm_url = $1 and type = 'instance'
             and coalesce(is_deleted, false) = false
             and isolated_html is not null`,
        { bind: [realm.url] },
      )) as { n: number }[];
      assert.strictEqual(
        rendered[0]?.n,
        24,
        'releasing the lane renders every card from both writes',
      );
    } finally {
      if (!released) {
        await hold.release();
      }
    }
  });
});
