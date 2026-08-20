import { describe, it, expect, afterEach, vi } from 'vitest';

import { ensurePersonalRealm } from '../../src/lib/personal-realm.ts';
import type { MatrixAuth } from '../../src/lib/auth.ts';

const MATRIX_URL = 'https://matrix.example.com';
const REALM_SERVER_URL = 'https://realms.example.com/';
const USER_ID = '@newuser:example.com';

const AUTH: MatrixAuth = {
  accessToken: 'matrix-token',
  deviceId: 'DEVICE',
  userId: USER_ID,
  matrixUrl: MATRIX_URL,
};

const ACCOUNT_DATA_PATH = `/_matrix/client/v3/user/${encodeURIComponent(
  USER_ID,
)}/account_data/app.boxel.realms`;
const DISPLAYNAME_PATH = `/_matrix/client/v3/profile/${encodeURIComponent(
  USER_ID,
)}/displayname`;
const OPENID_PATH = `/_matrix/client/v3/user/${encodeURIComponent(
  USER_ID,
)}/openid/request_token`;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

interface StubOptions {
  // What the initial realm-list read returns; a 404 is "never set".
  realmsResponse?: Response;
  // What GET .../displayname returns.
  displaynameResponse?: Response;
  // What POST /_create-realm returns.
  createRealmResponse?: Response;
}

// Routes every request ensurePersonalRealm can make, recording each so tests
// can assert on what was (and wasn't) called and with which bodies.
function stubFetchRoutes(options: StubOptions = {}) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const fetchStub = vi.fn(async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init?.method ?? 'GET';
    const call = { method, url: url.href, body: init?.body as string };
    calls.push(call);

    if (method === 'GET' && url.pathname === ACCOUNT_DATA_PATH) {
      return (
        options.realmsResponse ??
        jsonResponse({ errcode: 'M_NOT_FOUND' }, { status: 404 })
      );
    }
    if (method === 'PUT' && url.pathname === ACCOUNT_DATA_PATH) {
      return jsonResponse({});
    }
    if (method === 'GET' && url.pathname === DISPLAYNAME_PATH) {
      return (
        options.displaynameResponse ?? jsonResponse({ displayname: 'New User' })
      );
    }
    if (method === 'POST' && url.pathname === OPENID_PATH) {
      return jsonResponse({ access_token: 'openid-token' });
    }
    if (method === 'POST' && url.pathname === '/_server-session') {
      return jsonResponse(
        {},
        { headers: { Authorization: 'Bearer server-jwt' } },
      );
    }
    if (method === 'POST' && url.pathname === '/_create-realm') {
      return (
        options.createRealmResponse ??
        jsonResponse(
          { data: { id: 'https://realms.example.com/newuser/personal' } },
          { status: 202 },
        )
      );
    }
    throw new Error(`unexpected fetch: ${method} ${url.href}`);
  });
  vi.stubGlobal('fetch', fetchStub);
  return { calls };
}

function callsTo(
  calls: { method: string; url: string; body?: string }[],
  method: string,
  pathname: string,
) {
  return calls.filter(
    (c) => c.method === method && new URL(c.url).pathname === pathname,
  );
}

describe('ensurePersonalRealm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves an account that already has realms alone', async () => {
    const { calls } = stubFetchRoutes({
      realmsResponse: jsonResponse({
        realms: ['https://realms.example.com/newuser/existing/'],
      }),
    });

    const result = await ensurePersonalRealm(AUTH, REALM_SERVER_URL);

    expect(result).toEqual({ outcome: 'has-realms' });
    // Nothing but the realm-list read: no realm-server traffic at all.
    expect(calls).toHaveLength(1);
  });

  it('creates a personal realm named after the Matrix display name and records it in the realm list', async () => {
    const { calls } = stubFetchRoutes();

    const result = await ensurePersonalRealm(AUTH, REALM_SERVER_URL);

    expect(result).toEqual({
      outcome: 'created',
      realmUrl: 'https://realms.example.com/newuser/personal/',
    });

    const [create] = callsTo(calls, 'POST', '/_create-realm');
    const attributes = JSON.parse(create.body!).data.attributes;
    expect(attributes.endpoint).toBe('personal');
    expect(attributes.name).toBe("New User's Workspace");
    expect(attributes.iconURL).toBeTruthy();
    expect(attributes.backgroundURL).toBeTruthy();

    const [put] = callsTo(calls, 'PUT', ACCOUNT_DATA_PATH);
    expect(JSON.parse(put.body!)).toEqual({
      realms: ['https://realms.example.com/newuser/personal/'],
    });
  });

  it('falls back to the Matrix ID localpart when the account has no display name', async () => {
    const { calls } = stubFetchRoutes({
      displaynameResponse: jsonResponse(
        { errcode: 'M_NOT_FOUND' },
        { status: 404 },
      ),
    });

    await ensurePersonalRealm(AUTH, REALM_SERVER_URL);

    const [create] = callsTo(calls, 'POST', '/_create-realm');
    expect(JSON.parse(create.body!).data.attributes.name).toBe(
      "newuser's Workspace",
    );
  });

  it('re-links a personal realm that exists on the server but is missing from the realm list', async () => {
    const { calls } = stubFetchRoutes({
      createRealmResponse: new Response(
        `realm 'https://realms.example.com/newuser/personal/' already exists on this server`,
        { status: 400 },
      ),
    });

    const result = await ensurePersonalRealm(AUTH, REALM_SERVER_URL);

    expect(result).toEqual({
      outcome: 'linked',
      realmUrl: 'https://realms.example.com/newuser/personal/',
    });
    const [put] = callsTo(calls, 'PUT', ACCOUNT_DATA_PATH);
    expect(JSON.parse(put.body!)).toEqual({
      realms: ['https://realms.example.com/newuser/personal/'],
    });
  });

  it('throws on any other realm-server failure without touching the realm list', async () => {
    const { calls } = stubFetchRoutes({
      createRealmResponse: new Response('boom', { status: 500 }),
    });

    await expect(ensurePersonalRealm(AUTH, REALM_SERVER_URL)).rejects.toThrow(
      /returned 500/,
    );
    expect(callsTo(calls, 'PUT', ACCOUNT_DATA_PATH)).toHaveLength(0);
  });
});
