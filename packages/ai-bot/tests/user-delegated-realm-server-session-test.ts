import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import {
  requestDelegatedRealmSession,
  verifyDelegatedRealmSessionRequest,
  DelegatedRealmSessionError,
  DELEGATED_REALM_SESSION_TIMESTAMP_HEADER,
  DELEGATED_REALM_SESSION_SIGNATURE_HEADER,
} from '@cardstack/runtime-common/user-delegated-realm-server-session';
import { DelegatedRealmSessionManager } from '../lib/user-delegated-realm-server-session.ts';

const SECRET = 'shared-secret-under-test';
const ON_BEHALF_OF = '@example-user:boxel.ai';
const REALM = 'https://realm.example.com/u/example-user/';

// Builds a minimally-valid JWT carrying the given `exp` (epoch seconds) in its
// payload — the manager only ever reads `exp` off the token, so the header and
// signature segments are placeholders. Payload is base64url, matching real JWTs
// (jsonwebtoken) — standard base64 here would hide a payload the manager can't
// decode.
function makeToken(expSeconds: number): string {
  let payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString(
    'base64url',
  );
  return `header.${payload}.signature`;
}

// A fake fetch that records each call and returns a scripted Response.
function recordingFetch(
  handler: (url: string, init: RequestInit) => Response,
): {
  fetch: typeof globalThis.fetch;
  calls: { url: string; init: RequestInit }[];
} {
  let calls: { url: string; init: RequestInit }[] = [];
  let fetch = (async (input: any, init: any) => {
    let url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

module('delegated realm session client', () => {
  test('signs the request so the server verifier accepts it', async () => {
    let now = 1_700_000_000_000;
    let captured: RequestInit | undefined;
    let { fetch } = recordingFetch((_url, init) => {
      captured = init;
      return jsonResponse({
        token: makeToken(1),
        realm: REALM,
        permissions: ['read'],
      });
    });

    await requestDelegatedRealmSession({
      realmServerURL: 'https://realm.example.com',
      secret: SECRET,
      onBehalfOf: ON_BEHALF_OF,
      realm: REALM,
      fetch,
      now,
    });

    let headers = captured!.headers as Record<string, string>;
    let result = verifyDelegatedRealmSessionRequest({
      secret: SECRET,
      timestamp: headers[DELEGATED_REALM_SESSION_TIMESTAMP_HEADER],
      signature: headers[DELEGATED_REALM_SESSION_SIGNATURE_HEADER],
      rawBody: captured!.body as string,
      now,
    });
    assert.true(result.ok, 'server verifier accepts the client signature');
    assert.strictEqual(
      headers[DELEGATED_REALM_SESSION_TIMESTAMP_HEADER],
      String(now),
      'timestamp header carries the signing time',
    );
  });

  test('POSTs to /_delegate-session at the given realm-server origin', async () => {
    let { fetch, calls } = recordingFetch(() =>
      jsonResponse({
        token: makeToken(1),
        realm: REALM,
        permissions: ['read'],
      }),
    );
    await requestDelegatedRealmSession({
      realmServerURL: 'https://realm.example.com',
      secret: SECRET,
      onBehalfOf: ON_BEHALF_OF,
      realm: REALM,
      fetch,
      now: 1,
    });
    assert.strictEqual(
      calls[0].url,
      'https://realm.example.com/_delegate-session',
    );
    assert.strictEqual(calls[0].init.method, 'POST');
  });

  test('maps status codes to typed DelegatedRealmSessionError kinds', async () => {
    let cases: { status: number; kind: string }[] = [
      { status: 503, kind: 'disabled' },
      { status: 403, kind: 'forbidden' },
      { status: 401, kind: 'unauthorized' },
      { status: 400, kind: 'bad-request' },
      { status: 500, kind: 'unexpected' },
    ];
    for (let { status, kind } of cases) {
      let { fetch } = recordingFetch(() => new Response('nope', { status }));
      try {
        await requestDelegatedRealmSession({
          realmServerURL: 'https://realm.example.com',
          secret: SECRET,
          onBehalfOf: ON_BEHALF_OF,
          realm: REALM,
          fetch,
          now: 1,
        });
        assert.true(false, `expected ${status} to throw`);
      } catch (e) {
        assert.true(
          e instanceof DelegatedRealmSessionError,
          `${status} → DelegatedRealmSessionError`,
        );
        assert.strictEqual(
          (e as DelegatedRealmSessionError).kind,
          kind,
          `${status} → ${kind}`,
        );
      }
    }
  });
});

module('DelegatedRealmSessionManager', () => {
  test('is disabled and throws when no secret is configured', async () => {
    let manager = new DelegatedRealmSessionManager(undefined);
    assert.false(manager.enabled, 'manager reports disabled');
    try {
      await manager.getToken({ onBehalfOf: ON_BEHALF_OF, realm: REALM });
      assert.true(false, 'expected getToken to throw');
    } catch (e) {
      assert.true(e instanceof DelegatedRealmSessionError);
      assert.strictEqual((e as DelegatedRealmSessionError).kind, 'disabled');
    }
  });

  test('caches a valid token and does not re-mint', async () => {
    let now = 1_700_000_000_000;
    let nowSeconds = Math.floor(now / 1000);
    let { fetch, calls } = recordingFetch(() =>
      jsonResponse({
        token: makeToken(nowSeconds + 1800), // 30m out, well clear of the lead time
        realm: REALM,
        permissions: ['read'],
      }),
    );
    let manager = new DelegatedRealmSessionManager(SECRET, {
      fetch,
      now: () => now,
    });

    let a = await manager.getToken({ onBehalfOf: ON_BEHALF_OF, realm: REALM });
    let b = await manager.getToken({ onBehalfOf: ON_BEHALF_OF, realm: REALM });
    assert.strictEqual(a, b, 'same cached token returned');
    assert.strictEqual(calls.length, 1, 'minted exactly once');
  });

  test('proactively re-mints when within the 2-minute lead time', async () => {
    let now = 1_700_000_000_000;
    let nowSeconds = Math.floor(now / 1000);
    // exp is 90s out — inside the 120s lead window, so the cached copy is
    // considered too close to expiry to reuse.
    let { fetch, calls } = recordingFetch(() =>
      jsonResponse({
        token: makeToken(nowSeconds + 90),
        realm: REALM,
        permissions: ['read'],
      }),
    );
    let manager = new DelegatedRealmSessionManager(SECRET, {
      fetch,
      now: () => now,
    });

    await manager.getToken({ onBehalfOf: ON_BEHALF_OF, realm: REALM });
    await manager.getToken({ onBehalfOf: ON_BEHALF_OF, realm: REALM });
    assert.strictEqual(calls.length, 2, 're-minted because token was expiring');
  });

  test('caches per (user, realm) pair independently', async () => {
    let now = 1_700_000_000_000;
    let nowSeconds = Math.floor(now / 1000);
    let { fetch, calls } = recordingFetch(() =>
      jsonResponse({
        token: makeToken(nowSeconds + 1800),
        realm: REALM,
        permissions: ['read'],
      }),
    );
    let manager = new DelegatedRealmSessionManager(SECRET, {
      fetch,
      now: () => now,
    });

    await manager.getToken({ onBehalfOf: ON_BEHALF_OF, realm: REALM });
    await manager.getToken({
      onBehalfOf: '@another-user:boxel.ai',
      realm: REALM,
    });
    await manager.getToken({
      onBehalfOf: ON_BEHALF_OF,
      realm: 'https://realm.example.com/u/another-realm/',
    });
    assert.strictEqual(calls.length, 3, 'each distinct key minted separately');
  });

  test('derives the realm-server origin from the realm URL', async () => {
    let now = 1_700_000_000_000;
    let nowSeconds = Math.floor(now / 1000);
    let { fetch, calls } = recordingFetch(() =>
      jsonResponse({
        token: makeToken(nowSeconds + 1800),
        realm: REALM,
        permissions: ['read'],
      }),
    );
    let manager = new DelegatedRealmSessionManager(SECRET, {
      fetch,
      now: () => now,
    });
    await manager.getToken({
      onBehalfOf: ON_BEHALF_OF,
      realm: 'https://realm.example.com/u/example-user/',
    });
    assert.strictEqual(
      calls[0].url,
      'https://realm.example.com/_delegate-session',
      'POSTs to the realm origin, not the realm path',
    );
  });

  test('invalidate() forces the next getToken to re-mint', async () => {
    let now = 1_700_000_000_000;
    let nowSeconds = Math.floor(now / 1000);
    let { fetch, calls } = recordingFetch(() =>
      jsonResponse({
        token: makeToken(nowSeconds + 1800),
        realm: REALM,
        permissions: ['read'],
      }),
    );
    let manager = new DelegatedRealmSessionManager(SECRET, {
      fetch,
      now: () => now,
    });
    await manager.getToken({ onBehalfOf: ON_BEHALF_OF, realm: REALM });
    manager.invalidate({ onBehalfOf: ON_BEHALF_OF, realm: REALM });
    await manager.getToken({ onBehalfOf: ON_BEHALF_OF, realm: REALM });
    assert.strictEqual(calls.length, 2, 're-minted after invalidate');
  });
});
