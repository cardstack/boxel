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

    // Force the incremental index job's dependency-ordering step — part of the
    // setup phase, which runs before any file is visited — to throw, standing
    // in for a transient failure there (DB blip, ordering error). This is the
    // exact phase #runVisitLoop's per-URL isolation does NOT cover; the
    // recovery path must record an error doc for every URL the push handed the
    // job rather than dropping them silently. The fault is persistent, so the
    // job exhausts its attempts and stays failed, leaving the error docs in
    // place to assert on (a transient one would self-heal on retry). The
    // recovery writes are inserts/upserts, not this ordering SELECT, so they
    // still succeed.
    let originalExecute = testDbAdapter.execute.bind(testDbAdapter);
    let injectedThrows = 0;
    (testDbAdapter as unknown as { execute: unknown }).execute = async (
      ...execArgs: unknown[]
    ) => {
      let sql = execArgs[0];
      if (
        typeof sql === 'string' &&
        sql.includes('PARTITION BY url, type ORDER BY source_priority')
      ) {
        injectedThrows++;
        throw new Error('injected setup-phase failure');
      }
      return (originalExecute as (...a: unknown[]) => unknown)(...execArgs);
    };

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
      (testDbAdapter as unknown as { execute: unknown }).execute =
        originalExecute;
    }

    assert.ok(injectedThrows > 0, 'the injected setup-phase fault fired');

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
});
