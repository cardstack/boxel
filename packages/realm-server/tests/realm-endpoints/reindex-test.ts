import { module, test } from 'qunit';
import { basename, join } from 'path';
import { readFileSync, utimesSync, writeFileSync } from 'fs';
import type { SuperTest, Test } from 'supertest';
import type { Realm } from '@cardstack/runtime-common';
import type { MatrixEvent } from 'https://cardstack.com/base/matrix-event';
import type { Server } from 'http';
import type { DirResult } from 'tmp';
import {
  createJWT,
  setupMatrixRoom,
  setupPermissionedRealmCached,
  testRealmHref,
  waitUntil,
} from '../helpers';
import type { PgAdapter as TestPgAdapter } from '@cardstack/postgres';

const PERSON_CARD_SOURCE = `
import {
  contains,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Person extends CardDef {
  static displayName = 'Person';
  @field firstName = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Person) {
      return this.firstName;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1 data-test-card><@fields.firstName /></h1>
    </template>
  };
}
`;

const ARTICLE_CARD_SOURCE = `
import {
  contains,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Article extends CardDef {
  static displayName = 'Article';
  @field title = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Article) {
      return this.title;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1 data-test-card><@fields.title /></h1>
    </template>
  };
}
`;

const PERSON_INSTANCE = JSON.stringify({
  data: {
    type: 'card',
    attributes: {
      firstName: 'Mango',
    },
    meta: {
      adoptsFrom: {
        module: './person.gts',
        name: 'Person',
      },
    },
  },
});

const ARTICLE_INSTANCE = JSON.stringify({
  data: {
    type: 'card',
    attributes: {
      title: 'Unchanged Article',
    },
    meta: {
      adoptsFrom: {
        module: './article.gts',
        name: 'Article',
      },
    },
  },
});

