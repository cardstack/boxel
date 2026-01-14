import { module, test } from 'qunit';
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  insertJob,
  monitoringAuthToken,
  setupPermissionedRealm,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(__filename)}`, function () {
  module(
    'Realm Server Endpoints (not specific to one realm)',
    function (hooks) {
      module('_queue-status', function (hooks) {
        let request: SuperTest<Test>;
        let dbAdapter: PgAdapter;

        function onRealmSetup(args: {
          request: SuperTest<Test>;
          dbAdapter: PgAdapter;
        }) {
          request = args.request;
          dbAdapter = args.dbAdapter;
        }

        setupPermissionedRealm(hooks, {
          permissions: {
            '*': ['read', 'write'],
          },
          onRealmSetup,
        });

        test('returns 200 with JSON-API doc', async function (assert) {
          await insertJob(dbAdapter, {
            job_type: 'test-job',
          });
          await insertJob(dbAdapter, {
            job_type: 'test-job',
            status: 'resolved',
            finished_at: new Date().toISOString(),
          });
          let response = await request.get('/_queue-status');
          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          response = await request
            .get('/_queue-status')
            .set('Authorization', `Bearer no-good`);
          assert.strictEqual(response.status, 401, 'HTTP 401 status');
          const REALM_SERVER_SECRET_SEED = "mum's the word";
          response = await request
            .get('/_queue-status')
            .set(
              'Authorization',
              `Bearer ${monitoringAuthToken(REALM_SERVER_SECRET_SEED)}`,
            );
          assert.strictEqual(response.status, 200, 'HTTP 200 status');
          let json = response.body;
          assert.deepEqual(json, {
            data: {
              type: 'queue-status',
              id: 'queue-status',
              attributes: {
                pending: 1,
              },
            },
          });
        });
      });
    },
  );
});
