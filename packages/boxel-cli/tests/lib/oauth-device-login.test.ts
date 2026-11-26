import { describe, it, expect, vi } from 'vitest';

import {
  BOXEL_CLI_CLIENT_ID,
  DEVICE_CODE_GRANT_TYPE,
  OAuthNotOfferedError,
  oauthDeviceLogin,
  oauthLogin,
} from '../../src/lib/oauth-login.ts';

const REALM_SERVER_URL = 'https://realms.example.test/';
const ISSUER = 'https://realms.example.test';
const USER_ID = '@example-user:example.test';
const DEVICE_PAGE = 'https://secure.example.test/device';
const DEVICE_ENDPOINT = `${ISSUER}/_oauth-provider/device/auth`;
const TOKEN_ENDPOINT = `${ISSUER}/_oauth-provider/token`;
const REVOCATION_ENDPOINT = `${ISSUER}/_oauth-provider/token/revocation`;
const START = Date.parse('2026-11-26T00:00:00Z');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ISSUED = {
  access_token: 'access-token-placeholder',
  refresh_token: 'refresh-token-placeholder',
  token_type: 'Bearer',
  expires_in: 600,
  scope: 'boxel:read boxel:write',
};

// A realm server whose provider offers device sign-in. Each poll of the token
// endpoint takes the next of `polls`: an OAuth error code, or `issued`.
function realmServer({
  polls = ['issued'],
  device = true,
  userStatus,
}: {
  polls?: string[];
  device?: boolean;
  userStatus?: number;
} = {}) {
  let requests: { url: string; body?: string }[] = [];
  let remaining = [...polls];
  let fetchFn = (async (input: string | URL, init?: RequestInit) => {
    let url = typeof input === 'string' ? input : input.href;
    requests.push({
      url,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (url === `${ISSUER}/.well-known/oauth-protected-resource`) {
      return jsonResponse({
        resource: ISSUER,
        authorization_servers: [ISSUER],
        scopes_supported: ['boxel:read', 'boxel:write'],
      });
    }
    if (url === `${ISSUER}/.well-known/oauth-authorization-server`) {
      return jsonResponse({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/_oauth-provider/auth`,
        token_endpoint: TOKEN_ENDPOINT,
        revocation_endpoint: REVOCATION_ENDPOINT,
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
        ...(device ? { device_authorization_endpoint: DEVICE_ENDPOINT } : {}),
      });
    }
    if (url === DEVICE_ENDPOINT) {
      return jsonResponse({
        device_code: 'device-code-placeholder',
        user_code: 'WDJB-MJHT',
        verification_uri: DEVICE_PAGE,
        expires_in: 600,
        interval: 5,
      });
    }
    if (url === TOKEN_ENDPOINT) {
      let next = remaining.shift() ?? 'authorization_pending';
      return next === 'issued'
        ? jsonResponse(ISSUED)
        : jsonResponse({ error: next }, 400);
    }
    if (url === REVOCATION_ENDPOINT) {
      return new Response(null, { status: 200 });
    }
    if (url === `${ISSUER}/_user-display-name`) {
      if (userStatus) {
        return new Response('{}', { status: userStatus });
      }
      return jsonResponse({
        data: { id: USER_ID, attributes: { displayName: 'Example User' } },
      });
    }
    throw new Error(`unexpected request to ${url}`);
  }) as unknown as typeof fetch;
  return { fetchFn, requests };
}

// A clock that moves only when the sign-in waits.
function clock() {
  let now = START;
  let waits: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      waits.push(ms);
      now += ms;
    },
    waits,
  };
}

function signIn(
  server: ReturnType<typeof realmServer>,
  time = clock(),
  log: (message: string) => void = () => {},
) {
  return oauthDeviceLogin({
    realmServerUrl: REALM_SERVER_URL,
    fetchFn: server.fetchFn,
    log,
    now: time.now,
    sleep: time.sleep,
  });
}

describe('oauthDeviceLogin', () => {
  it('asks for a device code for the Boxel API, as boxel-cli', async () => {
    let server = realmServer();
    await signIn(server);
    let asked = server.requests.find(({ url }) => url === DEVICE_ENDPOINT);
    expect(Object.fromEntries(new URLSearchParams(asked!.body))).toEqual({
      client_id: BOXEL_CLI_CLIENT_ID,
      scope: 'boxel:read boxel:write',
      resource: ISSUER,
    });
  });

  it('shows the page and the code, and nothing with the code in its address', async () => {
    let server = realmServer();
    let lines: string[] = [];
    await signIn(server, clock(), (line) => lines.push(line));
    let shown = lines.join('\n');
    expect(shown).toContain(DEVICE_PAGE);
    expect(shown).toContain('WDJB-MJHT');
    expect(shown).toContain('Only enter it on that page.');
    expect(shown).not.toMatch(/user_code=/);
  });

  it('polls until the sign-in is allowed, then answers the tokens and the user', async () => {
    let server = realmServer({
      polls: ['authorization_pending', 'authorization_pending', 'issued'],
    });
    let time = clock();
    let result = await signIn(server, time);
    expect(time.waits).toEqual([5000, 5000, 5000]);
    let polls = server.requests.filter(({ url }) => url === TOKEN_ENDPOINT);
    expect(polls).toHaveLength(3);
    expect(Object.fromEntries(new URLSearchParams(polls[0]!.body))).toEqual({
      client_id: BOXEL_CLI_CLIENT_ID,
      resource: ISSUER,
      grant_type: DEVICE_CODE_GRANT_TYPE,
      device_code: 'device-code-placeholder',
    });
    expect(result.user).toEqual({
      userId: USER_ID,
      displayName: 'Example User',
    });
    expect(result.tokens.accessToken).toBe('access-token-placeholder');
    expect(result.tokens.refreshToken).toBe('refresh-token-placeholder');
    expect(result.tokens.connectionEndsAt).toBe(
      new Date(START + 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('waits five seconds longer each time it is told to slow down', async () => {
    let server = realmServer({
      polls: ['slow_down', 'authorization_pending', 'slow_down', 'issued'],
    });
    let time = clock();
    await signIn(server, time);
    expect(time.waits).toEqual([5000, 10000, 10000, 15000]);
  });

  it('stops when the sign-in is denied', async () => {
    await expect(
      signIn(realmServer({ polls: ['access_denied'] })),
    ).rejects.toThrow('The sign-in was denied.');
  });

  it('stops when the code expires', async () => {
    await expect(
      signIn(realmServer({ polls: ['expired_token'] })),
    ).rejects.toThrow(/The code expired/);
  });

  it('stops at the code’s expiry if the provider never answers', async () => {
    let server = realmServer({ polls: [] });
    let time = clock();
    await expect(signIn(server, time)).rejects.toThrow(/The code expired/);
    expect(time.now() - START).toBeGreaterThanOrEqual(600_000);
  });

  it('ends a connection whose user it can’t read', async () => {
    let server = realmServer({ userStatus: 500 });
    await expect(signIn(server)).rejects.toThrow(
      /Could not read who signed in/,
    );
    expect(server.requests.map(({ url }) => url)).toContain(
      REVOCATION_ENDPOINT,
    );
  });

  it('refuses a server that offers no device sign-in', async () => {
    await expect(signIn(realmServer({ device: false }))).rejects.toBeInstanceOf(
      OAuthNotOfferedError,
    );
  });
});

describe('oauthLogin with the device fallback', () => {
  it('signs in with a code when no browser opens here', async () => {
    let server = realmServer();
    let time = clock();
    let lines: string[] = [];
    let openBrowserFn = vi.fn(async () => false);
    let result = await oauthLogin({
      realmServerUrl: REALM_SERVER_URL,
      fetchFn: server.fetchFn,
      openBrowserFn,
      log: (line) => lines.push(line),
      now: time.now,
      sleep: time.sleep,
      deviceFallback: true,
      timeoutMs: 5_000,
    });
    expect(openBrowserFn).toHaveBeenCalledOnce();
    expect(lines.join('\n')).toContain("Couldn't open a browser here");
    expect(lines.join('\n')).toContain('WDJB-MJHT');
    expect(result.user.userId).toBe(USER_ID);
  });
});
