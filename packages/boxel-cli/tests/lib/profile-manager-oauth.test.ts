import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OAuthConnectionEndedError,
  refreshTokens,
} from '../../src/lib/oauth-login.ts';
import {
  ProfileManager,
  type OAuthSessionRecord,
} from '../../src/lib/profile-manager.ts';
import { AiCreditsNotAllowedError } from '../../src/lib/oauth-refusals.ts';

const REALM_SERVER_URL = 'https://realms.example.test/';
const ISSUER = 'https://realms.example.test';
const TOKEN_ENDPOINT = `${ISSUER}/_oauth-provider/token`;
const USER_ID = '@example-user:example.test';
const REALM_URL = `${REALM_SERVER_URL}example-user/example-realm/`;
const START = Date.parse('2026-11-24T00:00:00Z');
const MINUTE = 60_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// A provider that behaves as the realm server's: access tokens last ten
// minutes, each refresh token works once and is replaced, and presenting a
// spent one ends the whole connection.
function provider(clock: { now: number }) {
  let serial = 0;
  let live = new Map<string, number>([['access-0', START + 10 * MINUTE]]);
  let refreshable = new Set(['refresh-0']);
  let ended = false;
  let refreshRequests: URLSearchParams[] = [];

  let tokenFetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    let params = new URLSearchParams(String(init?.body));
    refreshRequests.push(params);
    let presented = params.get('refresh_token')!;
    if (ended || !refreshable.has(presented)) {
      ended = true;
      live.clear();
      refreshable.clear();
      return jsonResponse({ error: 'invalid_grant' }, 400);
    }
    refreshable.delete(presented);
    serial++;
    let access = `access-${serial}`;
    let refresh = `refresh-${serial}`;
    live.set(access, clock.now + 10 * MINUTE);
    refreshable.add(refresh);
    return jsonResponse({
      access_token: access,
      refresh_token: refresh,
      expires_in: 600,
      token_type: 'Bearer',
    });
  }) as typeof fetch;

  // The realm server: a live access token reaches every route but the one
  // the Boxel API doesn't offer, which is refused with the same 401.
  let seen: { url: string; authorization: string | null }[] = [];
  let realmFetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      let url = String(input instanceof Request ? input.url : input);
      let authorization = new Headers(init?.headers).get('Authorization');
      seen.push({ url, authorization });
      let token = authorization?.replace(/^Bearer /, '') ?? '';
      let expiresAt = live.get(token);
      if (
        !expiresAt ||
        expiresAt <= clock.now ||
        url.endsWith('/_run-command')
      ) {
        return jsonResponse({ error: 'invalid_token' }, 401);
      }
      return jsonResponse({ ok: true });
    },
  );

  return {
    tokenFetch,
    realmFetch,
    seen,
    refreshRequests,
    get ended() {
      return ended;
    },
  };
}

function oauthRecord(overrides: Partial<OAuthSessionRecord> = {}) {
  return {
    issuer: ISSUER,
    tokenEndpoint: TOKEN_ENDPOINT,
    accessToken: 'access-0',
    refreshToken: 'refresh-0',
    accessExpiresAt: new Date(START + 10 * MINUTE).toISOString(),
    connectionEndsAt: new Date(START + 30 * 24 * 60 * MINUTE).toISOString(),
    ...overrides,
  } satisfies OAuthSessionRecord;
}

