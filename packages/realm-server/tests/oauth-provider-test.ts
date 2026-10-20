import QUnit from 'qunit';
import Koa from 'koa';
import supertest from 'supertest';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import type { PgAdapter } from '@cardstack/postgres';
import { revokeUserSessions } from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { setupDB, realmSecretSeed } from './helpers/index.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { createJWT } from '../utils/jwt.ts';
import { createSecureOrigin } from '../lib/secure-origin.ts';
import {
  createBoxelOAuthProvider,
  type BoxelOAuthConfig,
} from '../lib/oauth/provider.ts';
import {
  oauthAdapter,
  oauthId,
  readOAuthGrant,
  saveOAuthGrant,
} from '../lib/oauth/store.ts';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
} from '../lib/secrets-at-rest/index.ts';

const { module, test } = QUnit;
const issuer = 'https://secure.example.test';
const user = '@oauth:localhost';
const resource = 'https://mcp.example.test/mcp';
const realm = 'https://app.boxel.ai/oauth/library/';
const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...privateKey.export({ format: 'jwk' }),
  kid: 'test',
  use: 'sig',
  alg: 'RS256',
};

module('oauth-provider-test', function (hooks) {
  let db: PgAdapter, auth: string, app: Koa;
  let config: BoxelOAuthConfig;
  let delegatedRequests: {
    url: string;
    method: string;
    authorization: string | null;
    accept: string | null;
  }[];
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
      await db.execute(
        `INSERT INTO realm_user_permissions (realm_url,username,read,write,realm_owner)
      VALUES ($1,$2,true,false,false)`,
        { bind: [realm, user] },
      );
      auth = await secureSessionAuth(db, user);
      delegatedRequests = [];
      config = {
        cookieKeys: ['s'.repeat(40)],
        jwks: { keys: [jwk] },
        allowedUsers: [user],
        resources: [
          {
            resource,
            name: 'Boxel library',
            realms: [realm],
            introspectionClientId: 'mcp',
            introspectionClientSecret: 'r'.repeat(40),
          },
        ],
      };
      let oauth = createBoxelOAuthProvider(config, {
        dbAdapter: db,
        realmSecretSeed,
        secureOriginURL: new URL(issuer),
        matrixClient: new MatrixClient({
          matrixURL: new URL('http://localhost:8008'),
          username: 'unused',
          password: 'unused',
        }),
        realmSession: async (account, root) => {
          if (account !== user || root !== realm)
            throw new Error('Wrong delegated identity');
          return 'private-user-realm-session';
        },
        realmFetch: async (url, init) => {
          delegatedRequests.push({
            url: String(url),
            method: init?.method ?? 'GET',
            authorization: new Headers(init?.headers).get('Authorization'),
            accept: new Headers(init?.headers).get('Accept'),
          });
          return new Response('{"data":{"type":"card"}}', {
            headers: {
              ETag: 'version-2',
              Authorization: 'do-not-expose',
              'Set-Cookie': 'do-not-expose',
            },
          });
        },
      });
      let secure = createSecureOrigin(
        new URL(issuer),
        undefined,
        { realmServerURL: new URL('https://app.boxel.ai/') },
        oauth.handle,
      );
      app = new Koa().use((ctx) => secure.handle(ctx));
    },
    afterEach: async () => resetSecretsAtRest(),
  });

  function browser() {
    let cookies = new Map<string, string>();
    return async function request(
      path: string,
      method: 'get' | 'post' | 'delete' = 'get',
      body?: object | string,
      headers: Record<string, string> = {},
    ) {
      let req = supertest(app.callback())
        [method](path)
        .set('Host', 'secure.example.test')
        .set('X-Forwarded-Proto', 'https')
        .set('Accept', 'application/json');
      if (cookies.size) {
        req.set('Cookie', [...cookies.values()].join('; '));
      }
      for (let [key, value] of Object.entries(headers)) {
        req.set(key, value);
      }
      if (body) {
        req.send(body);
      }
      let response = await req;
      for (let cookie of response.headers['set-cookie'] ?? []) {
        let value = cookie.split(';')[0];
        cookies.set(value.split('=')[0], value);
      }
      return response;
    };
  }
  async function register(
    request: ReturnType<typeof browser>,
    grantTypes = ['authorization_code', 'refresh_token'],
  ) {
    let response = await request('/oauth/register', 'post', {
      client_name: '<script>untrusted</script>',
      redirect_uris: ['https://client.example.test/callback'],
      grant_types: grantTypes,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
    if (response.status !== 201) {
      throw new Error(
        `registration: ${response.status} ${JSON.stringify(response.body)}`,
      );
    }
    return response.body.client_id as string;
  }
  async function begin(
    request: ReturnType<typeof browser>,
    clientId: string,
    overrides: Record<string, string> = {},
  ) {
    let params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'https://client.example.test/callback',
      response_type: 'code',
      scope: 'boxel:read boxel:choices offline_access',
      resource,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'client-state',
      prompt: 'consent',
      ...overrides,
    });
    return await request(`/oauth/authorize?${params}`);
  }
  async function authorize(
    request: ReturnType<typeof browser>,
    clientId: string,
    overrides: Record<string, string> = {},
    approval: Record<string, unknown> = {},
  ) {
    let response = await begin(request, clientId, overrides);
    let prompts: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      let location = new URL(response.headers.location, issuer);
      if (location.origin !== issuer) {
        if (!location.searchParams.get('code')) {
          throw new Error(
            `authorization: ${location.searchParams.get('error')}`,
          );
        }
        return location.searchParams.get('code')!;
      }
      let details = await request(location.pathname);
      if (details.status !== 200) {
        throw new Error(`interaction: ${details.status}`);
      }
      prompts.push(details.body);
      let answer = await request(
        location.pathname,
        'post',
        {
          decision: 'allow',
          realms: [realm],
          ...(details.body.prompt === 'consent' ? approval : {}),
        },
        { Origin: issuer, Authorization: auth },
      );
      if (answer.status !== 200) {
        throw new Error(`approval: ${answer.status}`);
      }
      response = await request(
        new URL(answer.body.redirectTo, issuer).pathname,
      );
    }
    throw new Error(`too many interactions: ${JSON.stringify(prompts)}`);
  }
  async function exchange(
    request: ReturnType<typeof browser>,
    clientId: string,
    code: string,
    codeVerifier = verifier,
  ) {
    return await request(
      '/oauth/token',
      'post',
      new URLSearchParams({
        client_id: clientId,
        code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://client.example.test/callback',
        code_verifier: codeVerifier,
        resource,
      }).toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    );
  }
  async function introspect(
    request: ReturnType<typeof browser>,
    token: string,
    secret = 'r'.repeat(40),
  ) {
    return await request(
      '/oauth/introspect',
      'post',
      new URLSearchParams({ token }).toString(),
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`mcp:${secret}`).toString('base64')}`,
      },
    );
  }

  test('secret-store data keys must be private and canonical', async function (assert) {
    let { SecretStoreKeyProvider, LocalKeyProvider } =
      await import('../lib/secrets-at-rest/providers.ts');
    assert.throws(() => new SecretStoreKeyProvider('not-a-data-key'));
    let local = await new LocalKeyProvider().loadDataKeys();
    assert.throws(
      () => new SecretStoreKeyProvider(local.keys[0].key.toString('base64')),
      'a public development key cannot become a deployment key',
    );
    let { randomBytes } = await import('node:crypto');
    let keyProvider = new SecretStoreKeyProvider(
      randomBytes(32).toString('base64'),
    );
    assert.strictEqual(keyProvider.name, 'secret-store');
    assert.ok(
      (await keyProvider.loadDataKeys()).currentKeyId.startsWith(
        'secret-store-',
      ),
    );
  });
  test('discovery advertises code, PKCE, registration, revocation and introspection', async function (assert) {
    let response = await browser()('/.well-known/oauth-authorization-server');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.issuer, issuer);
    assert.deepEqual(response.body.response_types_supported, ['code']);
    assert.deepEqual(response.body.code_challenge_methods_supported, ['S256']);
    assert.strictEqual(
      response.body.introspection_endpoint,
      `${issuer}/oauth/introspect`,
    );
    assert.ok(response.body.registration_endpoint);
    assert.ok(response.body.revocation_endpoint);
    assert.ok(response.body.scopes_supported.includes('boxel:write'));
    assert.ok(response.body.scopes_supported.includes('offline_access'));
  });
  test('delegated writes require resource authentication, write scope, current ACL and a specific version', async function (assert) {
    config.resources[0].delegatedRealms = [realm];
    let request = browser(),
      id = await register(request);
    let readCode = await authorize(request, id);
    let readToken = (await exchange(request, id, readCode)).body.access_token;
    let code = await authorize(request, id, {
      scope: 'boxel:read boxel:choices boxel:write offline_access',
    });
    let token = (await exchange(request, id, code)).body.access_token;
    let proxy = (
      access: string,
      changes: object = {},
      credentials = 'r'.repeat(40),
    ) =>
      request(
        '/oauth/realm-fetch',
        'post',
        {
          url: realm + 'Product/sample',
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/vnd.card+json',
            'If-Match': 'version-1',
          },
          body: '{}',
          ...changes,
        },
        {
          Authorization: `Basic ${Buffer.from(`mcp:${credentials}`).toString('base64')}`,
          'X-Boxel-Subject-Token': access,
        },
      );
    assert.strictEqual((await proxy(token, {}, 'wrong')).status, 401);
    assert.strictEqual((await proxy(readToken)).status, 403);
    assert.strictEqual(
      (await proxy(token)).status,
      403,
      'read-only Boxel account cannot write',
    );
    assert.strictEqual(delegatedRequests.length, 0);
    await db.execute(
      'UPDATE realm_user_permissions SET write=true WHERE realm_url=$1 AND username=$2',
      { bind: [realm, user] },
    );
    assert.strictEqual(
      (await proxy(token, { url: 'https://unselected.example.test/card' }))
        .status,
      403,
    );
    assert.strictEqual((await proxy(token, { method: 'DELETE' })).status, 405);
    assert.strictEqual(
      (await proxy(token, { headers: { 'If-Match': '*' } })).status,
      428,
    );
    let saved = await proxy(token);
    assert.strictEqual(saved.status, 200);
    assert.strictEqual(saved.headers.etag, 'version-2');
    assert.strictEqual(saved.headers['x-boxel-card-version'], 'version-2');
    assert.notOk(saved.headers.authorization);
    assert.notOk(saved.headers['set-cookie']);
    assert.deepEqual(delegatedRequests, [
      {
        url: realm + 'Product/sample',
        method: 'PATCH',
        authorization: 'private-user-realm-session',
        accept: null,
      },
    ]);
    assert.deepEqual(
      (await introspect(request, token)).body.boxel_write_realms,
      [realm],
    );
    await db.execute(
      'UPDATE realm_user_permissions SET write=false WHERE realm_url=$1 AND username=$2',
      { bind: [realm, user] },
    );
    assert.strictEqual(
      (await proxy(token)).status,
      403,
      'cached realm credential cannot bypass removed write permission',
    );
    assert.deepEqual(
      (await introspect(request, token)).body.boxel_write_realms,
      [],
    );
  });
  test('delegated module reads preserve absent and explicit Accept headers', async function (assert) {
    config.resources[0].delegatedRealms = [realm];
    let request = browser(),
      id = await register(request);
    let token = (await exchange(request, id, await authorize(request, id))).body
      .access_token;
    for (let headers of [{}, { Accept: 'text/javascript' }]) {
      let response = await request(
        '/oauth/realm-fetch',
        'post',
        {
          url: realm + 'furniture',
          method: 'GET',
          headers,
        },
        {
          Authorization: `Basic ${Buffer.from(`mcp:${'r'.repeat(40)}`).toString('base64')}`,
          'X-Boxel-Subject-Token': token,
        },
      );
      assert.strictEqual(response.status, 200);
    }
    assert.deepEqual(
      delegatedRequests.map((request) => request.accept),
      [null, 'text/javascript'],
    );
  });
  test('clients that omit offline_access receive renewal only after explicit consent', async function (assert) {
    let request = browser(),
      id = await register(request);
    let scopes = { scope: 'boxel:read boxel:choices' };
    let ordinary = await exchange(
      request,
      id,
      await authorize(request, id, scopes),
    );
    assert.strictEqual(ordinary.status, 200);
    assert.notOk(
      ordinary.body.refresh_token,
      'short-lived approvals stay short-lived',
    );
    let tokens = await exchange(
      request,
      id,
      await authorize(request, id, scopes, { remember: true }),
    );
    assert.strictEqual(tokens.status, 200, JSON.stringify(tokens.body));
    assert.ok(
      tokens.body.refresh_token,
      'explicit renewal works without offline_access',
    );
    assert.strictEqual(tokens.body.expires_in, 300);
    let initial = await introspect(request, tokens.body.access_token);
    assert.notOk(
      initial.body.scope.includes('offline_access'),
      'no invented scopes',
    );
    await new (oauthAdapter(db))('AccessToken').destroy(
      tokens.body.access_token,
    );
    await db.execute("DELETE FROM oauth_objects WHERE model='Session'");
    let refresh = (token: string) =>
      request(
        '/oauth/token',
        'post',
        new URLSearchParams({
          client_id: id,
          grant_type: 'refresh_token',
          refresh_token: token,
          resource,
        }).toString(),
        { 'Content-Type': 'application/x-www-form-urlencoded' },
      );
    let refreshed = await refresh(tokens.body.refresh_token);
    assert.strictEqual(refreshed.status, 200, JSON.stringify(refreshed.body));
    assert.ok(refreshed.body.refresh_token, 'renewal outlives browser session');
    assert.notStrictEqual(
      refreshed.body.refresh_token,
      tokens.body.refresh_token,
    );
    let renewed = await introspect(request, refreshed.body.access_token);
    assert.true(renewed.body.active);
    assert.deepEqual(renewed.body.boxel_realms, initial.body.boxel_realms);
    assert.strictEqual(renewed.body.scope, initial.body.scope);
    let grants = await request('/oauth/grants', 'get', undefined, {
      Authorization: auth,
    });
    let grant = grants.body.find(
      (item: { renewable_until?: number }) => item.renewable_until,
    );
    assert.strictEqual(grant.renewable_until - grant.issued_at, 30 * 86400);
    let stored = (await readOAuthGrant(db, grant.id))!;
    // Model its deadline passing through the same sealed persistence boundary.
    await db.execute('DELETE FROM oauth_grants WHERE id=$1', {
      bind: [stored.id],
    });
    await saveOAuthGrant(db, {
      ...stored,
      renewableUntil: Math.floor(Date.now() / 1000) - 1,
    });
    assert.strictEqual(
      (await refresh(refreshed.body.refresh_token)).status,
      400,
    );
    assert.false(
      (await introspect(request, refreshed.body.access_token)).body.active,
    );
  });
  test('renewal consent cannot enable a client without refresh support', async function (assert) {
    let request = browser(),
      id = await register(request, ['authorization_code']);
    let response = await begin(request, id, {
      scope: 'boxel:read boxel:choices',
    });
    let refused = false;
    for (let i = 0; i < 3; i++) {
      let location = new URL(response.headers.location, issuer);
      let details = await request(location.pathname);
      assert.false(details.body.canRefresh);
      let answer = await request(
        location.pathname,
        'post',
        { decision: 'allow', realms: [realm], remember: true },
        { Origin: issuer, Authorization: auth },
      );
      if (details.body.prompt === 'consent') {
        refused = answer.status === 400;
        break;
      }
      response = await request(
        new URL(answer.body.redirectTo, issuer).pathname,
      );
    }
    assert.true(
      refused,
      'renewal refused for a client without refresh support',
    );
  });
  test('real code flow issues a resource-bound token and rotated refresh tokens', async function (assert) {
    let request = browser(),
      id = await register(request),
      code = await authorize(request, id);
    let tokens = await exchange(request, id, code);
    assert.strictEqual(tokens.status, 200, JSON.stringify(tokens.body));
    assert.ok(tokens.body.refresh_token, 'offline access approved');
    assert.notOk(
      JSON.stringify(tokens.body).includes(auth),
      'secure session stays in Boxel',
    );
    let check = await introspect(request, tokens.body.access_token);
    assert.true(check.body.active, JSON.stringify(check.body));
    assert.strictEqual(check.body.sub, user);
    assert.strictEqual(check.body.aud, resource);
    assert.deepEqual(check.body.boxel_realms, [realm]);
    let refreshBody = (refreshToken: string) =>
      new URLSearchParams({
        client_id: id,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        resource,
      }).toString();
    let refreshed = await request(
      '/oauth/token',
      'post',
      refreshBody(tokens.body.refresh_token),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    );
    assert.strictEqual(refreshed.status, 200, 'refresh succeeds');
    assert.notStrictEqual(
      refreshed.body.refresh_token,
      tokens.body.refresh_token,
      'refresh token rotates',
    );
    let reused = await request(
      '/oauth/token',
      'post',
      refreshBody(tokens.body.refresh_token),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    );
    assert.strictEqual(
      reused.status,
      400,
      'reusing a rotated refresh token is refused',
    );
    let replay = await exchange(request, id, code);
    assert.strictEqual(replay.status, 400, 'authorization code is single use');
  });
  test('a wrong PKCE verifier cannot redeem the code', async function (assert) {
    let request = browser(),
      id = await register(request),
      code = await authorize(request, id);
    let answer = await exchange(request, id, code, 'b'.repeat(43));
    assert.strictEqual(answer.status, 400);
    assert.strictEqual(answer.body.error, 'invalid_grant');
  });
  test('ordinary app tokens and a different browser cannot approve access', async function (assert) {
    let request = browser(),
      id = await register(request),
      start = await begin(request, id);
    let path = new URL(start.headers.location, issuer).pathname;
    let appToken = createJWT({ user, sessionRoom: 'app' }, realmSecretSeed);
    let refused = await request(
      path,
      'post',
      { decision: 'allow', realms: [realm] },
      { Origin: issuer, Authorization: `Bearer ${appToken}` },
    );
    assert.strictEqual(refused.status, 403);
    let otherBrowser = await browser()(
      path,
      'post',
      { decision: 'allow', realms: [realm] },
      { Origin: issuer, Authorization: auth },
    );
    assert.ok(
      otherBrowser.status >= 400,
      'interaction bound to original browser cookie',
    );
  });
  test('unregistered resources and redirects are refused before issuing a grant', async function (assert) {
    let request = browser(),
      id = await register(request);
    let target = await begin(request, id, {
      resource: 'https://attacker.example/mcp',
    });
    let refused =
      target.status === 400 ||
      String(target.headers.location).includes('error=');
    assert.true(refused);
    let redirect = await begin(request, id, {
      redirect_uri: 'https://attacker.example/callback',
    });
    assert.strictEqual(redirect.status, 400);
    assert.notOk(
      redirect.headers.location,
      'no redirect to an unregistered URI',
    );
  });
  test('removed realm permission invalidates an already issued token immediately', async function (assert) {
    let request = browser(),
      id = await register(request),
      code = await authorize(request, id);
    let tokens = await exchange(request, id, code);
    assert.true(
      (await introspect(request, tokens.body.access_token)).body.active,
    );
    await db.execute(
      'DELETE FROM realm_user_permissions WHERE realm_url=$1 AND username=$2',
      { bind: [realm, user] },
    );
    assert.false(
      (await introspect(request, tokens.body.access_token)).body.active,
    );
  });
  test('only the bound confidential resource server can introspect', async function (assert) {
    let request = browser(),
      id = await register(request),
      code = await authorize(request, id);
    let tokens = await exchange(request, id, code);
    assert.strictEqual(
      (await introspect(request, tokens.body.access_token, 'wrong-secret'))
        .status,
      401,
    );
    let noAuth = await request(
      '/oauth/introspect',
      'post',
      new URLSearchParams({
        token: tokens.body.access_token,
        client_id: id,
      }).toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    );
    assert.false(noAuth.body.active);
  });
  test('the owner can revoke one grant from the secure origin', async function (assert) {
    let request = browser(),
      id = await register(request),
      code = await authorize(request, id);
    let tokens = await exchange(request, id, code);
    let grants = await request('/oauth/grants', 'get', undefined, {
      Origin: issuer,
      Authorization: auth,
    });
    assert.strictEqual(grants.status, 200);
    assert.strictEqual(
      grants.body[0].client_name,
      '<script>untrusted</script>',
      'the listing names the client by its registered name, as data',
    );
    assert.strictEqual(
      grants.body[0].client_host,
      'client.example.test',
      'the listing names the host the client returns to',
    );
    let revoked = await request(
      '/oauth/grants',
      'delete',
      { id: grants.body[0].id },
      { Origin: issuer, Authorization: auth },
    );
    assert.strictEqual(revoked.status, 204);
    assert.false(
      (await introspect(request, tokens.body.access_token)).body.active,
    );
    let refresh = await request(
      '/oauth/token',
      'post',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.body.refresh_token,
        client_id: id,
        resource,
      }).toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    );
    assert.strictEqual(refresh.status, 400);
  });
  test('all-session revocation invalidates existing OAuth grants', async function (assert) {
    let request = browser(),
      id = await register(request),
      code = await authorize(request, id);
    let tokens = await exchange(request, id, code);
    // Deliberately older than revocation, matching Boxel's epoch-second semantics.
    await revokeUserSessions(db, user);
    await db.execute(
      'UPDATE users SET sessions_revoked_at=sessions_revoked_at+2 WHERE matrix_user_id=$1',
      { bind: [user] },
    );
    assert.false(
      (await introspect(request, tokens.body.access_token)).body.active,
    );
  });
  test('artifacts are sealed, bound to their row and consumed atomically', async function (assert) {
    let Adapter = oauthAdapter(db),
      adapter = new Adapter('AuthorizationCode');
    let id = randomUUID();
    await adapter.upsert(
      id,
      { jti: id, codeChallenge: 'secret-challenge' },
      60,
    );
    let [row] = await db.execute('SELECT * FROM oauth_objects WHERE id=$1', {
      bind: [oauthId(`AuthorizationCode:${id}`)],
    });
    assert.notOk(JSON.stringify(row).includes('secret-challenge'));
    let results = await Promise.allSettled([
      adapter.consume(id),
      adapter.consume(id),
    ]);
    assert.strictEqual(
      results.filter((r) => r.status === 'fulfilled').length,
      1,
      'one consumer across concurrent requests',
    );
    assert.ok((await adapter.find(id))?.consumed);
  });
});