module(`realm-endpoints/${basename(__filename)}`, function () {
  module(
    'Realm-specific Endpoints | POST _reindex and _full-reindex',
    function (hooks) {
      let testRealm: Realm;
      let request: SuperTest<Test>;
      let dbAdapter: TestPgAdapter;
      let testRealmPath: string;
      let testRealmHttpServer: Server;
      let dir: DirResult;

      function onRealmSetup(args: {
        testRealm: Realm;
        request: SuperTest<Test>;
        dbAdapter: TestPgAdapter;
        testRealmPath: string;
        testRealmHttpServer: Server;
        dir: DirResult;
      }) {
        testRealm = args.testRealm;
        request = args.request;
        dbAdapter = args.dbAdapter;
        testRealmPath = args.testRealmPath;
        testRealmHttpServer = args.testRealmHttpServer;
        dir = args.dir;
      }

      setupPermissionedRealmCached(hooks, {
        subscribeToRealmEvents: true,
        fileSystem: {
          'person.gts': PERSON_CARD_SOURCE,
          'person-1.json': PERSON_INSTANCE,
          'article.gts': ARTICLE_CARD_SOURCE,
          'article-1.json': ARTICLE_INSTANCE,
        },
        permissions: {
          writer: ['read', 'write'],
          reader: ['read'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup,
      });

      let { getMessagesSince } = setupMatrixRoom(hooks, () => ({
        testRealm,
        testRealmHttpServer,
        request,
        dir,
        dbAdapter,
      }));

      async function latestFromScratchJobCount() {
        let rows = (await dbAdapter.execute(
          `SELECT id FROM jobs WHERE job_type = 'from-scratch-index'`,
        )) as { id: number }[];
        return rows.length;
      }

      async function latestFromScratchJob() {
        let [row] = (await dbAdapter.execute(
          `SELECT id, status, result
         FROM jobs
         WHERE job_type = 'from-scratch-index'
         ORDER BY id DESC
         LIMIT 1`,
        )) as {
          id: number;
          status: string;
          result: { invalidations: string[] };
        }[];
        return row;
      }

      function bumpFileMtime(path: string) {
        let contents = readFileSync(path, 'utf8');
        writeFileSync(path, `${contents}\n// reindex test`);
        let now = Date.now() / 1000;
        utimesSync(path, now + 5, now + 5);
      }

      function hasMatchingInvalidations(
        actual: string[],
        expected: string[],
      ): boolean {
        return (
          JSON.stringify([...actual].sort()) ===
          JSON.stringify([...expected].sort())
        );
      }

      async function waitForIncrementalRealmEvent(
        since: number,
        expectedInvalidations: string[],
      ): Promise<MatrixEvent & { content: { invalidations: string[] } }> {
        return (await waitUntil(
          async () => {
            let messages = await getMessagesSince(since);
            return messages.find(
              (
                event,
              ): event is MatrixEvent & {
                content: { invalidations: string[] };
              } =>
                event.type === 'app.boxel.realm-event' &&
                event.content.eventName === 'index' &&
                event.content.indexType === 'incremental' &&
                hasMatchingInvalidations(
                  event.content.invalidations,
                  expectedInvalidations,
                ),
            );
          },
          { timeout: 20000 },
        )) as MatrixEvent & {
          content: { invalidations: string[] };
        };
      }

      async function waitForFullRealmEvent(
        since: number,
      ): Promise<MatrixEvent & { content: { indexType: string } }> {
        return (await waitUntil(
          async () => {
            let messages = await getMessagesSince(since);
            return messages.find(
              (
                event,
              ): event is MatrixEvent & {
                content: { indexType: string };
              } =>
                event.type === 'app.boxel.realm-event' &&
                event.content.eventName === 'index' &&
                event.content.indexType === 'full',
            );
          },
          { timeout: 20000 },
        )) as MatrixEvent & {
          content: { indexType: string };
        };
      }

      async function establishBaselineIndex() {
        await testRealm.reindex();
      }

      test('returns 401 without JWT for private realm', async function (assert) {
        let response = await request
          .post('/_reindex')
          .set('Accept', 'application/json');

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('returns 403 for user without write access', async function (assert) {
        let response = await request
          .post('/_reindex')
          .set('Accept', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'reader', ['read'])}`,
          );

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('returns 401 without JWT for private realm on full reindex', async function (assert) {
        let response = await request
          .post('/_full-reindex')
          .set('Accept', 'application/json');

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('returns 403 for user without write access on full reindex', async function (assert) {
        let response = await request
          .post('/_full-reindex')
          .set('Accept', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'reader', ['read'])}`,
          );

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('reindex publishes a normal from-scratch job and broadcasts changed invalidations', async function (assert) {
        await establishBaselineIndex();
        bumpFileMtime(join(testRealmPath, 'person.gts'));

        let initialJobCount = await latestFromScratchJobCount();
        let realmEventTimestampStart = Date.now();

        let response = await request
          .post('/_reindex')
          .set('Accept', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 204, 'HTTP 204 response');

        await waitUntil(async () => {
          let currentCount = await latestFromScratchJobCount();
          return currentCount === initialJobCount + 1 ? true : undefined;
        });

        let job = await waitUntil(
          async () => {
            let row = await latestFromScratchJob();
            return row?.status === 'resolved' ? row : undefined;
          },
          { timeout: 20000 },
        );
        assert.ok(job, 'latest from-scratch job resolved');
        if (!job) {
          throw new Error('expected latest from-scratch job to resolve');
        }
        let event = await waitForIncrementalRealmEvent(
          realmEventTimestampStart,
          job.result.invalidations,
        );
        let fullEvent = await waitForFullRealmEvent(realmEventTimestampStart);

        assert.deepEqual(
          event.content.invalidations,
          job.result.invalidations,
          'normal reindex broadcasts the worker invalidation payload',
        );
        assert.deepEqual(
          [...event.content.invalidations].sort(),
          [
            `${testRealmHref}person-1.json`,
            `${testRealmHref}person.gts`,
          ].sort(),
          'normal reindex invalidates the changed module and its dependent instance, but not unrelated files',
        );
        assert.strictEqual(
          fullEvent.content.indexType,
          'full',
          'normal reindex also broadcasts the full index event',
        );
      });

      test('Realm.reindex broadcasts incremental invalidations and full index events', async function (assert) {
        await establishBaselineIndex();
        bumpFileMtime(join(testRealmPath, 'person.gts'));

        let realmEventTimestampStart = Date.now();
        await testRealm.reindex();

        let expectedInvalidations = [
          `${testRealmHref}person-1.json`,
          `${testRealmHref}person.gts`,
        ];
        let incrementalEvent = await waitForIncrementalRealmEvent(
          realmEventTimestampStart,
          expectedInvalidations,
        );
        let fullEvent = await waitForFullRealmEvent(realmEventTimestampStart);

        assert.deepEqual(
          [...incrementalEvent.content.invalidations].sort(),
          expectedInvalidations.sort(),
          'Realm.reindex broadcasts incremental invalidations from the reindex job result',
        );
        assert.strictEqual(
          fullEvent.content.indexType,
          'full',
          'Realm.reindex still broadcasts the full index event',
        );
      });

      test('full reindex forces all files to invalidate and broadcasts the full invalidation set', async function (assert) {
        await establishBaselineIndex();

        let initialJobCount = await latestFromScratchJobCount();
        let realmEventTimestampStart = Date.now();

        let response = await request
          .post('/_full-reindex')
          .set('Accept', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 204, 'HTTP 204 response');

        await waitUntil(async () => {
          let currentCount = await latestFromScratchJobCount();
          return currentCount === initialJobCount + 1 ? true : undefined;
        });

        let job = await waitUntil(
          async () => {
            let row = await latestFromScratchJob();
            return row?.status === 'resolved' ? row : undefined;
          },
          { timeout: 20000 },
        );
        assert.ok(job, 'latest full from-scratch job resolved');
        if (!job) {
          throw new Error('expected latest full from-scratch job to resolve');
        }
        let event = await waitForIncrementalRealmEvent(
          realmEventTimestampStart,
          job.result.invalidations,
        );
        let fullEvent = await waitForFullRealmEvent(realmEventTimestampStart);

        assert.deepEqual(
          event.content.invalidations,
          job.result.invalidations,
          'full reindex broadcasts the worker invalidation payload',
        );
        assert.deepEqual(
          [...event.content.invalidations].sort(),
          [
            `${testRealmHref}article-1.json`,
            `${testRealmHref}article.gts`,
            `${testRealmHref}person-1.json`,
            `${testRealmHref}person.gts`,
          ].sort(),
          'full reindex broadcasts all files in the realm',
        );
        assert.strictEqual(
          fullEvent.content.indexType,
          'full',
          'full reindex also broadcasts the full index event',
        );
      });
    },
  );
});