describe('ProfileManager on an OAuth profile', () => {
  let dir: string;
  let clock: { now: number };
  let server: ReturnType<typeof provider>;

  function manager() {
    return new ProfileManager(dir, {
      now: () => clock.now,
      refreshTokens: (p, token, options) =>
        refreshTokens(p, token, { ...options, fetchFn: server.tokenFetch }),
    });
  }

  function saved(): OAuthSessionRecord {
    return JSON.parse(fs.readFileSync(path.join(dir, 'profiles.json'), 'utf8'))
      .profiles[USER_ID].oauth;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-oauth-profile-'));
    clock = { now: START };
    server = provider(clock);
    vi.stubGlobal('fetch', server.realmFetch);
    manager().addOAuthProfile(USER_ID, oauthRecord(), {
      matrixUrl: 'https://matrix.example.test/',
      realmServerUrl: REALM_SERVER_URL,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sends the access token as a Bearer token to realms and the realm server', async () => {
    let pm = manager();

    await pm.authedRealmFetch(`${REALM_URL}_info`);
    await pm.authedRealmServerFetch(`${REALM_SERVER_URL}_user-realms`);

    expect(server.seen.map((r) => r.authorization)).toEqual([
      'Bearer access-0',
      'Bearer access-0',
    ]);
    expect(server.refreshRequests).toHaveLength(0);
  });

  it('sends the access token only to the realm server', async () => {
    let pm = manager();
    clock.now = START + 9.5 * MINUTE;

    await pm.authedRealmFetch('https://elsewhere.example.test/a/card.json');
    await pm.authedRealmServerFetch('https://elsewhere.example.test/_user');

    expect(server.seen.map((r) => r.authorization)).toEqual([null, null]);
    // Not even renewed for a request that doesn't carry it.
    expect(server.refreshRequests).toHaveLength(0);
  });

  it('has no per-realm token to hand out', async () => {
    await expect(
      manager().getRealmTokenForUrl(`${REALM_URL}card.json`),
    ).resolves.toBeUndefined();
  });

  it('renews an access token about to run out before sending it, and saves the new tokens', async () => {
    let pm = manager();
    clock.now = START + 9.5 * MINUTE;

    let response = await pm.authedRealmFetch(`${REALM_URL}_info`);

    expect(response.status).toBe(200);
    expect(server.seen.map((r) => r.authorization)).toEqual([
      'Bearer access-1',
    ]);
    let request = server.refreshRequests[0];
    expect(Object.fromEntries(request)).toEqual({
      client_id: 'boxel-cli',
      resource: ISSUER,
      grant_type: 'refresh_token',
      refresh_token: 'refresh-0',
    });
    expect(saved()).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessExpiresAt: new Date(clock.now + 10 * MINUTE).toISOString(),
      connectionEndsAt: oauthRecord().connectionEndsAt,
    });
  });

  it('retries a refused request once with a renewed token', async () => {
    // The realm server refuses the token, which by this process's clock still
    // has two minutes left (a clock that runs slow, say).
    clock.now = START + 10 * MINUTE;
    let pmWithStaleClock = new ProfileManager(dir, {
      now: () => START + 8 * MINUTE,
      refreshTokens: (p, token, options) =>
        refreshTokens(p, token, { ...options, fetchFn: server.tokenFetch }),
    });

    let response = await pmWithStaleClock.authedRealmServerFetch(
      `${REALM_SERVER_URL}_user-realms`,
    );

    expect(response.status).toBe(200);
    expect(server.seen.map((r) => r.authorization)).toEqual([
      'Bearer access-0',
      'Bearer access-1',
    ]);
  });

  it("returns a route's refusal after one retry, keeping the connection", async () => {
    let pm = manager();

    let response = await pm.authedRealmServerFetch(
      `${REALM_SERVER_URL}_run-command`,
      { method: 'POST' },
    );

    expect(response.status).toBe(401);
    expect(server.seen).toHaveLength(2);
    expect(server.ended).toBe(false);
    let next = await pm.authedRealmFetch(`${REALM_URL}_info`);
    expect(next.status).toBe(200);
  });

  it('renews at most once for a route that keeps refusing the token', async () => {
    let pm = manager();

    for (let i = 0; i < 5; i++) {
      let response = await pm.authedRealmServerFetch(
        `${REALM_SERVER_URL}_run-command`,
        { method: 'POST' },
      );
      expect(response.status).toBe(401);
    }

    expect(server.refreshRequests).toHaveLength(1);
    expect(server.seen).toHaveLength(6);
  });

  it("doesn't renew for a route's refusal once the token has worked", async () => {
    let pm = manager();
    await pm.authedRealmFetch(`${REALM_URL}_info`);

    let response = await pm.authedRealmServerFetch(
      `${REALM_SERVER_URL}_run-command`,
      { method: 'POST' },
    );

    expect(response.status).toBe(401);
    expect(server.seen).toHaveLength(2);
    expect(server.refreshRequests).toHaveLength(0);
  });

  it("doesn't retry a refusal on a connection that doesn't renew", async () => {
    fs.rmSync(path.join(dir, 'profiles.json'));
    manager().addOAuthProfile(
      USER_ID,
      oauthRecord({ refreshToken: undefined }),
      {
        matrixUrl: 'https://matrix.example.test/',
        realmServerUrl: REALM_SERVER_URL,
      },
    );

    let response = await manager().authedRealmServerFetch(
      `${REALM_SERVER_URL}_run-command`,
      { method: 'POST' },
    );

    expect(response.status).toBe(401);
    expect(server.seen).toHaveLength(1);
    expect(server.refreshRequests).toHaveLength(0);
  });

  it('keeps the connection when two boxel commands renew at once', async () => {
    // Both loaded the profile before either renewed, so both hold the same
    // refresh token. Sending it twice would end the connection.
    let first = manager();
    let second = manager();
    clock.now = START + 9.5 * MINUTE;

    let responses = await Promise.all([
      first.authedRealmFetch(`${REALM_URL}_info`),
      second.authedRealmFetch(`${REALM_URL}_info`),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(server.refreshRequests).toHaveLength(1);
    expect(server.ended).toBe(false);
    expect(server.seen.map((r) => r.authorization)).toEqual([
      'Bearer access-1',
      'Bearer access-1',
    ]);
    expect(saved().refreshToken).toBe('refresh-1');
  });

  it('uses the tokens another boxel command renewed since this one loaded the profile', async () => {
    let stale = manager();
    clock.now = START + 9.5 * MINUTE;
    await manager().authedRealmFetch(`${REALM_URL}_info`);

    let response = await stale.authedRealmFetch(`${REALM_URL}_info`);

    expect(response.status).toBe(200);
    expect(server.refreshRequests).toHaveLength(1);
    expect(server.seen.at(-1)?.authorization).toBe('Bearer access-1');
  });

  it('says the connection has ended when the provider refuses to renew it', async () => {
    let pm = manager();
    // Disconnected on Connected apps: the refresh token no longer works.
    await refreshTokens(
      { resource: ISSUER, tokenEndpoint: TOKEN_ENDPOINT },
      'refresh-unknown',
      { fetchFn: server.tokenFetch },
    ).catch(() => {});
    clock.now = START + 9.5 * MINUTE;

    let attempt = pm.authedRealmFetch(`${REALM_URL}_info`);

    await expect(attempt).rejects.toBeInstanceOf(OAuthConnectionEndedError);
    await expect(attempt).rejects.toThrow(
      `The OAuth connection for ${USER_ID} has ended: it was disconnected, or its 30 days ran out. Run \`boxel profile add --oauth\` to sign in again.`,
    );
  });

  it('says the connection has ended after its 30 days, without asking the provider', async () => {
    let pm = manager();
    clock.now = START + 31 * 24 * 60 * MINUTE;

    await expect(pm.authedRealmFetch(`${REALM_URL}_info`)).rejects.toThrow(
      /ended at 2026-12-24T00:00:00.000Z, 30 days after it was signed in/,
    );
    expect(server.refreshRequests).toHaveLength(0);
  });

  it("uses the access token of a connection that doesn't renew until it runs out", async () => {
    fs.rmSync(path.join(dir, 'profiles.json'));
    manager().addOAuthProfile(
      USER_ID,
      oauthRecord({ refreshToken: undefined }),
      {
        matrixUrl: 'https://matrix.example.test/',
        realmServerUrl: REALM_SERVER_URL,
      },
    );
    clock.now = START + 10 * MINUTE - 45_000;

    let response = await manager().authedRealmFetch(`${REALM_URL}_info`);

    expect(response.status).toBe(200);
    expect(server.seen.map((r) => r.authorization)).toEqual([
      'Bearer access-0',
    ]);
  });

  it("says a connection that doesn't renew ends with its access token", async () => {
    fs.rmSync(path.join(dir, 'profiles.json'));
    manager().addOAuthProfile(
      USER_ID,
      oauthRecord({ refreshToken: undefined }),
      {
        matrixUrl: 'https://matrix.example.test/',
        realmServerUrl: REALM_SERVER_URL,
      },
    );
    clock.now = START + 11 * MINUTE;

    await expect(
      manager().authedRealmFetch(`${REALM_URL}_info`),
    ).rejects.toThrow(/didn't renew, so it ended with its access token/);
  });
});

describe('ProfileManager on an OAuth profile, spending AI credits', () => {
  let dir: string;
  let requests: string[];
  let answer: (url: string) => Response;

  function manager() {
    return new ProfileManager(dir, { now: () => START });
  }

  function signIn(scope: string | undefined) {
    manager().addOAuthProfile(
      USER_ID,
      oauthRecord(scope === undefined ? {} : { scope }),
      {
        matrixUrl: 'https://matrix.example.test/',
        realmServerUrl: REALM_SERVER_URL,
      },
    );
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-oauth-spend-'));
    requests = [];
    answer = () => jsonResponse({ ok: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        let url = String(input instanceof Request ? input.url : input);
        requests.push(url);
        return answer(url);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a route that spends credits before any request, on a connection signed in without it', async () => {
    signIn('boxel:read boxel:write');
    let pm = manager();
    expect(pm.canSpendAiCredits()).toBe(false);
    for (let route of ['_request-forward', '_openrouter/chat/completions']) {
      await expect(
        pm.authedRealmServerFetch(`${REALM_SERVER_URL}${route}`, {
          method: 'POST',
        }),
      ).rejects.toThrow(AiCreditsNotAllowedError);
    }
    expect(requests).toEqual([]);
    await expect(
      pm.authedRealmServerFetch(`${REALM_SERVER_URL}_request-forward`, {
        method: 'POST',
      }),
    ).rejects.toThrow('boxel profile add --oauth --allow-ai-credits');
  });

  it('sends a route that spends credits on a connection signed in with it', async () => {
    signIn('boxel:read boxel:write boxel:spend-credit');
    let pm = manager();
    expect(pm.canSpendAiCredits()).toBe(true);
    let response = await pm.authedRealmServerFetch(
      `${REALM_SERVER_URL}_request-forward`,
      { method: 'POST' },
    );
    expect(response.status).toBe(200);
    expect(requests).toEqual([`${REALM_SERVER_URL}_request-forward`]);
  });

  it("answers the realm server's refusal for want of the scope with the same error, when the scopes weren't known", async () => {
    signIn(undefined);
    let pm = manager();
    expect(pm.canSpendAiCredits()).toBeUndefined();
    answer = () =>
      new Response(JSON.stringify({ error: 'insufficient_scope' }), {
        status: 403,
        headers: {
          'WWW-Authenticate':
            'Bearer error="insufficient_scope", scope="boxel:spend-credit"',
        },
      });
    await expect(
      pm.authedRealmServerFetch(`${REALM_SERVER_URL}_request-forward`, {
        method: 'POST',
      }),
    ).rejects.toThrow(AiCreditsNotAllowedError);
    expect(requests).toHaveLength(1);
  });

  it('leaves every other route and refusal alone', async () => {
    signIn('boxel:read boxel:write');
    let pm = manager();
    answer = () =>
      new Response(JSON.stringify({ error: 'insufficient_scope' }), {
        status: 403,
        headers: {
          'WWW-Authenticate':
            'Bearer error="insufficient_scope", scope="boxel:write"',
        },
      });
    let response = await pm.authedRealmServerFetch(
      `${REALM_SERVER_URL}_create-realm`,
      { method: 'POST' },
    );
    expect(response.status).toBe(403);
  });
});
