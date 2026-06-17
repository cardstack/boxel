import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { realmSecretSeed, insertUser } from '../helpers/index.ts';
import { setupServerEndpointsTest, testRealmURL } from './helpers.ts';

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('/_screenshot-card endpoint', function (hooks) {
    // Auth / body-validation only — the cardId never has to resolve, so use `blank`.
    let context = setupServerEndpointsTest(hooks, { fixture: 'blank' });

    test('requires auth', async function (assert) {
      let response = await context.request
        .post('/_screenshot-card')
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            type: 'screenshot-card',
            attributes: {
              realmURL: testRealmURL.href,
              cardId: `${testRealmURL.href}Person/fadhlan`,
              format: 'isolated',
            },
          },
        });
      assert.strictEqual(response.status, 401, 'HTTP 401 without auth');
    });

    test('rejects missing realmURL', async function (assert) {
      let matrixUserId = '@screenshot-test1:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_screenshot1',
        'screenshot1@example.com',
      );

      let response = await context.request
        .post('/_screenshot-card')
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
            type: 'screenshot-card',
            attributes: {
              cardId: `${testRealmURL.href}Person/fadhlan`,
              format: 'isolated',
            },
          },
        });
      assert.strictEqual(response.status, 400, 'HTTP 400 for missing realmURL');
    });

    test('rejects missing cardId', async function (assert) {
      let matrixUserId = '@screenshot-test2:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_screenshot2',
        'screenshot2@example.com',
      );

      let response = await context.request
        .post('/_screenshot-card')
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
            type: 'screenshot-card',
            attributes: {
              realmURL: testRealmURL.href,
              format: 'isolated',
            },
          },
        });
      assert.strictEqual(response.status, 400, 'HTTP 400 for missing cardId');
    });

    test('rejects invalid format', async function (assert) {
      let matrixUserId = '@screenshot-test3:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_screenshot3',
        'screenshot3@example.com',
      );

      let response = await context.request
        .post('/_screenshot-card')
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
            type: 'screenshot-card',
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
      let matrixUserId = '@screenshot-test4:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_screenshot4',
        'screenshot4@example.com',
      );

      let response = await context.request
        .post('/_screenshot-card')
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

    // The full e2e "can successfully take a screenshot" path requires a
    // running prerender server with Puppeteer plus a real card to render.
    // It is exercised manually via curl (see PR description) rather than
    // here, where setupServerEndpointsTest doesn't currently boot the
    // Puppeteer-based prerenderer for fast test runs. The validation
    // tests above cover the realm-server-side handler contract; the
    // worker task path is covered by the lean handler test in
    // `screenshot-card-test.ts`.
  });
});
