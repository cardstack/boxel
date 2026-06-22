import QUnit from 'qunit';
const { module, test } = QUnit;
import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import { basename } from 'path';
import { Deferred } from '@cardstack/runtime-common';
import type {
  DBAdapter,
  QueuePublisher,
  QueuePublishArgs,
  Job,
  PgPrimitive,
  ScreenshotPrerenderResponse,
} from '@cardstack/runtime-common';

import handleScreenshotCard from '../handlers/handle-screenshot-card.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { jwtMiddleware } from '../middleware/index.ts';
import { createJWT } from '../utils/jwt.ts';
import { realmSecretSeed } from './helpers/index.ts';

module(basename(import.meta.filename), function () {
  module('/_screenshot-card endpoint', function () {
    function makeDbAdapter(): DBAdapter {
      return {
        kind: 'pg',
        async notify() {},
        isClosed: false,
        async execute() {
          return [];
        },
        async close() {},
        async getColumnNames() {
          return [];
        },
        async withWriteLock(_url, fn) {
          return await fn(undefined);
        },
        async withUserCostLock(_userId, fn) {
          return await fn();
        },
      };
    }

    function makeQueue(result: PgPrimitive | (() => PgPrimitive)): {
      queue: QueuePublisher;
      published: Array<QueuePublishArgs<unknown>>;
    } {
      let published: Array<QueuePublishArgs<unknown>> = [];
      let nextId = 1;
      let queue: QueuePublisher = {
        async publish<TResult = PgPrimitive>(
          args: QueuePublishArgs<TResult>,
        ): Promise<Job<TResult>> {
          published.push(args as QueuePublishArgs<unknown>);
          let notifier = new Deferred<TResult>();
          let resolved = typeof result === 'function' ? result() : result;
          notifier.fulfill(resolved as unknown as TResult);
          // Job is a class with private constructor symbols only used as a
          // shape — rely on its public surface (id + done getter).
          return {
            id: nextId++,
            get done() {
              return notifier.promise;
            },
          } as Job<TResult>;
        },
        async destroy() {},
      };
      return { queue, published };
    }

    function buildArgs(
      dbAdapter: DBAdapter,
      queue: QueuePublisher,
    ): CreateRoutesArgs {
      // The screenshot-card handler only reads dbAdapter + queue from
      // CreateRoutesArgs, so we cast a minimal shape rather than spinning up
      // the full realm server.
      return {
        dbAdapter,
        queue,
      } as unknown as CreateRoutesArgs;
    }

    function buildApp(args: CreateRoutesArgs) {
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_screenshot-card',
        jwtMiddleware(realmSecretSeed),
        handleScreenshotCard(args),
      );
      app.use(router.routes());
      return app;
    }

    test('enqueues a screenshot-card job and forwards the result', async function (assert) {
      let dbAdapter = makeDbAdapter();
      let stubResult: ScreenshotPrerenderResponse = {
        status: 'ready',
        base64: 'iVBORw0KGgo=',
        width: 800,
        height: 600,
        contentType: 'image/png',
      };
      let { queue, published } = makeQueue(
        stubResult as unknown as PgPrimitive,
      );
      let app = buildApp(buildArgs(dbAdapter, queue));

      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );
      let realmURL = 'http://example.test/';
      let cardId = `${realmURL}Person/fadhlan`;

      let response = await supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            type: 'screenshot-card',
            attributes: { realmURL, cardId, format: 'isolated' },
          },
        })
        .expect(201);

      assert.deepEqual(
        response.body,
        {
          data: {
            type: 'screenshot-card-result',
            attributes: stubResult,
          },
        },
        'returns the screenshot-card-result envelope from the job',
      );
      assert.strictEqual(published.length, 1, 'published exactly one job');
      assert.strictEqual(published[0]?.jobType, 'screenshot-card');
      assert.strictEqual(
        published[0]?.concurrencyGroup,
        `screenshot:${realmURL}`,
      );
      assert.deepEqual(published[0]?.args, {
        realmURL,
        realmUsername: '@someone:localhost',
        runAs: '@someone:localhost',
        cardId,
        format: 'isolated',
      });
    });

    test('rejects without auth', async function (assert) {
      let { queue, published } = makeQueue({ status: 'ready' });
      let app = buildApp(buildArgs(makeDbAdapter(), queue));

      let response = await supertest(app.callback())
        .post('/_screenshot-card')
        .send({
          data: {
            attributes: {
              realmURL: 'http://example.test/',
              cardId: 'http://example.test/Person/fadhlan',
              format: 'isolated',
            },
          },
        });

      assert.strictEqual(response.status, 401, '401 without auth');
      assert.deepEqual(published, [], 'does not enqueue any job');
    });

    test('rejects missing realmURL', async function (assert) {
      let { queue, published } = makeQueue({ status: 'ready' });
      let app = buildApp(buildArgs(makeDbAdapter(), queue));
      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

      let response = await supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            attributes: {
              cardId: 'http://example.test/Person/fadhlan',
              format: 'isolated',
            },
          },
        });

      assert.strictEqual(response.status, 400);
      assert.deepEqual(published, [], 'does not enqueue any job');
    });

    test('rejects missing cardId', async function (assert) {
      let { queue, published } = makeQueue({ status: 'ready' });
      let app = buildApp(buildArgs(makeDbAdapter(), queue));
      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

      let response = await supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            attributes: {
              realmURL: 'http://example.test/',
              format: 'isolated',
            },
          },
        });

      assert.strictEqual(response.status, 400);
      assert.deepEqual(published, [], 'does not enqueue any job');
    });

    test('rejects invalid format', async function (assert) {
      let { queue, published } = makeQueue({ status: 'ready' });
      let app = buildApp(buildArgs(makeDbAdapter(), queue));
      let token = createJWT(
        { user: '@someone:localhost', sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );

      let response = await supertest(app.callback())
        .post('/_screenshot-card')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            attributes: {
              realmURL: 'http://example.test/',
              cardId: 'http://example.test/Person/fadhlan',
              format: 'fitted',
            },
          },
        });

      assert.strictEqual(response.status, 400);
      assert.ok(
        response.text.includes('format'),
        'mentions format in the error message',
      );
      assert.deepEqual(published, [], 'does not enqueue any job');
    });
  });
});
