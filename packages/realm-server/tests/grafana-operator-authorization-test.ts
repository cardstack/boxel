import QUnit from 'qunit';
const { module, test } = QUnit;
import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import { basename } from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { generateKeyPairSync, type KeyObject } from 'crypto';
import jwt from 'jsonwebtoken';
import { grafanaAuthorization } from '../middleware/index.ts';
import {
  GRAFANA_ID_HEADER,
  GRAFANA_PROXY_HEADER,
  GrafanaIdentityVerifier,
} from '../lib/grafana-identity.ts';

const grafanaSecret = 'test-grafana-secret';

interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicJWK: Record<string, unknown>;
}

function makeSigningKey(kid: string): SigningKey {
  let { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return {
    kid,
    privateKey,
    publicJWK: {
      ...publicKey.export({ format: 'jwk' }),
      kid,
      alg: 'ES256',
      use: 'sig',
    },
  };
}

// The claims Grafana puts in the ID token it forwards to a datasource.
function idToken(
  key: SigningKey,
  claims: Record<string, unknown>,
  { expiresIn = 600 }: { expiresIn?: number } = {},
) {
  return jwt.sign(
    {
      aud: 'org:1',
      namespace: 'default',
      ...claims,
    },
    key.privateKey,
    { algorithm: 'ES256', keyid: key.kid, expiresIn },
  );
}

const editor = {
  sub: 'user:7',
  type: 'user',
  role: 'Editor',
  username: 'an-operator',
};

module(basename(import.meta.filename), function (hooks) {
  let jwksServer: Server;
  let grafanaURL: string;
  let published: SigningKey[];
  let jwksRequests: number;

  hooks.beforeEach(async function () {
    published = [];
    jwksRequests = 0;
    // Stands in for Grafana's public signing-key endpoint.
    jwksServer = createServer((req, res) => {
      if (req.url === '/api/signing-keys/keys') {
        jwksRequests++;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ keys: published.map((k) => k.publicJWK) }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) =>
      jwksServer.listen(0, '127.0.0.1', resolve),
    );
    grafanaURL = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}`;
  });

  hooks.afterEach(async function () {
    await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  });

  function buildApp(verifier: GrafanaIdentityVerifier | undefined) {
    let app = new Koa();
    let router = new Router();
    router.post(
      '/_grafana-reindex',
      grafanaAuthorization(grafanaSecret, verifier),
      async (ctxt) => {
        ctxt.status = 204;
      },
    );
    app.use(router.routes());
    return app;
  }

  // A request as the realm-server-operator datasource proxy forwards it.
  function proxied(
    verifier: GrafanaIdentityVerifier | undefined,
    token?: string,
  ) {
    let request = supertest(buildApp(verifier).callback())
      .post('/_grafana-reindex')
      .set('Authorization', `Bearer ${grafanaSecret}`)
      .set(GRAFANA_PROXY_HEADER, 'true');
    return token ? request.set(GRAFANA_ID_HEADER, token) : request;
  }

  test('a request sent straight to the realm server needs only the secret', async function (assert) {
    let response = await supertest(buildApp(undefined).callback())
      .post('/_grafana-reindex')
      .set('Authorization', `Bearer ${grafanaSecret}`);
    assert.strictEqual(response.status, 204);
  });

  test('a proxied request from an Editor is allowed', async function (assert) {
    let key = makeSigningKey('id-2026-11-es256');
    published.push(key);
    let response = await proxied(
      new GrafanaIdentityVerifier(grafanaURL),
      idToken(key, editor),
    );
    assert.strictEqual(response.status, 204);
  });

  test('a proxied request from an Admin is allowed', async function (assert) {
    let key = makeSigningKey('k1');
    published.push(key);
    let response = await proxied(
      new GrafanaIdentityVerifier(grafanaURL),
      idToken(key, { ...editor, role: 'Admin' }),
    );
    assert.strictEqual(response.status, 204);
  });

  test('a proxied request still needs the secret', async function (assert) {
    let key = makeSigningKey('k1');
    published.push(key);
    let response = await supertest(
      buildApp(new GrafanaIdentityVerifier(grafanaURL)).callback(),
    )
      .post('/_grafana-reindex')
      .set('Authorization', 'Bearer not-the-secret')
      .set(GRAFANA_PROXY_HEADER, 'true')
      .set(GRAFANA_ID_HEADER, idToken(key, editor));
    assert.strictEqual(response.status, 401);
  });

  test('a proxied request without an ID token is refused', async function (assert) {
    let response = await proxied(new GrafanaIdentityVerifier(grafanaURL));
    assert.strictEqual(response.status, 403);
    assert.true(
      response.text.includes('need a Grafana ID token'),
      `says why: ${response.text}`,
    );
  });

  test('a proxied request is refused when GRAFANA_URL is not configured', async function (assert) {
    let key = makeSigningKey('k1');
    let response = await proxied(undefined, idToken(key, editor));
    assert.strictEqual(response.status, 403);
    assert.true(
      response.text.includes('GRAFANA_URL is not configured'),
      `says why: ${response.text}`,
    );
  });

  test('a proxied request from a service account is refused', async function (assert) {
    let key = makeSigningKey('k1');
    published.push(key);
    let response = await proxied(
      new GrafanaIdentityVerifier(grafanaURL),
      idToken(key, {
        sub: 'service-account:3',
        type: 'service-account',
        role: 'Viewer',
      }),
    );
    assert.strictEqual(response.status, 403);
    assert.true(
      response.text.includes('not a service-account'),
      `says why: ${response.text}`,
    );
  });

  test('a proxied request from an Admin service account is refused', async function (assert) {
    let key = makeSigningKey('k1');
    published.push(key);
    let response = await proxied(
      new GrafanaIdentityVerifier(grafanaURL),
      idToken(key, {
        sub: 'service-account:1',
        type: 'service-account',
        role: 'Admin',
      }),
    );
    assert.strictEqual(response.status, 403);
  });

  test('a proxied request from a Viewer is refused', async function (assert) {
    let key = makeSigningKey('k1');
    published.push(key);
    let response = await proxied(
      new GrafanaIdentityVerifier(grafanaURL),
      idToken(key, { ...editor, role: 'Viewer' }),
    );
    assert.strictEqual(response.status, 403);
    assert.true(
      response.text.includes('Editor or Admin role, not Viewer'),
      `says why: ${response.text}`,
    );
  });

  test('a token signed by a key Grafana does not publish is refused', async function (assert) {
    published.push(makeSigningKey('k1'));
    let forger = makeSigningKey('k1');
    let response = await proxied(
      new GrafanaIdentityVerifier(grafanaURL),
      idToken(forger, editor),
    );
    assert.strictEqual(response.status, 403);
    assert.true(
      response.text.includes('Grafana ID token is invalid'),
      `says why: ${response.text}`,
    );
  });

  test('a token naming an unknown key id is refused', async function (assert) {
    published.push(makeSigningKey('k1'));
    let response = await proxied(
      new GrafanaIdentityVerifier(grafanaURL),
      idToken(makeSigningKey('k2'), editor),
    );
    assert.strictEqual(response.status, 403);
    assert.true(
      response.text.includes('unknown key (k2)'),
      `says why: ${response.text}`,
    );
  });

  test('an expired token is refused', async function (assert) {
    let key = makeSigningKey('k1');
    published.push(key);
    let response = await proxied(
      new GrafanaIdentityVerifier(grafanaURL),
      idToken(key, editor, { expiresIn: -120 }),
    );
    assert.strictEqual(response.status, 403);
    assert.true(
      response.text.includes('jwt expired'),
      `says why: ${response.text}`,
    );
  });

  test('a token with a different algorithm is refused', async function (assert) {
    let key = makeSigningKey('k1');
    published.push(key);
    let hs256 = jwt.sign({ ...editor }, 'a shared secret', {
      algorithm: 'HS256',
      keyid: 'k1',
    });
    let response = await proxied(
      new GrafanaIdentityVerifier(grafanaURL),
      hs256,
    );
    assert.strictEqual(response.status, 403);
  });

  test('a key Grafana rotates in is fetched when a token names it', async function (assert) {
    let first = makeSigningKey('k1');
    published.push(first);
    let verifier = new GrafanaIdentityVerifier(grafanaURL, {
      refetchIntervalMs: 0,
    });
    assert.strictEqual(
      (await proxied(verifier, idToken(first, editor))).status,
      204,
    );

    let second = makeSigningKey('k2');
    published.push(second);
    assert.strictEqual(
      (await proxied(verifier, idToken(second, editor))).status,
      204,
      'the new key is fetched',
    );
    assert.strictEqual(jwksRequests, 2, 'one fetch per new key');

    assert.strictEqual(
      (await proxied(verifier, idToken(first, editor))).status,
      204,
    );
    assert.strictEqual(jwksRequests, 2, 'a known key is not fetched again');
  });

  test('unknown key ids do not refetch the keys more than once per interval', async function (assert) {
    published.push(makeSigningKey('k1'));
    let verifier = new GrafanaIdentityVerifier(grafanaURL);
    for (let kid of ['x1', 'x2', 'x3']) {
      let response = await proxied(
        verifier,
        idToken(makeSigningKey(kid), editor),
      );
      assert.strictEqual(response.status, 403);
    }
    assert.strictEqual(jwksRequests, 1);
  });
});
