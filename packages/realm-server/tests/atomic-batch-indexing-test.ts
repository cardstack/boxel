import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  createJWT,
  withRealmPath,
  searchCardsForTest,
  waitUntil,
  type RealmRequest,
} from './helpers/index.ts';
import {
  maxPrerenderHtmlJobId,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';

const testRealm = new URL('http://127.0.0.1:4445/test/');

// A realm whose only content is one card definition. Instances are pushed by
// the test through /_atomic, so the type starts with zero indexed instances
// and the post-push search count is unambiguous.
function makeFileSystem() {
  return {
    'person.gts': `
      import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import NumberField from "@cardstack/base/number";

      export class Person extends CardDef {
        @field firstName = contains(StringField);
        @field hourlyRate = contains(NumberField);
        // searchable so the index visit records the link on boxel_index.deps,
        // which the delete test relies on to fan out (and it does not appear in
        // any template, so tests that never set it are unaffected).
        @field friend = linksTo(() => Person, { searchable: true });
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName /> \${{@model.hourlyRate}}</h1>
          </template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h1> Embedded Card Person: <@fields.firstName/></h1>
          </template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <h1> Fitted Card Person: <@fields.firstName/></h1>
          </template>
        }
      }
    `,
  };
}

// Force the dependency-ordering scan of an incremental index job to throw. It
// runs in the setup phase — after the invalidation tombstones are written,
// before any file is visited — the phase #runVisitLoop's per-URL isolation
// cannot cover, so throwing here exercises the setup-phase recovery path AND
// leaves the in-flight `instance` tombstone in the working table (the state a
// naive recovery would wrongly promote). The `PARTITION BY` string is unique to
// `queryOrderingDependencyRows`; it appears in neither the `/_atomic` write nor
// the recovery's own writes (so the write still returns 201 and the recovery's
// rows still land), and it does not run on the prerender-html channel (so the
// spawned prerender job still succeeds — no retry congestion). The scan is
// skipped for a single-URL invalidation, so a caller must invalidate >=2 URLs
// to trigger it. Returns a restore fn and a throw counter; a refactor that
// moves the query leaves the counter at 0 and makes `throwCount() > 0` fail
// loudly rather than pass silently.
function injectSetupPhaseFailure(adapter: DBAdapter) {
  let original = adapter.execute.bind(adapter);
  let throws = 0;
  (adapter as unknown as { execute: unknown }).execute = async (
    ...execArgs: unknown[]
  ) => {
    let sql = execArgs[0];
    if (
      typeof sql === 'string' &&
      sql.includes('PARTITION BY url, type ORDER BY source_priority')
    ) {
      throws++;
      throw new Error('injected setup-phase failure');
    }
    return (original as (...a: unknown[]) => unknown)(...execArgs);
  };
  return {
    throwCount: () => throws,
    restore: () => {
      (adapter as unknown as { execute: unknown }).execute = original;
    },
  };
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let testDbAdapter: DBAdapter;
  let request: RealmRequest;

  setupPermissionedRealmCached(hooks, {
    mode: 'beforeEach',
    realmURL: testRealm,
    permissions: {
      '*': ['read', 'write'],
    },
    fileSystem: makeFileSystem(),
    onRealmSetup({ testRealm: r, dbAdapter, request: req }) {
      realm = r;
      testDbAdapter = dbAdapter;
      request = withRealmPath(req, testRealm);
    },
  });

  async function jobsFor(
    jobType: 'incremental-index' | 'prerender_html',
    concurrencyGroup: string,
  ): Promise<{ id: number; status: string }[]> {
    return (await testDbAdapter.execute(
      `select id, status from jobs
         where job_type = $1 and concurrency_group = $2
         order by id`,
      { bind: [jobType, concurrencyGroup] },
    )) as { id: number; status: string }[];
  }

  async function count(sql: string): Promise<number> {
    let rows = (await testDbAdapter.execute(sql, {
      bind: [realm.url],
    })) as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  test('a 50-instance /_atomic push that does not wait for indexing indexes and prerenders every instance with no dropped jobs and no error docs', async function (assert) {
    // Real prerendering of 50 instances across every format takes a while;
    // give the queue room to finish rather than tripping the default timeout.
    assert.timeout(300_000);

    const instanceCount = 50;
    const indexingGroup = `indexing:${realm.url}`;
    const prerenderGroup = `prerender-html:${realm.url}`;

    // Baselines captured before the push so the assertions below look only at
    // the jobs this push spawns, not the fixture build's own settled jobs.
    let prerenderBaseline = await maxPrerenderHtmlJobId(
      testDbAdapter,
      realm.url,
    );
    let indexBaselineJobs = await jobsFor('incremental-index', indexingGroup);
    let indexBaseline = indexBaselineJobs.reduce(
      (max, job) => Math.max(max, job.id),
      0,
    );

    // One atomic batch that creates 50 instances of the same type.
    let operations = Array.from({ length: instanceCount }, (_unused, i) => ({
      op: 'add',
      href: `person-${i}.json`,
      data: {
        type: 'card',
        attributes: { firstName: `Person ${i}`, hourlyRate: i },
        meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
      },
    }));

    // Plain /_atomic — no `?waitForIndex` — returns as soon as the writes are
    // durable, mirroring what `boxel realm push` does. Indexing then runs on
    // the queue, out of band from this response.
    let response = await request
      .post('/_atomic')
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, 'user', ['read', 'write'])}`,
      )
      .send(JSON.stringify({ 'atomic:operations': operations }));

    assert.strictEqual(response.status, 201, 'the push reports success');
    assert.strictEqual(
      response.body['atomic:results'].length,
      instanceCount,
      'the push acknowledges every pushed file',
    );

    // The push spawns work on two separate channels: the incremental index
    // job (all 50 URLs in one batch) and the prerender_html job the index
    // pass fires the moment its invalidation set is fixed. Drain the index
    // channel, then the prerender channel. `settlePrerenderHtmlJobs` throws if
    // any prerender_html job rejected, so a clean settle is itself part of the
    // "runs to completion without errors" assertion.
    await realm.incrementalIndexing();
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url, {
      afterJobId: prerenderBaseline,
      timeout: 240_000,
    });

    // Both jobs were kicked off and ran to completion — the batch was not
    // silently dropped, and neither channel rejected the job wholesale.
    let indexJobs = (await jobsFor('incremental-index', indexingGroup)).filter(
      (job) => job.id > indexBaseline,
    );
    assert.ok(
      indexJobs.length >= 1,
      'the push kicked off an incremental index job',
    );
    assert.notOk(
      indexJobs.some((job) => job.status === 'rejected'),
      'no incremental index job rejected',
    );
    assert.ok(
      indexJobs.every((job) => job.status === 'resolved'),
      `every incremental index job resolved (statuses: ${indexJobs
        .map((job) => job.status)
        .join(', ')})`,
    );

    let prerenderJobs = (
      await jobsFor('prerender_html', prerenderGroup)
    ).filter((job) => job.id > prerenderBaseline);
    assert.ok(
      prerenderJobs.length >= 1,
      'the push kicked off a prerender_html job',
    );
    assert.ok(
      prerenderJobs.every((job) => job.status === 'resolved'),
      `every prerender_html job resolved (statuses: ${prerenderJobs
        .map((job) => job.status)
        .join(', ')})`,
    );

    // Every pushed instance produced a live index row.
    let liveInstanceRows = await count(
      `select count(*)::int as n from boxel_index
         where realm_url = $1 and type = 'instance'
           and coalesce(is_deleted, false) = false`,
    );
    assert.strictEqual(
      liveInstanceRows,
      instanceCount,
      'every pushed instance produced a live index row',
    );

    // ...and every pushed instance is searchable by type — the count matches
    // the push, so nothing was left short.
    let { data } = await searchCardsForTest(realm.realmIndexQueryEngine, {
      filter: { type: { module: rri(`${testRealm}person`), name: 'Person' } },
      page: { number: 0, size: instanceCount * 2 },
    });
    assert.strictEqual(
      data.length,
      instanceCount,
      'every pushed instance is searchable by type',
    );

    // The prerender channel rendered HTML for every instance.
    let prerenderedRows = await count(
      `select count(*)::int as n from prerendered_html
         where realm_url = $1 and type = 'instance'
           and coalesce(is_deleted, false) = false
           and isolated_html is not null`,
    );
    assert.strictEqual(
      prerenderedRows,
      instanceCount,
      'the prerender channel rendered HTML for every instance',
    );

    // No error docs on either channel — nothing was half-indexed or recorded
    // as failed.
    let indexErrorDocs = await count(
      `select count(*)::int as n from boxel_index
         where realm_url = $1 and (has_error = true or error_doc is not null)`,
    );
    assert.strictEqual(indexErrorDocs, 0, 'no error docs on the index channel');

    let prerenderErrorDocs = await count(
      `select count(*)::int as n from prerendered_html
         where realm_url = $1 and error_doc is not null`,
    );
    assert.strictEqual(
      prerenderErrorDocs,
      0,
      'no error docs on the prerender channel',
    );
  });

  test('a throw in the invalidation phase records an error doc for every pushed file instead of dropping the batch silently', async function (assert) {
    assert.timeout(120_000);

    const fileCount = 5;
    const indexingGroup = `indexing:${realm.url}`;
    let indexBaselineJobs = await jobsFor('incremental-index', indexingGroup);
    let indexBaseline = indexBaselineJobs.reduce(
      (max, job) => Math.max(max, job.id),
      0,
    );

    // The fault is persistent, so the job exhausts its attempts and stays
    // failed, leaving the error docs in place to assert on (a transient one
    // would self-heal on retry).
    let fault = injectSetupPhaseFailure(testDbAdapter);

    let hrefs = Array.from(
      { length: fileCount },
      (_unused, i) => `${realm.url}broken-${i}.json`,
    );
    try {
      let operations = Array.from({ length: fileCount }, (_unused, i) => ({
        op: 'add',
        href: `broken-${i}.json`,
        data: {
          type: 'card',
          attributes: { firstName: `Broken ${i}` },
          meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
        },
      }));

      let response = await request
        .post('/_atomic')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(realm, 'user', ['read', 'write'])}`,
        )
        .send(JSON.stringify({ 'atomic:operations': operations }));
      assert.strictEqual(
        response.status,
        201,
        'the push still reports success — the writes are durable regardless of indexing',
      );

      // The job runs, fails in the setup phase, retries, and after its
      // attempts are exhausted is marked rejected.
      await waitUntil(
        async () => {
          let jobs = (await jobsFor('incremental-index', indexingGroup)).filter(
            (job) => job.id > indexBaseline,
          );
          return (
            jobs.length > 0 && jobs.every((job) => job.status === 'rejected')
          );
        },
        {
          timeout: 90_000,
          interval: 100,
          timeoutMessage:
            'incremental index job did not reject after the injected setup-phase failure',
        },
      );
    } finally {
      fault.restore();
    }

    assert.ok(fault.throwCount() > 0, 'the injected setup-phase fault fired');

    // Every pushed file has an error doc — the drop is visible in boxel_index
    // instead of vanishing.
    for (let href of hrefs) {
      let [row] = (await testDbAdapter.execute(
        `select has_error, error_doc from boxel_index where url = $1 and type = 'instance'`,
        { bind: [href] },
      )) as { has_error: boolean | null; error_doc: unknown }[];
      assert.ok(row, `an index row exists for ${href}`);
      assert.true(
        Boolean(row?.has_error),
        `${href} is recorded as an error doc after the setup-phase failure`,
      );
    }

    // The unrelated module row is untouched: the recovery wrote error docs
    // only for the pushed URLs and never promoted the fan-out tombstones, so
    // nothing was collaterally deleted.
    let moduleRows = (await testDbAdapter.execute(
      `select has_error from boxel_index
         where (url = $1 or file_alias = $1) and type = 'file'`,
      { bind: [`${realm.url}person.gts`] },
    )) as { has_error: boolean | null }[];
    assert.strictEqual(
      moduleRows.length,
      1,
      'the module still has its index row',
    );
    assert.notOk(
      Boolean(moduleRows[0]?.has_error),
      'the module row is still clean — nothing was collaterally deleted or errored',
    );
  });

  test('a setup-phase failure on a delete leaves the existing card live for the retry rather than deleting it', async function (assert) {
    assert.timeout(120_000);

    const indexingGroup = `indexing:${realm.url}`;
    const cardUrl = `${realm.url}keep-me.json`;

    const linkerUrl = `${realm.url}linker.json`;

    // Seed the target card, then a second card that links to it — in separate
    // settled pushes so the link resolves against an already-indexed target.
    // The link is searchable, so it lands on `boxel_index.deps`; deleting the
    // target then invalidates both cards, and that >=2-URL fan-out is what
    // makes the dependency-ordering step (and thus the injected fault) run.
    async function pushCard(href: string, doc: Record<string, unknown>) {
      let res = await request
        .post('/_atomic')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(realm, 'user', ['read', 'write'])}`,
        )
        .send(
          JSON.stringify({
            'atomic:operations': [{ op: 'add', href, data: doc }],
          }),
        );
      assert.strictEqual(res.status, 201, `seeded ${href}`);
      await realm.incrementalIndexing();
      await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
    }

    await pushCard('keep-me.json', {
      type: 'card',
      attributes: { firstName: 'Keep Me' },
      meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
    });
    await pushCard('linker.json', {
      type: 'card',
      attributes: { firstName: 'Linker' },
      relationships: { friend: { links: { self: './keep-me' } } },
      meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
    });

    let [before] = (await testDbAdapter.execute(
      `select is_deleted from boxel_index where url = $1 and type = 'instance'`,
      { bind: [cardUrl] },
    )) as { is_deleted: boolean | null }[];
    assert.notOk(
      Boolean(before?.is_deleted),
      'precondition: the target card indexed as a live instance',
    );

    // Fail fast (rather than time out below) if the link didn't record: the
    // delete fans out to the linker — and so runs the ordering step the fault
    // targets — only when the linker depends on the target.
    let [linkerRow] = (await testDbAdapter.execute(
      `select deps from boxel_index where url = $1 and type = 'instance'`,
      { bind: [linkerUrl] },
    )) as { deps: unknown }[];
    let linkerDeps: string[] = Array.isArray(linkerRow?.deps)
      ? (linkerRow!.deps as string[])
      : typeof linkerRow?.deps === 'string'
        ? (JSON.parse(linkerRow!.deps as string) as string[])
        : [];
    assert.ok(
      linkerDeps.some((d) => d.includes('keep-me')),
      `precondition: the linker records a dependency on the target (deps: ${JSON.stringify(linkerDeps)})`,
    );

    let indexBaseline = (
      await jobsFor('incremental-index', indexingGroup)
    ).reduce((max, job) => Math.max(max, job.id), 0);

    // Delete the target while the dependency-ordering step throws — after the
    // invalidation tombstones are written, so the in-flight `instance`
    // tombstone exists and would be promoted by a naive recovery. The recovery
    // must NOT promote it (a failed job must not half-apply the delete); the
    // card stays live until a retry completes it.
    let fault = injectSetupPhaseFailure(testDbAdapter);
    let after:
      | { is_deleted: boolean | null; has_error: boolean | null }
      | undefined;
    try {
      await realm.delete('keep-me.json', { waitForIndex: false });
      // Wait for the delete's index job to run its first attempt to
      // completion — that attempt's setup throws and its recovery runs, which
      // is what decides the card's fate (a naive recovery deletes it here, the
      // fixed one leaves it). Gate on a completed reservation rather than the
      // job reaching `rejected`: the recovery's verdict is final after the
      // first attempt, and waiting for the full retry-to-rejection is both
      // unnecessary and slow.
      let deleteJobId = -1;
      await waitUntil(
        async () => {
          let jobs = (await jobsFor('incremental-index', indexingGroup)).filter(
            (job) => job.id > indexBaseline,
          );
          if (jobs.length === 0) {
            return false;
          }
          deleteJobId = jobs[0].id;
          let [reservation] = (await testDbAdapter.execute(
            `select count(*)::int as n from job_reservations
               where job_id = $1 and completed_at is not null`,
            { bind: [deleteJobId] },
          )) as { n: number }[];
          return (reservation?.n ?? 0) >= 1;
        },
        {
          timeout: 90_000,
          interval: 100,
          timeoutMessage:
            'delete index job did not attempt/fail after the injected setup-phase failure',
        },
      );
      // Snapshot the card while the fault is still active: once it is lifted a
      // retry would legitimately complete the delete, so the assertion must
      // read the state the failed attempt left, not a later successful one.
      [after] = (await testDbAdapter.execute(
        `select is_deleted, has_error from boxel_index where url = $1 and type = 'instance'`,
        { bind: [cardUrl] },
      )) as { is_deleted: boolean | null; has_error: boolean | null }[];
    } finally {
      fault.restore();
    }

    assert.ok(fault.throwCount() > 0, 'the injected setup-phase fault fired');
    assert.ok(after, 'the card still has an index row');
    assert.notOk(
      Boolean(after?.is_deleted),
      'the failed delete did not prematurely delete the card',
    );
    assert.notOk(
      Boolean(after?.has_error),
      'the failed delete did not spuriously error the card',
    );
  });
});
