import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { SuperTest, Test } from 'supertest';
import {
  INDEX_PENDING_HEADER,
  rri,
  type Realm,
} from '@cardstack/runtime-common';
import { indexingConcurrencyGroup } from '@cardstack/runtime-common/jobs/indexing';
import type { PgAdapter } from '@cardstack/postgres';
import {
  createJWT,
  searchCardsForTest,
  setupPermissionedRealmCached,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

// A card create waits for its own index pass for a bounded time, and past it
// answers from the document it stored. The pass runs in the realm's one
// indexing lane, so behind a long pass it can be minutes away — and until the
// 201 arrives the client holds the new card with no id to link it by.
//
// The lane is held the way it is in production: a job in the realm's lane,
// claimed by a worker that never finishes it. The create's own job queues
// behind it, exactly as a create queues behind another writer's fan-out, and
// nothing about the create itself is stubbed.

const personGts = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Person extends CardDef {
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field fullName = contains(StringField, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
  }
`;

// Well past the create's budget, and well short of the read drain's, so a
// create that waited on the lane — or a read that drained behind it — cannot
// pass for one that answered from the file.
const PROMPT_ANSWER_MS = 5_000;
const CREATE_BUDGET_MS = 300;

module(basename(import.meta.filename), function () {
  module('card create index wait', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4451/create-index-wait/');
    let realm: Realm;
    let request: RealmRequest;
    let dbAdapter: PgAdapter;

    setupPermissionedRealmCached(hooks, {
      mode: 'beforeEach',
      realmURL,
      permissions: {
        writer: ['read', 'write'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      fileSystem: {
        'person.gts': personGts,
      },
      createIndexWaitBudgetMs: CREATE_BUDGET_MS,
      onRealmSetup(args: {
        testRealm: Realm;
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) {
        realm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
        dbAdapter = args.dbAdapter;
      },
    });

    function auth() {
      return `Bearer ${createJWT(realm, 'writer', ['read', 'write'])}`;
    }

    // A job in this realm's index lane behind a reservation that does not
    // expire — a worker that claimed it and never finished. pg-queue skips a
    // concurrency group holding a live reservation, so every index job the
    // realm queues after this one waits until it is removed.
    async function holdIndexingLane(): Promise<() => Promise<void>> {
      let [{ id: jobId }] = (await dbAdapter.execute(
        `INSERT INTO jobs (job_type, concurrency_group, args, status, timeout)
         VALUES ('incremental-index', $1, '{}'::jsonb, 'unfulfilled', 7200)
         RETURNING id`,
        { bind: [indexingConcurrencyGroup(realmURL.href)] },
      )) as unknown as { id: string }[];
      let release = async () => {
        await dbAdapter.execute(
          'DELETE FROM job_reservations WHERE job_id = $1',
          { bind: [jobId] },
        );
        await dbAdapter.execute('DELETE FROM jobs WHERE id = $1', {
          bind: [jobId],
        });
      };
      try {
        await dbAdapter.execute(
          `INSERT INTO job_reservations (job_id, worker_id, locked_until)
           VALUES ($1, 'create-index-wait-test-worker', NOW() + INTERVAL '7200 seconds')`,
          { bind: [jobId] },
        );
      } catch (err) {
        await release();
        throw err;
      }
      return release;
    }

    test('behind a held lane, a create answers with its id from the stored document, and the card reads back by id', async function (assert) {
      assert.timeout(60_000);
      let release = await holdIndexingLane();
      let released = false;
      try {
        let startedAt = Date.now();
        let create = await request
          .post('/')
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', auth())
          .send(personDoc(realmURL, 'Van Gogh', 'Tangle'));
        let createMs = Date.now() - startedAt;

        assert.strictEqual(create.status, 201, `HTTP 201: ${create.text}`);
        assert.true(
          createMs < PROMPT_ANSWER_MS,
          `the create answered in ${createMs}ms rather than waiting on the lane`,
        );
        assert.strictEqual(
          create.headers[INDEX_PENDING_HEADER],
          'true',
          'the answer says the index has not caught up with the card',
        );
        let id = create.body.data.id as string;
        assert.ok(id, 'the answer carries the new card id');
        assert.strictEqual(
          create.body.data.attributes?.lastName,
          'Tangle',
          'the document is the one the create stored',
        );

        let readStartedAt = Date.now();
        let read = await request
          .get(new URL(id).pathname)
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', auth());
        let readMs = Date.now() - readStartedAt;
        assert.strictEqual(read.status, 200, `HTTP 200: ${read.text}`);
        assert.true(
          readMs < PROMPT_ANSWER_MS,
          `the writer's read answered in ${readMs}ms rather than draining behind the lane`,
        );
        assert.strictEqual(
          read.headers[INDEX_PENDING_HEADER],
          'true',
          'the read is served from the file while the row is pending',
        );
        assert.strictEqual(
          read.body.data.attributes?.firstName,
          'Van Gogh',
          'the read returns the card just created',
        );

        let head = await request
          .head(new URL(id).pathname)
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', auth());
        assert.strictEqual(head.status, 200, 'a HEAD agrees with the GET');
        assert.strictEqual(
          head.headers[INDEX_PENDING_HEADER],
          'true',
          'and says the same about the row',
        );

        await release();
        released = true;
        await realm.incrementalIndexing();

        let indexed = await request
          .get(new URL(id).pathname)
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', auth());
        assert.strictEqual(indexed.status, 200, `HTTP 200: ${indexed.text}`);
        assert.strictEqual(
          indexed.headers[INDEX_PENDING_HEADER],
          undefined,
          'once the pass lands the card is served from the index',
        );
        assert.strictEqual(
          indexed.body.data.attributes?.fullName,
          'Van Gogh Tangle',
          'with the fields only the index computes',
        );
        let { data } = await searchCardsForTest(realm.realmIndexQueryEngine, {
          filter: {
            type: { module: rri(`${realmURL.href}person`), name: 'Person' },
          },
        });
        assert.deepEqual(
          data.map((resource) => resource.attributes?.lastName),
          ['Tangle'],
          'and search finds it',
        );
      } finally {
        if (!released) {
          await release();
          await realm.incrementalIndexing();
        }
      }
    });
  });

  // With no budget named, the test realm waits for a create's pass for as
  // long as it takes, which is what an idle lane amounts to: the pass lands
  // inside the wait, whatever the test box's speed.
  module('card create on an idle lane', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4451/create-idle-lane/');
    let realm: Realm;
    let request: RealmRequest;

    setupPermissionedRealmCached(hooks, {
      mode: 'beforeEach',
      realmURL,
      permissions: {
        writer: ['read', 'write'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      fileSystem: {
        'person.gts': personGts,
      },
      onRealmSetup(args: { testRealm: Realm; request: SuperTest<Test> }) {
        realm = args.testRealm;
        request = withRealmPath(args.request, realmURL);
      },
    });

    test('a create answers from the index as its pass lands', async function (assert) {
      assert.timeout(60_000);
      let create = await request
        .post('/')
        .set('Accept', 'application/vnd.card+json')
        .set(
          'Authorization',
          `Bearer ${createJWT(realm, 'writer', ['read', 'write'])}`,
        )
        .send(personDoc(realmURL, 'Mango', 'Abdel-Rahman'));

      assert.strictEqual(create.status, 201, `HTTP 201: ${create.text}`);
      assert.strictEqual(
        create.headers[INDEX_PENDING_HEADER],
        undefined,
        'the answer comes from the index',
      );
      assert.strictEqual(
        create.body.data.attributes?.fullName,
        'Mango Abdel-Rahman',
        'so it carries the fields only the index computes',
      );
      let { data } = await searchCardsForTest(realm.realmIndexQueryEngine, {
        filter: {
          type: { module: rri(`${realmURL.href}person`), name: 'Person' },
        },
      });
      assert.deepEqual(
        data.map((resource) => resource.attributes?.lastName),
        ['Abdel-Rahman'],
        "and the writer's next search sees the card",
      );
    });
  });
});

function personDoc(realmURL: URL, firstName: string, lastName: string) {
  return {
    data: {
      type: 'card',
      attributes: { firstName, lastName },
      meta: {
        adoptsFrom: {
          module: rri(`${realmURL.href}person`),
          name: 'Person',
        },
      },
    },
  };
}
