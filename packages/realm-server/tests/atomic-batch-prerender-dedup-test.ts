import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { DirResult } from 'tmp';
import type { PgAdapter } from '@cardstack/postgres';

import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  setupPermissionedRealmCached,
  setupMatrixRoom,
  createJWT,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';
import { settlePrerenderHtmlJobs } from './helpers/indexing.ts';

const testRealm = new URL('http://127.0.0.1:4445/test/');

// A batch that mixes modules and instances is written in two index passes:
// `_batchWriteUnlocked` sorts modules first and flushes them to the index
// before serializing the first instance, because fileSerialization's
// lookupDefinition needs them there. Each index pass spawns a prerender_html
// job for its invalidation set, and the flush's set is every dependent of
// those modules — which includes the instances the same batch is about to
// write. Left alone, the write renders those instances twice: once from the
// pre-write content the flush sees, and again from the content it just wrote.
// These tests pin the write down to a single prerender pass over each URL.
function makeFileSystem() {
  return {
    'person.gts': personModule(0),
  };
}

// The module's source, parameterized so a re-push can present genuinely
// changed content — an unchanged write is short-circuited in
// `_batchWriteUnlocked` and spawns no index pass at all.
function personModule(revision: number) {
  return `
    import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import NumberField from "@cardstack/base/number";

    export class Person extends CardDef {
      @field firstName = contains(StringField);
      @field hourlyRate = contains(NumberField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h1><@fields.firstName /> \${{@model.hourlyRate}} (rev ${revision})</h1>
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
  `;
}

interface PrerenderJobRow {
  id: number;
  status: string;
  urls: string[];
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

  async function maxJobId(): Promise<number> {
    let rows = (await testDbAdapter.execute(
      `select coalesce(max(id), 0)::int as n from jobs`,
    )) as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  // The realm's prerender_html jobs newer than `baseline`, each with the URL
  // list it was handed. Summed, those lists are the renders the write paid
  // for; de-duplicated, they are the renders it actually needed.
  async function prerenderJobsSince(
    baseline: number,
  ): Promise<PrerenderJobRow[]> {
    let rows = (await testDbAdapter.execute(
      `select id, status,
              coalesce(
                (select array_agg(change->>'url')
                   from jsonb_array_elements(args->'changes') as change),
                array[]::text[]
              ) as urls
         from jobs
        where job_type = 'prerender_html'
          and (concurrency_group = $1 or lane_family = $1)
          and id > $2
        order by id`,
      { bind: [`prerender-html:${realm.url}`, baseline] },
    )) as unknown as PrerenderJobRow[];
    return rows;
  }

  function assertRenderedOnce(assert: Assert, jobs: PrerenderJobRow[]) {
    let all = jobs.flatMap((job) => job.urls);
    let unique = new Set(all);
    let repeated = [...unique].filter(
      (url) => all.filter((candidate) => candidate === url).length > 1,
    );
    assert.deepEqual(
      repeated,
      [],
      `no URL is rendered more than once across the write's prerender passes (paid for ${all.length} renders of ${unique.size} URLs)`,
    );
  }

  function instanceOps(
    from: number,
    count: number,
    op: 'add' | 'update',
    revision = 0,
  ) {
    return Array.from({ length: count }, (_unused, i) => ({
      op,
      href: `person-${from + i}.json`,
      data: {
        type: 'card',
        attributes: {
          firstName: `Person ${from + i} rev ${revision}`,
          hourlyRate: from + i,
        },
        meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
      },
    }));
  }

  function moduleOp(revision: number) {
    return {
      op: 'update',
      href: 'person.gts',
      data: {
        type: 'source',
        attributes: { content: personModule(revision) },
        meta: {},
      },
    };
  }

  // Plain /_atomic, no `?waitForIndex` — the wire shape `boxel realm push`
  // uses. Returns as soon as the writes are durable; indexing runs on the
  // queue out of band.
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

  async function drain() {
    await realm.incrementalIndexing();
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url, {
      timeout: 240_000,
    });
  }

  async function liveHtmlCount(): Promise<number> {
    let rows = (await testDbAdapter.execute(
      `select count(*)::int as n from prerendered_html
         where realm_url = $1 and type = 'instance'
           and coalesce(is_deleted, false) = false
           and isolated_html is not null`,
      { bind: [realm.url] },
    )) as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  test('a batch mixing a changed module with new instances renders through one prerender pass', async function (assert) {
    assert.timeout(600_000);

    await push(instanceOps(0, 20, 'add'));
    await drain();

    let baseline = await maxJobId();
    // The module revision invalidates the 20 instances already indexed; the
    // batch adds 20 more. All 40 need exactly one render, and so does the
    // module itself.
    await push([moduleOp(1), ...instanceOps(20, 20, 'add')]);
    await drain();

    let jobs = await prerenderJobsSince(baseline);
    assert.ok(
      jobs.every((job) => job.status === 'resolved'),
      `every prerender job resolved (statuses: ${jobs.map((job) => job.status).join(', ')})`,
    );
    assert.strictEqual(
      jobs.length,
      1,
      'the write spawns a single prerender pass rather than one per index pass',
    );
    assertRenderedOnce(assert, jobs);
    assert.strictEqual(
      await liveHtmlCount(),
      40,
      'every instance in the realm has rendered HTML',
    );
  });

  test('re-pushing a changed module alongside the same instances does not render them twice', async function (assert) {
    assert.timeout(600_000);

    await push(instanceOps(0, 20, 'add'));
    await drain();

    let baseline = await maxJobId();
    // The shape that doubles the work: the flush's dependents and the
    // batch's own instances are the same 20 cards. `boxel realm push --force`
    // produces exactly this, as does any push whose local manifest is gone.
    await push([moduleOp(1), ...instanceOps(0, 20, 'update', 1)]);
    await drain();

    let jobs = await prerenderJobsSince(baseline);
    assert.ok(
      jobs.every((job) => job.status === 'resolved'),
      `every prerender job resolved (statuses: ${jobs.map((job) => job.status).join(', ')})`,
    );
    assert.strictEqual(
      jobs.length,
      1,
      'the write spawns a single prerender pass rather than one per index pass',
    );
    assertRenderedOnce(assert, jobs);
    assert.strictEqual(
      jobs[0].urls.length,
      21,
      'the pass covers the 20 instances and the module, once each',
    );
    assert.strictEqual(
      await liveHtmlCount(),
      20,
      'every instance in the realm has rendered HTML',
    );
  });
});
