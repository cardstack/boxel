import QUnit from 'qunit';
import { basename } from 'path';
import Koa from 'koa';
import supertest from 'supertest';
import {
  setupDB,
  setupSecretsKeyring,
  insertProxyEndpoints,
  insertUser,
  realmSecretSeed,
} from './helpers/index.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import { jwtMiddleware } from '../middleware/index.ts';
import handleRequestForward from '../handlers/handle-request-forward.ts';
import { createJWT } from '../utils/jwt.ts';
import type { PgAdapter } from '@cardstack/postgres';
const { module, test } = QUnit;

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let vendor: StubVendor;
  setupSecretsKeyring(hooks);
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      vendor = await startStubVendor();
      configureOutbound({ devAllowlist: ['127.0.0.1'] });
      await insertUser(
        db,
        '@geography:localhost',
        'test-customer',
        'geography@example.test',
      );
      await insertProxyEndpoints(db, [
        {
          url: vendor.url + '/',
          apiKey: 'tile-test-key-private',
          creditStrategy: 'no-credit',
          supportsStreaming: false,
          authMethod: 'raw-header',
          authParameterName: 'X-Goog-Api-Key',
        },
      ]);
      AllowedProxyDestinations.reset();
    },
    afterEach: async () => {
      await vendor?.close();
      resetOutbound();
      AllowedProxyDestinations.reset();
    },
  });
  function app() {
    const koa = new Koa();
    koa.use(jwtMiddleware(realmSecretSeed, db));
    koa.use(handleRequestForward({ dbAdapter: db }));
    return supertest(koa.callback());
  }
  function token() {
    return createJWT(
      { user: '@geography:localhost', sessionRoom: '' },
      realmSecretSeed,
    );
  }
  test('binary tile bytes and type survive while credentials stay at the upstream boundary', async function (assert) {
    const bytes = [103, 108, 84, 70, 2, 0, 255, 128, 0];
    const response = await app()
      .post('/_request-forward')
      .set('Authorization', `Bearer ${token()}`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
        response.on('error', done);
      })
      .send({
        url: vendor.url + '/respond',
        method: 'POST',
        requestBody: JSON.stringify({
          headers: { 'content-type': 'model/gltf-binary' },
          chunks: [bytes.slice(0, 4), bytes.slice(4)],
        }),
      });
    assert.strictEqual(response.status, 200);
    assert.deepEqual([...response.body], bytes);
    assert.strictEqual(response.headers['content-type'], 'model/gltf-binary');
    assert.strictEqual(response.headers['cache-control'], 'no-store');
    assert.strictEqual(
      vendor.requests[0].headers['x-goog-api-key'],
      'tile-test-key-private',
    );
    assert.notOk(vendor.requests[0].headers.authorization);
    assert.notOk(vendor.requests[0].path.includes('tile-test-key-private'));
    assert.notOk(
      JSON.stringify(response.headers).includes('tile-test-key-private'),
    );
  });
  test('JSON tileset requests use the same encrypted raw-header credential', async function (assert) {
    const tileset = { asset: { version: '1.0' }, root: { children: [] } };
    const response = await app()
      .post('/_request-forward')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        url: vendor.url + '/respond',
        method: 'POST',
        requestBody: JSON.stringify({
          headers: { 'content-type': 'application/json' },
          chunks: [JSON.stringify(tileset)],
        }),
      });
    assert.strictEqual(response.status, 200);
    assert.deepEqual(response.body, tileset);
    assert.strictEqual(
      vendor.requests[0].headers['x-goog-api-key'],
      'tile-test-key-private',
    );
  });
  test('an unauthenticated caller cannot consume the configured key', async function (assert) {
    const response = await app()
      .post('/_request-forward')
      .send({ url: vendor.url + '/echo', method: 'GET' });
    assert.strictEqual(response.status, 401);
    assert.strictEqual(vendor.requests.length, 0);
  });
});
