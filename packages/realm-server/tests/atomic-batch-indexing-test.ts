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
// to trigger it. The fault is persistent while armed: a thrown job error is
// rejected outright (no in-queue retry), so the failed state holds for
// assertions until `restore()` lifts the fault. Returns a restore fn and a
// throw counter; a refactor that moves the query leaves the counter at 0 and
// makes `throwCount() > 0` fail loudly rather than pass silently.
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

    // The fault holds for the whole scenario, so the job rejects and the
    // failed state stays put for the assertions below.
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

    // Delete the target while the dependency-ordering step throws — after the
    // invalidation tombstones are written, so the in-flight `instance`
    // tombstone exists and would be promoted by a naive recovery. The recovery
    // must NOT promote it (a failed job must not half-apply the delete); the
    // card stays live until a later successful pass completes the delete.
    let fault = injectSetupPhaseFailure(testDbAdapter);
    let after:
      | { is_deleted: boolean | null; has_error: boolean | null }
      | undefined;
    try {
      await realm.delete('keep-me.json', { waitForIndex: false });
      // The fault firing is the proof the delete's index job ran its setup
      // phase — past `invalidate()`, which seeded the working-table delete
      // tombstones — and threw. Waiting on the in-process signal keeps the
      // test off job-table finalization timing, which is not the contract
      // under test.
      await waitUntil(async () => fault.throwCount() >= 1, {
        timeout: 60_000,
        interval: 100,
        timeoutMessage:
          'the delete index job never reached the injected ordering fault',
      });
      // While the fault holds, no code path may touch the card's production
      // row: the failed pass never promotes (its swap is unreached) and the
      // recovery skips delete URLs outright. Watch the row across a short
      // window so a recovery that wrongly promoted the delete tombstone — or
      // recorded a spurious error — is caught even though it lands a beat
      // after the throw.
      for (let check = 1; check <= 5; check++) {
        [after] = (await testDbAdapter.execute(
          `select is_deleted, has_error from boxel_index where url = $1 and type = 'instance'`,
          { bind: [cardUrl] },
        )) as { is_deleted: boolean | null; has_error: boolean | null }[];
        assert.ok(after, `the card still has an index row (check ${check})`);
        assert.notOk(
          Boolean(after?.is_deleted),
          `the failed delete did not prematurely delete the card (check ${check})`,
        );
        assert.notOk(
          Boolean(after?.has_error),
          `the failed delete did not spuriously error the card (check ${check})`,
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } finally {
      fault.restore();
    }
  });

  test('a setup-phase failure on an update whose on-disk content is not a card preserves the existing card as an error doc rather than deleting it', async function (assert) {
    assert.timeout(120_000);

    const cardUrl = `${realm.url}keep-me.json`;
    const linkerUrl = `${realm.url}linker.json`;

    // Same seeding as the delete case: the searchable link gives the update a
    // >=2-URL fan-out so the ordering step (and the fault) runs.
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

    // Overwrite the existing card's file with JSON that is NOT a card
    // resource, while the setup phase throws. The recovery cannot classify
    // the URL from the on-disk content (it no longer parses as a card), so it
    // must fall back to the production index — which still records the URL as
    // a live card — and preserve it as an instance error. A recovery that
    // trusts only the file re-read would skip the instance-error write here
    // and let the in-flight `instance` tombstone promote, silently deleting
    // the card.
    let fault = injectSetupPhaseFailure(testDbAdapter);
    let after:
      | { is_deleted: boolean | null; has_error: boolean | null }
      | undefined;
    let linkerAfter:
      | { is_deleted: boolean | null; has_error: boolean | null }
      | undefined;
    try {
      await realm.write(
        'keep-me.json',
        JSON.stringify({ data: { type: 'widget' } }),
        { waitForIndex: false },
      );
      // The recovery's own write — the error doc landing on the existing
      // card — is the observable outcome, so wait on it directly rather
      // than on job-table finalization timing.
      await waitUntil(
        async () => {
          let [row] = (await testDbAdapter.execute(
            `select has_error from boxel_index where url = $1 and type = 'instance'`,
            { bind: [cardUrl] },
          )) as { has_error: boolean | null }[];
          return Boolean(row?.has_error);
        },
        {
          timeout: 90_000,
          interval: 100,
          timeoutMessage:
            'the failed update never recorded an error doc on the existing card',
        },
      );
      // Snapshot while the fault is still active — once it lifts, a later
      // pass could legitimately re-index and change the state under
      // assertion.
      [after] = (await testDbAdapter.execute(
        `select is_deleted, has_error from boxel_index where url = $1 and type = 'instance'`,
        { bind: [cardUrl] },
      )) as { is_deleted: boolean | null; has_error: boolean | null }[];
      [linkerAfter] = (await testDbAdapter.execute(
        `select is_deleted, has_error from boxel_index where url = $1 and type = 'instance'`,
        { bind: [linkerUrl] },
      )) as { is_deleted: boolean | null; has_error: boolean | null }[];
    } finally {
      fault.restore();
    }

    assert.ok(fault.throwCount() > 0, 'the injected setup-phase fault fired');
    assert.ok(after, 'the card still has an index row');
    assert.notOk(
      Boolean(after?.is_deleted),
      'the existing card was preserved, not deleted',
    );
    assert.true(
      Boolean(after?.has_error),
      'the failed update is visible as an error doc on the existing card',
    );
    assert.notOk(
      Boolean(linkerAfter?.is_deleted),
      'the dependent card was left untouched — the fan-out tombstones were not promoted',
    );
  });

  test('re-pushing files whose batch failed at setup replaces their error docs with clean rows', async function (assert) {
    assert.timeout(300_000);

    const fileCount = 3;
    let hrefs = Array.from(
      { length: fileCount },
      (_unused, i) => `${realm.url}heal-${i}.json`,
    );

    async function pushBatch(op: 'add' | 'update', nameSuffix: string) {
      let operations = Array.from({ length: fileCount }, (_unused, i) => ({
        op,
        href: `heal-${i}.json`,
        data: {
          type: 'card',
          attributes: { firstName: `Heal ${i}${nameSuffix}` },
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
        `the ${op} push reports success`,
      );
    }

    // A thrown job error is rejected outright — no in-queue retry — so a
    // setup-phase failure leaves the batch as error docs. The recovery they
    // enable is any subsequent write touching those URLs: error rows are
    // invalidated like any others, so a clean re-push replaces them without
    // an operator full-reindex.
    let fault = injectSetupPhaseFailure(testDbAdapter);
    try {
      await pushBatch('add', '');
      // Outcome-based wait: the failed batch's error docs land on every
      // pushed file.
      await waitUntil(
        async () => {
          let [row] = (await testDbAdapter.execute(
            `select count(*)::int as n from boxel_index
               where realm_url = $1 and has_error = true`,
            { bind: [realm.url] },
          )) as { n: number }[];
          return (row?.n ?? 0) >= fileCount;
        },
        {
          timeout: 90_000,
          interval: 200,
          timeoutMessage:
            'the failed batch never recorded error docs for the pushed files',
        },
      );
    } finally {
      fault.restore();
    }
    assert.ok(fault.throwCount() > 0, 'the injected setup-phase fault fired');

    // Re-push the same files with the fault lifted; the clean pass replaces
    // every error doc.
    let prerenderBaseline = await maxPrerenderHtmlJobId(
      testDbAdapter,
      realm.url,
    );
    await pushBatch('update', ' healed');
    await realm.incrementalIndexing();
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url, {
      afterJobId: prerenderBaseline,
      timeout: 240_000,
    });

    for (let href of hrefs) {
      let [row] = (await testDbAdapter.execute(
        `select is_deleted, has_error from boxel_index where url = $1 and type = 'instance'`,
        { bind: [href] },
      )) as { is_deleted: boolean | null; has_error: boolean | null }[];
      assert.ok(row, `${href} has an index row`);
      assert.notOk(Boolean(row?.is_deleted), `${href} is live`);
      assert.notOk(
        Boolean(row?.has_error),
        `${href} is clean — the re-push replaced its error doc`,
      );
    }

    let [errorDocs] = (await testDbAdapter.execute(
      `select count(*)::int as n from boxel_index
         where realm_url = $1 and (has_error = true or error_doc is not null)`,
      { bind: [realm.url] },
    )) as { n: number }[];
    let remainingErrorDocs = errorDocs?.n ?? 0;
    assert.strictEqual(
      remainingErrorDocs,
      0,
      'no error docs remain anywhere in the realm after the re-push',
    );
  });

  test('a from-scratch setup failure leaves the production index intact', async function (assert) {
    assert.timeout(180_000);

    const cardUrl = `${realm.url}keep-me.json`;

    // Seed one indexed card so there is production state to protect.
    let seed = await request
      .post('/_atomic')
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, 'user', ['read', 'write'])}`,
      )
      .send(
        JSON.stringify({
          'atomic:operations': [
            {
              op: 'add',
              href: 'keep-me.json',
              data: {
                type: 'card',
                attributes: { firstName: 'Keep Me' },
                meta: {
                  adoptsFrom: { module: rri('./person'), name: 'Person' },
                },
              },
            },
          ],
        }),
      );
    assert.strictEqual(seed.status, 201, 'the seed card was written');
    await realm.incrementalIndexing();
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url);

    let liveRowsBefore = (await testDbAdapter.execute(
      `select url, type from boxel_index
         where realm_url = $1 and coalesce(is_deleted, false) = false
         order by url, type`,
      { bind: [realm.url] },
    )) as { url: string; type: string }[];
    assert.ok(
      liveRowsBefore.some((row) => row.url === cardUrl),
      'precondition: the seed card is live in the index',
    );

    // A from-scratch pass replaces the index only at its final swap; a
    // setup-phase throw happens before any swap, so a failed from-scratch
    // must leave the previous index serving unchanged (the recovery model
    // for a whole-realm rebuild is retry/re-run, not per-URL error docs —
    // the job's arguments carry no per-file URL set to attribute errors to).
    //
    // Publish without awaiting completion: the terminal state here is a
    // failed job, and awaiting it couples the test to job-table finalization
    // timing. The fault firing proves the pass ran its setup and threw; the
    // assertions below are on the index itself.
    let fault = injectSetupPhaseFailure(testDbAdapter);
    try {
      let { published, completed } = realm.realmIndexUpdater.publishFullIndex();
      completed.catch(() => {
        // The failure is expected; the intact index below is the outcome
        // under assertion.
      });
      await published;
      await waitUntil(async () => fault.throwCount() >= 1, {
        timeout: 90_000,
        interval: 100,
        timeoutMessage:
          'the from-scratch pass never reached the injected ordering fault',
      });
      // Watch the live rows across a short window while the fault holds, so a
      // failed pass that mutated production a beat after the throw is caught.
      for (let check = 1; check <= 5; check++) {
        let liveRowsAfter = (await testDbAdapter.execute(
          `select url, type from boxel_index
             where realm_url = $1 and coalesce(is_deleted, false) = false
             order by url, type`,
          { bind: [realm.url] },
        )) as { url: string; type: string }[];
        assert.deepEqual(
          liveRowsAfter,
          liveRowsBefore,
          `the live index rows are unchanged after the failed from-scratch pass (check ${check})`,
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } finally {
      fault.restore();
    }

    let [cardRow] = (await testDbAdapter.execute(
      `select is_deleted, has_error from boxel_index where url = $1 and type = 'instance'`,
      { bind: [cardUrl] },
    )) as { is_deleted: boolean | null; has_error: boolean | null }[];
    assert.notOk(Boolean(cardRow?.is_deleted), 'the seed card is still live');
    assert.notOk(Boolean(cardRow?.has_error), 'the seed card is still clean');
  });
});
