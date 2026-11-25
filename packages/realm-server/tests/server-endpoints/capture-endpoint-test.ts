import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { rri } from '@cardstack/runtime-common';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { realmSecretSeed, insertUser } from '../helpers/index.ts';
import { colorCoverage } from '../helpers/png.ts';
import {
  insertBoxelApiAccessToken,
  setupServerEndpointsTest,
  testRealmURL,
} from './helpers.ts';

// Reads the grant's user may make in the private realm below.
const captureReaderUserId = '@capture-reader:localhost';

module(`server-endpoints/${basename(import.meta.filename)}`, function () {
  module('/_capture endpoint', function (hooks) {
    // Auth / body-validation only — the cardId never has to resolve, so use `blank`.
    let context = setupServerEndpointsTest(hooks, { fixture: 'blank' });

    test('requires auth', async function (assert) {
      let response = await context.request
        .post('/_capture')
        .set('Content-Type', 'application/vnd.api+json')
        .send({
          data: {
            type: 'capture',
            attributes: {
              realmURL: testRealmURL.href,
              cardId: `${testRealmURL.href}Person/fadhlan`,
              format: 'isolated',
            },
          },
        });
      assert.strictEqual(response.status, 401, 'HTTP 401 without auth');
    });

    // Clients installed and pinned independently of this server (released
    // boxel-cli versions, a host tab still running an older build) post to the
    // endpoint's former names. 401 rather than 404 is the assertion that
    // matters: it says each path is routed to the same handler.
    for (let formerName of ['/_capture-card', '/_screenshot-card']) {
      test(`still answers to ${formerName}`, async function (assert) {
        let response = await context.request
          .post(formerName)
          .set('Content-Type', 'application/vnd.api+json')
          .send({
            data: {
              type: 'capture',
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
    }

    test('rejects missing realmURL', async function (assert) {
      let matrixUserId = '@capture-test1:localhost';
      await insertUser(
        context.dbAdapter,
        matrixUserId,
        'cus_capture1',
        'capture1@example.com',
      );

      let response = await context.request
        .post('/_capture')
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
            type: 'capture',
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
        .post('/_capture')
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
            type: 'capture',
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
        .post('/_capture')
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
            type: 'capture',
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
        .post('/_capture')
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
    // `capture-test.ts`.
  });
  // An OAuth app's capture (ADR 021 §1.5) renders in a real prerender tab
  // that holds tab tokens in memory, never the user's sessions. A private
  // realm's image in the card still draws: the tab gives its auth service
  // worker a tab token for each image request.
  module('/_capture with a Boxel API OAuth token', function (hooks) {
    let context = setupServerEndpointsTest(hooks, {
      fileSystem: {
        'swatch.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#ff0000"/></svg>`,
        'framed.gts': `
          import { CardDef, field, contains, StringField, Component } from '@cardstack/base/card-api';
          export class Framed extends CardDef {
            static displayName = 'Framed';
            @field imageURL = contains(StringField);
            static isolated = class extends Component<typeof this> {
              <template>
                <img class='swatch' src={{@model.imageURL}} alt='swatch' />
                <style scoped>
                  .swatch {
                    display: block;
                    width: 800px;
                    height: 600px;
                  }
                </style>
              </template>
            };
          }
        `,
        'Framed/red.json': {
          data: {
            attributes: { imageURL: `${testRealmURL.href}swatch.svg` },
            meta: {
              adoptsFrom: { module: rri('../framed'), name: 'Framed' },
            },
          },
        },
      },
      // No one else may read the realm, so the image loads only with a
      // credential.
      permissions: {
        '@node-test_realm:localhost': ['read', 'realm-owner'],
        [captureReaderUserId]: ['read'],
      },
      oauthProvider: true,
    });

    test('draws an image from the private realm the card is in', async function (assert) {
      let { token } = await insertBoxelApiAccessToken(
        context.dbAdapter,
        captureReaderUserId,
        'boxel:read',
      );
      let response = await context.request
        .post('/_capture')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${token}`)
        .send({
          data: {
            type: 'capture',
            attributes: {
              realmURL: testRealmURL.href,
              cardId: `${testRealmURL.href}Framed/red`,
              format: 'isolated',
            },
          },
        });
      assert.strictEqual(response.status, 201, response.text);
      let attrs = response.body?.data?.attributes;
      assert.strictEqual(
        attrs?.status,
        'ready',
        `capture completed (error: ${JSON.stringify(attrs?.error ?? 'none')})`,
      );
      let base64: string | undefined =
        attrs?.base64 ?? attrs?.captures?.[0]?.base64;
      assert.ok(base64, 'the answer carries the capture');
      let coverage = colorCoverage(base64!, [255, 0, 0]);
      assert.true(
        coverage > 0.33,
        `the image draws (${Math.round(coverage * 100)}% of the capture)`,
      );
    });
  });
});
