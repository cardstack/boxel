import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import jwt from 'jsonwebtoken';
import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import {
  CAPTURE_URL_TOKEN_PARAM,
  CAPTURE_URL_TOKEN_SCOPE,
  MAX_CAPTURE_URLS_PER_SIGNING_REQUEST,
  MEDIA_CACHE_MAX_AGE_SECONDS,
  captureURLTokenBinding,
  revokeUserSessions,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  createJWT,
  realmSecretSeed,
} from '../helpers/index.ts';
import { FakeMediaCacheAdapter } from '../helpers/fake-media-cache-adapter.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

// The signed-capture-URL surface: the `_sign-capture-urls` mint endpoint
// (QUERY, realm-read gated) and the `?token=` acceptance on `_screenshot/`
// GETs. Nothing in these realms has been captured, so an authorized request
// lands on the uncaptured-miss shape (404 with the route's private, briefly
// cacheable cache-control) — which is exactly what separates "the token
// authorized the request" from the 401 the same request draws without one.

// Mint through the header-override spelling of QUERY — the same one the
// host's card-service sends — which also pins the override translation to
// the read-permission classification (a plain POST would demand write).
function mint(
  request: SuperTest<Test>,
  urls: unknown,
  authToken?: string,
): Test {
  let req = request
    .post('/_sign-capture-urls')
    .set('X-HTTP-Method-Override', 'QUERY')
    .set('Accept', 'application/json')
    .set('Content-Type', 'application/json');
  if (authToken) {
    req = req.set('Authorization', `Bearer ${authToken}`);
  }
  return req.send(JSON.stringify({ urls }));
}

// Craft a capture-URL token directly, for the cases the mint endpoint will
// never produce: wrong realm, wrong scope, expired, revoked-before-issued.
// `iat` is backdated a minute so near-expiry and revocation comparisons are
// strict-inequality-proof (a token inspected the second it was signed has
// exactly the full TTL remaining).
function craftToken(
  claims: Record<string, unknown>,
  { iatOffsetSec = -60, ttlSec = 900 }: Partial<Record<string, number>> = {},
): string {
  let iat = Math.floor(Date.now() / 1000) + iatOffsetSec;
  return jwt.sign({ ...claims, iat, exp: iat + ttlSec }, realmSecretSeed);
}

function tokenFrom(signedUrl: string): string {
  let token = new URL(signedUrl).searchParams.get(CAPTURE_URL_TOKEN_PARAM);
  if (!token) {
    throw new Error(`expected a token param on ${signedUrl}`);
  }
  return token;
}

