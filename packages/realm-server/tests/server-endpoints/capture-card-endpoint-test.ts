import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { realmSecretSeed, insertUser } from '../helpers/index.ts';
import { setupServerEndpointsTest, testRealmURL } from './helpers.ts';

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('/_capture-card endpoint', function (hooks) {
    // Auth / body-validation only — the cardId never has to resolve, so use `blank`.
    let context = setupServerEndpointsTest(hooks, { fixture: 'blank' });

    test('requires auth', async function (assert) {
      let response = await context.request
        .post('/_capture-card')
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            type: 'capture-card',
            attributes: {
              realmURL: testRealmURL.href,
              cardId: `${testRealmURL.href}Person/fadhlan`,
              format: 'isolated',
            },
          },
        });
      assert.strictEqual(response.status, 401, 'HTTP 401 without auth');
    });

    test('still answers to /_screenshot-card', async function (assert) {
      // A released boxel-cli is installed and pinned independently of this
      // server and still posts to the endpoint's former name. 401 rather than
      // 404 is the assertion that matters: it says the path is routed to the
      // same handler, which is what an unrenamed client depends on.
      let response = await context.request
        .post('/_screenshot-card')
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            type: 'capture-card',
            attributes: {
              realmURL: testRealmURL.href,
              cardId: `${testRealmURL.href}Person/fadhlan`,
              format: 'isolated',
            },
          },
        });
      assert.strictEqual(
        response.status,
        401,
        'routed to the capture handler, not unrouted',
      );
    });

    test('rejects missing realmURL', async function (assert) {
      let matrixUserId = '@capture-test1:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_capture1',
        'capture1@example.com',
      );

      let response = await context.request
        .post('/_capture-card')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'capture-card',
            attributes: {
              cardId: `${testRealmURL.href}Person/fadhlan`,
              format: 'isolated',
            },
          },
        });
      assert.strictEqual(response.status, 400, 'HTTP 400 for missing realmURL');
    });

    test('rejects missing cardId', async function (assert) {
      let matrixUserId = '@capture-test2:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_capture2',
        'capture2@example.com',
      );

      let response = await context.request
        .post('/_capture-card')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'capture-card',
            attributes: {
              realmURL: testRealmURL.href,
              format: 'isolated',
            },
          },
        });
      assert.strictEqual(response.status, 400, 'HTTP 400 for missing cardId');
    });

    test('rejects invalid format', async function (assert) {
      let matrixUserId = '@capture-test3:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_capture3',
        'capture3@example.com',
      );

      let response = await context.request
        .post('/_capture-card')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send({
          data: {
            type: 'capture-card',
            attributes: {
              realmURL: testRealmURL.href,
              cardId: `${testRealmURL.href}Person/fadhlan`,
              format: 'fitted',
            },
          },
        });
      assert.strictEqual(response.status, 400, 'HTTP 400 for invalid format');
    });

    test('rejects invalid JSON body', async function (assert) {
      let matrixUserId = '@capture-test4:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_capture4',
        'capture4@example.com',
      );

      let response = await context.request
        .post('/_capture-card')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send('not json');
      assert.strictEqual(response.status, 400, 'HTTP 400 for invalid body');
    });

    // The full e2e "can successfully take a capture" path requires a
    // running prerender server with Puppeteer plus a real card to render.
    // It is exercised manually via curl (see PR description) rather than
    // here, where setupServerEndpointsTest doesn't currently boot the
    // Puppeteer-based prerenderer for fast test runs. The validation
    // tests above cover the realm-server-side handler contract; the
    // worker task path is covered by the lean handler test in
    // `capture-card-test.ts`.
  });
});
