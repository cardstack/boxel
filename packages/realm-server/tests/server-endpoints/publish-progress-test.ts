import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  insertPermissions,
  param,
  query,
  type Expression,
} from '@cardstack/runtime-common';
import { indexingConcurrencyGroup } from '@cardstack/runtime-common/jobs/indexing';
import { prerenderHtmlConcurrencyGroup } from '@cardstack/runtime-common/jobs/prerender-html';
import {
  insertJob,
  realmSecretSeed,
  setupPermissionedRealmCached,
} from '../helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';

// `_publish-progress` is what turns a publish's multi-minute wait into
// something a client can render. These cover the two things it has to get
// right: only the realm's owner may read it, and the phase it reports tracks
// the same two waits readiness gates on, in the same order.
module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('Realm Server Endpoints (not specific to one realm)', function () {
    module('_publish-progress', function (hooks) {
      let request: SuperTest<Test>;
      let dbAdapter: PgAdapter;
      let ownerUserId = '@mango:localhost';
      let strangerUserId = '@queenzy:localhost';

      setupPermissionedRealmCached(hooks, {
        fixture: 'blank',
        permissions: {
          '*': ['read'],
        },
        onRealmSetup(args: { request: SuperTest<Test>; dbAdapter: PgAdapter }) {
          request = args.request;
          dbAdapter = args.dbAdapter;
        },
      });

      // Each test owns a distinct realm URL so the jobs, generations and
      // rendered rows it seeds can't be read by another test in this module.
      let realmCounter = 0;
      async function ownedRealm(): Promise<string> {
        let realmURL = `http://progress.localhost:4445/published-${++realmCounter}/`;
        await insertPermissions(dbAdapter, new URL(realmURL), {
          [ownerUserId]: ['read', 'realm-owner'],
          '*': ['read'],
        });
        return realmURL;
      }

      function authHeader(user: string): string {
        return `Bearer ${createRealmServerJWT(
          { user, sessionRoom: 'session-room-test' },
          realmSecretSeed,
        )}`;
      }

      async function getProgress(
        realmURL: string,
        opts: { as?: string } = {},
      ): Promise<Test> {
        let req = request
          .get(
            `/_publish-progress?published_realm_url=${encodeURIComponent(
              realmURL,
            )}`,
          )
          .set('Accept', 'application/vnd.api+json');
        if (opts.as !== undefined) {
          req = req.set('Authorization', authHeader(opts.as));
        }
        return req;
      }

      async function seedGeneration(realmURL: string, generation: number) {
        await query(dbAdapter, [
          `INSERT INTO realm_generations (realm_url, current_generation) VALUES (`,
          param(realmURL),
          `,`,
          param(generation),
          `)`,
        ] as Expression);
      }

      async function seedRenderedHtml(realmURL: string, generation: number) {
        await query(dbAdapter, [
          `INSERT INTO prerendered_html (url, file_alias, realm_url, type, generation) VALUES (`,
          param(`${realmURL}card`),
          `,`,
          param(`${realmURL}card`),
          `,`,
          param(realmURL),
          `,`,
          param('instance'),
          `,`,
          param(generation),
          `)`,
        ] as Expression);
      }

      async function seedProgress(
        jobId: number,
        filesCompleted: number,
        totalFiles: number,
      ) {
        await dbAdapter.execute(
          `INSERT INTO job_progress (job_id, total_files, files_completed)
             VALUES ($1, $2, $3)`,
          { bind: [jobId, totalFiles, filesCompleted] },
        );
      }

      test('rejects an unauthenticated request', async function (assert) {
        let realmURL = await ownedRealm();
        let response = await getProgress(realmURL);
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      // Progress exposes a realm's file counts, so it is owner-only even though
      // the published realm it describes is world-readable.
      test('rejects a caller who does not own the realm', async function (assert) {
        let realmURL = await ownedRealm();
        let response = await getProgress(realmURL, { as: strangerUserId });
        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('rejects a request with no published_realm_url', async function (assert) {
        let response = await request
          .get('/_publish-progress')
          .set('Accept', 'application/vnd.api+json')
          .set('Authorization', authHeader(ownerUserId));
        assert.strictEqual(response.status, 400, 'HTTP 400 status');
      });

      test('reports the index phase with the running job’s counts', async function (assert) {
        let realmURL = await ownedRealm();
        let job = await insertJob(dbAdapter, {
          job_type: 'from-scratch-index',
          concurrency_group: indexingConcurrencyGroup(realmURL),
          args: { realmURL },
        });
        await seedProgress(Number(job.id), 42, 270);

        let response = await getProgress(realmURL, { as: ownerUserId });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(response.body, {
          data: {
            type: 'publish-progress',
            id: realmURL,
            attributes: {
              phase: 'index',
              filesCompleted: 42,
              totalFiles: 270,
            },
          },
        });
      });

      // A queued job has no `job_progress` row until the worker holding it
      // reports its first event. That is "starting", not "no work" — the phase
      // must still name the index pass.
      test('reports the index phase with zero counts before the job has reported', async function (assert) {
        let realmURL = await ownedRealm();
        await insertJob(dbAdapter, {
          job_type: 'from-scratch-index',
          concurrency_group: indexingConcurrencyGroup(realmURL),
          args: { realmURL },
        });

        let response = await getProgress(realmURL, { as: ownerUserId });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(response.body.data.attributes, {
          phase: 'index',
          filesCompleted: 0,
          totalFiles: 0,
        });
      });

      // Indexing spawns the render mid-pass, so both lanes hold work at once.
      // Readiness waits on the index lane first, and the phase must agree.
      test('reports the index phase while both lanes hold work', async function (assert) {
        let realmURL = await ownedRealm();
        let indexJob = await insertJob(dbAdapter, {
          job_type: 'from-scratch-index',
          concurrency_group: indexingConcurrencyGroup(realmURL),
          args: { realmURL },
        });
        await seedProgress(Number(indexJob.id), 5, 270);
        let htmlJob = await insertJob(dbAdapter, {
          job_type: 'prerender_html',
          concurrency_group: prerenderHtmlConcurrencyGroup(realmURL),
          args: { realmURL },
        });
        await seedProgress(Number(htmlJob.id), 1, 270);

        let response = await getProgress(realmURL, { as: ownerUserId });

        assert.deepEqual(response.body.data.attributes, {
          phase: 'index',
          filesCompleted: 5,
          totalFiles: 270,
        });
      });

      test('reports the render phase once only the prerender lane holds work', async function (assert) {
        let realmURL = await ownedRealm();
        let htmlJob = await insertJob(dbAdapter, {
          job_type: 'prerender_html',
          concurrency_group: prerenderHtmlConcurrencyGroup(realmURL),
          args: { realmURL },
        });
        await seedProgress(Number(htmlJob.id), 12, 270);

        let response = await getProgress(realmURL, { as: ownerUserId });

        assert.deepEqual(response.body.data.attributes, {
          phase: 'render',
          filesCompleted: 12,
          totalFiles: 270,
        });
      });

      // The index pass enqueues its render fire-and-forget, so there is a
      // window with an empty lane and no rendered HTML for the current
      // generation. Reporting `done` there would tell a publish it had finished
      // before the page it published exists.
      test('reports the render phase when the current generation has no rendered html yet', async function (assert) {
        let realmURL = await ownedRealm();
        await seedGeneration(realmURL, 3);

        let response = await getProgress(realmURL, { as: ownerUserId });

        assert.deepEqual(response.body.data.attributes, {
          phase: 'render',
          filesCompleted: 0,
          totalFiles: 0,
        });
      });

      test('reports done once the lanes are clear and the html has landed', async function (assert) {
        let realmURL = await ownedRealm();
        await seedGeneration(realmURL, 3);
        await seedRenderedHtml(realmURL, 3);

        let response = await getProgress(realmURL, { as: ownerUserId });

        assert.deepEqual(response.body.data.attributes, {
          phase: 'done',
          filesCompleted: 0,
          totalFiles: 0,
        });
      });

      // A finished job's `job_progress` row outlives it. Reading the lane by
      // status rather than by the presence of a progress row is what keeps a
      // settled realm from reporting a stale pass.
      test('ignores the progress rows of jobs that have already finished', async function (assert) {
        let realmURL = await ownedRealm();
        await seedGeneration(realmURL, 3);
        await seedRenderedHtml(realmURL, 3);
        let finishedJob = await insertJob(dbAdapter, {
          job_type: 'from-scratch-index',
          concurrency_group: indexingConcurrencyGroup(realmURL),
          args: { realmURL },
          status: 'resolved',
          finished_at: new Date().toISOString(),
        });
        await seedProgress(Number(finishedJob.id), 270, 270);

        let response = await getProgress(realmURL, { as: ownerUserId });

        assert.strictEqual(
          response.body.data.attributes.phase,
          'done',
          'a resolved job leaves the lane clear',
        );
      });
    });
  });
});