module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('on a private realm', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      mediaCacheAdapter: new FakeMediaCacheAdapter(),
      permissions: {
        mary: ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup: (args) => {
        testRealm = args.testRealm;
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    function captureURL(path: string): string {
      return `${testRealm.url}_screenshot/${path}`;
    }

    async function mintOne(path: string, user = 'mary'): Promise<string> {
      let response = await mint(
        request,
        [captureURL(path)],
        createJWT(testRealm, user, user === 'mary' ? ['read'] : undefined),
      );
      if (response.status !== 200) {
        throw new Error(
          `mint failed: ${response.status} ${JSON.stringify(response.body)}`,
        );
      }
      return response.body.signed[0].signedUrl;
    }

    test('minting requires authentication', async function (assert) {
      let response = await mint(request, [captureURL('some-card')]);
      assert.strictEqual(response.status, 401);
    });

    test('a read-only user mints a signed variant of a capture URL', async function (assert) {
      let url = captureURL('some-card?type=pdf');
      let response = await mint(
        request,
        [url],
        createJWT(testRealm, 'mary', ['read']),
      );
      assert.strictEqual(response.status, 200);
      let entry = response.body.signed[0];
      assert.strictEqual(entry.url, url, 'the durable URL is echoed');
      let signed = new URL(entry.signedUrl);
      assert.true(
        signed.searchParams.has(CAPTURE_URL_TOKEN_PARAM),
        'the signed variant carries a token param',
      );
      signed.searchParams.delete(CAPTURE_URL_TOKEN_PARAM);
      assert.strictEqual(
        signed.href,
        url,
        'the signed variant differs only by the token',
      );
      assert.true(
        new Date(entry.expiresAt).getTime() > Date.now(),
        'expiresAt is in the future',
      );
    });

    test('a signed URL authorizes its own GET with no Authorization header', async function (assert) {
      let bare = await request
        .get('/_screenshot/some-card?type=pdf')
        .set('Accept', 'image/png');
      assert.strictEqual(bare.status, 401, 'the bare URL still 401s');

      let signedUrl = await mintOne('some-card?type=pdf');
      let response = await request
        .get(new URL(signedUrl).pathname + new URL(signedUrl).search)
        .set('Accept', 'image/png');
      assert.strictEqual(
        response.status,
        404,
        'the token authorizes; nothing is captured, so the miss shape answers',
      );
      assert.strictEqual(
        response.headers['cache-control'],
        `private, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
        'the response is the screenshot miss, not a generic 404 — the token also never reached the capture-spec parse',
      );
    });

    test('the binding is insensitive to query param order', async function (assert) {
      let signedUrl = await mintOne('some-card?type=pdf&media=print');
      let token = tokenFrom(signedUrl);
      let response = await request
        .get(
          `/_screenshot/some-card?media=print&${CAPTURE_URL_TOKEN_PARAM}=${encodeURIComponent(
            token,
          )}&type=pdf`,
        )
        .set('Accept', 'image/png');
      assert.strictEqual(response.status, 404, 'reordered params still verify');
    });

    test('a token replays only against the URL it was minted for', async function (assert) {
      let signedUrl = await mintOne('some-card?type=pdf');
      let token = tokenFrom(signedUrl);
      let otherPath = await request
        .get(
          `/_screenshot/other-card?type=pdf&${CAPTURE_URL_TOKEN_PARAM}=${encodeURIComponent(token)}`,
        )
        .set('Accept', 'image/png');
      assert.strictEqual(otherPath.status, 401, 'another path is refused');
      let otherSpec = await request
        .get(
          `/_screenshot/some-card?type=pdf&media=print&${CAPTURE_URL_TOKEN_PARAM}=${encodeURIComponent(
            token,
          )}`,
        )
        .set('Accept', 'image/png');
      assert.strictEqual(otherSpec.status, 401, 'another spec is refused');
    });

    test('a session JWT in the token param is refused', async function (assert) {
      // The scope claim is what keeps query strings from becoming an
      // alternate door for full session tokens.
      let sessionToken = createJWT(testRealm, 'mary', ['read']);
      let response = await request
        .get(
          `/_screenshot/some-card?${CAPTURE_URL_TOKEN_PARAM}=${encodeURIComponent(
            sessionToken,
          )}`,
        )
        .set('Accept', 'image/png');
      assert.strictEqual(response.status, 401);
    });

    test('a token minted for another realm is refused', async function (assert) {
      let binding = captureURLTokenBinding(
        '_screenshot/some-card',
        new URLSearchParams(),
      );
      let token = craftToken({
        user: 'mary',
        realm: 'http://some-other-realm/',
        scope: CAPTURE_URL_TOKEN_SCOPE,
        url: binding,
      });
      let response = await request
        .get(
          `/_screenshot/some-card?${CAPTURE_URL_TOKEN_PARAM}=${encodeURIComponent(token)}`,
        )
        .set('Accept', 'image/png');
      assert.strictEqual(response.status, 401);
    });

    test('an expired token is refused', async function (assert) {
      let binding = captureURLTokenBinding(
        '_screenshot/some-card',
        new URLSearchParams(),
      );
      let token = craftToken(
        {
          user: 'mary',
          realm: testRealm.url,
          scope: CAPTURE_URL_TOKEN_SCOPE,
          url: binding,
        },
        { iatOffsetSec: -3600, ttlSec: 900 },
      );
      let response = await request
        .get(
          `/_screenshot/some-card?${CAPTURE_URL_TOKEN_PARAM}=${encodeURIComponent(token)}`,
        )
        .set('Accept', 'image/png');
      assert.strictEqual(response.status, 401);
    });

    test('a revoked user’s token is refused', async function (assert) {
      let binding = captureURLTokenBinding(
        '_screenshot/some-card',
        new URLSearchParams(),
      );
      // Backdated iat, so the revocation recorded now strictly postdates it.
      let token = craftToken({
        user: 'revoked-mary',
        realm: testRealm.url,
        scope: CAPTURE_URL_TOKEN_SCOPE,
        url: binding,
      });
      await revokeUserSessions(dbAdapter, 'revoked-mary');
      let response = await request
        .get(
          `/_screenshot/some-card?${CAPTURE_URL_TOKEN_PARAM}=${encodeURIComponent(token)}`,
        )
        .set('Accept', 'image/png');
      assert.strictEqual(response.status, 401);
    });

    test('a declared-name URL signs and its token clears the name-exclusivity check', async function (assert) {
      let signedUrl = await mintOne('some-card?name=hero');
      let signed = new URL(signedUrl);
      let response = await request
        .get(signed.pathname + signed.search)
        .set('Accept', 'image/png');
      assert.strictEqual(
        response.status,
        404,
        'the miss shape answers — the token param was stripped before the name-cannot-be-combined refusal',
      );
      assert.strictEqual(
        response.headers['cache-control'],
        `private, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
      );
    });

    test('the mint endpoint refuses what it must', async function (assert) {
      let auth = createJWT(testRealm, 'mary', ['read']);
      let nonCapture = await mint(request, [`${testRealm.url}some-card`], auth);
      assert.strictEqual(
        nonCapture.status,
        400,
        'a non-_screenshot URL is refused',
      );
      let otherRealm = await mint(
        request,
        ['http://some-other-realm/_screenshot/card'],
        auth,
      );
      assert.strictEqual(
        otherRealm.status,
        400,
        'another realm’s URL is refused',
      );
      let overCap = await mint(
        request,
        Array.from(
          { length: MAX_CAPTURE_URLS_PER_SIGNING_REQUEST + 1 },
          (_, i) => captureURL(`card-${i}`),
        ),
        auth,
      );
      assert.strictEqual(overCap.status, 400, 'an oversized batch is refused');
      let badBody = await mint(request, 'not-an-array', auth);
      assert.strictEqual(badBody.status, 400, 'a non-array body is refused');
    });
  });

  module('on a world-readable realm', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      mediaCacheAdapter: new FakeMediaCacheAdapter(),
      permissions: {
        '*': ['read'],
        '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
      },
      onRealmSetup: (args) => {
        testRealm = args.testRealm;
        request = args.request;
      },
    });

    test('an anonymous caller gets the URLs echoed back unsigned', async function (assert) {
      // There is no user to bind a token to, and none is needed where
      // anonymous read already serves.
      let url = `${testRealm.url}_screenshot/some-card`;
      let response = await mint(request, [url]);
      assert.strictEqual(response.status, 200);
      assert.deepEqual(response.body.signed[0], {
        url,
        signedUrl: url,
        expiresAt: null,
      });
    });

    test('an authenticated caller still gets a signed variant', async function (assert) {
      let url = `${testRealm.url}_screenshot/some-card`;
      let response = await mint(
        request,
        [url],
        createJWT(testRealm, '@node-test_realm:localhost'),
      );
      assert.strictEqual(response.status, 200);
      assert.true(
        new URL(response.body.signed[0].signedUrl).searchParams.has(
          CAPTURE_URL_TOKEN_PARAM,
        ),
      );
    });

    test('an invalid token never breaks a request public read already authorizes', async function (assert) {
      let response = await request
        .get(`/_screenshot/some-card?${CAPTURE_URL_TOKEN_PARAM}=garbage`)
        .set('Accept', 'image/png');
      assert.strictEqual(
        response.status,
        404,
        'the failing token falls through to the public-read grant and the miss shape answers',
      );
    });
  });
});
