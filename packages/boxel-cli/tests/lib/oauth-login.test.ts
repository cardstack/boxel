import { createHash } from 'node:crypto';

import { describe, it, expect, vi } from 'vitest';

import {
  BOXEL_CLI_CLIENT_ID,
  CONFIRMATION_CODE_PARAM,
  OAuthNotOfferedError,
  buildAuthorizeUrl,
  discoverBoxelApi,
  exchangeCode,
  makeConfirmationCode,
  makePkce,
  oauthLogin,
  type BoxelApiProvider,
} from '../../src/lib/oauth-login.ts';

const REALM_SERVER_URL = 'https://realms.example.test/';
const ISSUER = 'https://realms.example.test';
const USER_ID = '@example-user:example.test';
const CONFIRMATION_CODE_RE =
  /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const PROVIDER: BoxelApiProvider = {
  resource: ISSUER,
  issuer: ISSUER,
  authorizationEndpoint: `${ISSUER}/_oauth-provider/auth`,
  tokenEndpoint: `${ISSUER}/_oauth-provider/token`,
  revocationEndpoint: `${ISSUER}/_oauth-provider/token/revocation`,
};

interface ServerOptions {
  resourceMetadataStatus?: number;
  resource?: string;
  scopes?: string[];
  metadataIssuer?: string;
  tokenBody?: Record<string, unknown>;
  tokenStatus?: number;
  userStatus?: number;
}

interface Recorded {
  url: string;
  method: string;
  body?: string;
  authorization?: string | null;
}

// Stands in for a realm server whose OAuth provider offers the Boxel API:
// its two discovery documents, its token and revocation endpoints, and the
// route that says who a token belongs to.
function realmServer(options: ServerOptions = {}) {
  let requests: Recorded[] = [];
  let fetchFn = (async (input: string | URL, init?: RequestInit) => {
    let url = typeof input === 'string' ? input : input.href;
    let headers = new Headers(init?.headers);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      authorization: headers.get('Authorization'),
    });
    if (url === `${ISSUER}/.well-known/oauth-protected-resource`) {
      if (options.resourceMetadataStatus) {
        return new Response('not found', {
          status: options.resourceMetadataStatus,
        });
      }
      return jsonResponse({
        resource: options.resource ?? ISSUER,
        resource_name: 'Boxel API',
        authorization_servers: [ISSUER],
        scopes_supported: options.scopes ?? ['boxel:read', 'boxel:write'],
        bearer_methods_supported: ['header'],
      });
    }
    if (url === `${ISSUER}/.well-known/oauth-authorization-server`) {
      return jsonResponse({
        issuer: options.metadataIssuer ?? ISSUER,
        authorization_endpoint: PROVIDER.authorizationEndpoint,
        token_endpoint: PROVIDER.tokenEndpoint,
        revocation_endpoint: PROVIDER.revocationEndpoint,
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (url === PROVIDER.tokenEndpoint) {
      return jsonResponse(
        options.tokenBody ?? {
          access_token: 'access-token-placeholder',
          refresh_token: 'refresh-token-placeholder',
          token_type: 'Bearer',
          expires_in: 600,
          scope: 'boxel:read boxel:write',
        },
        options.tokenStatus ?? 200,
      );
    }
    if (url === PROVIDER.revocationEndpoint) {
      return new Response(null, { status: 200 });
    }
    if (url === `${ISSUER}/_user-display-name`) {
      if (options.userStatus) {
        return new Response('{}', { status: options.userStatus });
      }
      return jsonResponse({
        data: {
          type: 'user-display-name',
          id: USER_ID,
          attributes: { displayName: 'Example User' },
        },
      });
    }
    throw new Error(`unexpected request to ${url}`);
  }) as unknown as typeof fetch;
  return { fetchFn, requests };
}

// Plays the browser: reads the authorization request and lands on its
// redirect URI the way the provider sends it back.
function browser(land: (authorize: URL) => Record<string, string | undefined>) {
  let seen: { authorize?: URL; page?: Promise<Response> } = {};
  let openBrowserFn = vi.fn(async (url: string) => {
    let authorize = new URL(url);
    seen.authorize = authorize;
    let target = new URL(authorize.searchParams.get('redirect_uri')!);
    for (let [key, value] of Object.entries(land(authorize))) {
      if (value !== undefined) {
        target.searchParams.set(key, value);
      }
    }
    seen.page = fetch(target.href);
    return true;
  });
  return { openBrowserFn, seen };
}

const allows = (authorize: URL) => ({
  code: 'code-placeholder',
  state: authorize.searchParams.get('state')!,
  iss: ISSUER,
});

function login(
  server: ReturnType<typeof realmServer>,
  openBrowserFn: (url: string) => Promise<boolean>,
  log: (message: string) => void = () => {},
) {
  return oauthLogin({
    realmServerUrl: REALM_SERVER_URL,
    fetchFn: server.fetchFn,
    openBrowserFn,
    log,
    makeConfirmationCodeFn: () => 'WDJB-MJHT',
    now: () => Date.parse('2026-11-24T00:00:00Z'),
    timeoutMs: 5_000,
  });
}

describe('makeConfirmationCode', () => {
  it('is two groups of four from the consonant alphabet', () => {
    for (let i = 0; i < 50; i++) {
      expect(makeConfirmationCode()).toMatch(CONFIRMATION_CODE_RE);
    }
  });

  it('draws each letter from the alphabet the provider accepts', () => {
    let picks = [0, 19, 1, 18, 2, 17, 3, 16];
    expect(makeConfirmationCode(() => picks.shift()!)).toBe('BZCX-DWFV');
  });
});

describe('makePkce', () => {
  it('answers an S256 challenge of a fresh verifier', () => {
    let { verifier, challenge } = makePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
    expect(makePkce().verifier).not.toBe(verifier);
  });
});

describe('discoverBoxelApi', () => {
  it("reads the Boxel API's provider from the realm server's discovery", async () => {
    let { fetchFn } = realmServer();
    expect(await discoverBoxelApi(REALM_SERVER_URL, fetchFn)).toEqual(PROVIDER);
  });

  it("refuses a realm server whose provider is off, saying it doesn't offer OAuth sign-in", async () => {
    let { fetchFn } = realmServer({ resourceMetadataStatus: 404 });
    let error = await discoverBoxelApi(REALM_SERVER_URL, fetchFn).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(OAuthNotOfferedError);
    expect(error.message).toContain("doesn't offer OAuth sign-in");
    expect(error.message).toContain('without --oauth');
  });

  it('refuses metadata for another resource', async () => {
    let { fetchFn } = realmServer({ resource: `${ISSUER}/mcp` });
    await expect(
      discoverBoxelApi(REALM_SERVER_URL, fetchFn),
    ).rejects.toBeInstanceOf(OAuthNotOfferedError);
  });

  it("refuses a resource that doesn't offer the Boxel API's scopes", async () => {
    let { fetchFn } = realmServer({ scopes: ['boxel:read'] });
    await expect(
      discoverBoxelApi(REALM_SERVER_URL, fetchFn),
    ).rejects.toBeInstanceOf(OAuthNotOfferedError);
  });

  it('refuses an authorization server whose metadata names another issuer', async () => {
    let { fetchFn } = realmServer({
      metadataIssuer: 'https://elsewhere.example.test',
    });
    await expect(discoverBoxelApi(REALM_SERVER_URL, fetchFn)).rejects.toThrow(
      /names https:\/\/elsewhere\.example\.test as its issuer/,
    );
  });
});

describe('buildAuthorizeUrl', () => {
  it('asks for the Boxel API as boxel-cli, with PKCE and the confirmation code', () => {
    let url = new URL(
      buildAuthorizeUrl(PROVIDER, {
        redirectUri: 'http://127.0.0.1:5123/callback',
        state: 'state-placeholder',
        codeChallenge: 'challenge-placeholder',
        confirmationCode: 'WDJB-MJHT',
      }),
    );
    expect(url.origin + url.pathname).toBe(PROVIDER.authorizationEndpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: BOXEL_CLI_CLIENT_ID,
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:5123/callback',
      scope: 'boxel:read boxel:write',
      resource: ISSUER,
      state: 'state-placeholder',
      code_challenge: 'challenge-placeholder',
      code_challenge_method: 'S256',
      [CONFIRMATION_CODE_PARAM]: 'WDJB-MJHT',
    });
  });
});

describe('exchangeCode', () => {
  it("counts the access token's lifetime from before the request", async () => {
    let clock = Date.parse('2026-11-24T00:00:00Z');
    let fetchFn = (async () => {
      // A slow response: the token was issued before the clock moved on.
      clock += 90_000;
      return jsonResponse({
        access_token: 'access-token-placeholder',
        expires_in: 600,
      });
    }) as typeof fetch;

    let tokens = await exchangeCode(
      PROVIDER,
      {
        code: 'code-placeholder',
        codeVerifier: 'verifier-placeholder',
        redirectUri: 'http://127.0.0.1:1234/callback',
      },
      { fetchFn, startedAt: clock, now: () => clock },
    );

    expect(tokens.accessExpiresAt).toBe('2026-11-24T00:10:00.000Z');
  });
});

describe('oauthLogin', () => {
  it('signs in through the browser and answers the tokens and who they belong to', async () => {
    let server = realmServer();
    let { openBrowserFn, seen } = browser(allows);
    let lines: string[] = [];

    let result = await login(server, openBrowserFn, (m) => lines.push(m));

    expect(result.user).toEqual({
      userId: USER_ID,
      displayName: 'Example User',
    });
    expect(result.tokens).toEqual({
      accessToken: 'access-token-placeholder',
      refreshToken: 'refresh-token-placeholder',
      accessExpiresAt: '2026-11-24T00:10:00.000Z',
      connectionEndsAt: '2026-12-24T00:00:00.000Z',
      scope: 'boxel:read boxel:write',
    });
    expect((await seen.page)!.status).toBe(200);

    // The terminal shows the same code the authorization request sends.
    let authorize = seen.authorize!;
    expect(authorize.searchParams.get(CONFIRMATION_CODE_PARAM)).toBe(
      'WDJB-MJHT',
    );
    expect(lines.join('\n')).toContain('WDJB-MJHT');
    expect(authorize.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );

    // The code is exchanged with the verifier behind the challenge, for the
    // same redirect URI and resource.
    let exchange = server.requests.find(
      (r) => r.url === PROVIDER.tokenEndpoint,
    )!;
    let form = new URLSearchParams(exchange.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_id')).toBe(BOXEL_CLI_CLIENT_ID);
    expect(form.get('code')).toBe('code-placeholder');
    expect(form.get('resource')).toBe(ISSUER);
    expect(form.get('redirect_uri')).toBe(
      authorize.searchParams.get('redirect_uri'),
    );
    expect(
      createHash('sha256')
        .update(form.get('code_verifier')!)
        .digest('base64url'),
    ).toBe(authorize.searchParams.get('code_challenge'));

    let whoami = server.requests.find((r) =>
      r.url.endsWith('/_user-display-name'),
    )!;
    expect(whoami.authorization).toBe('Bearer access-token-placeholder');
  });

  it("ends a connection that doesn't renew with its access token", async () => {
    let server = realmServer({
      tokenBody: {
        access_token: 'access-token-placeholder',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    });
    let { openBrowserFn } = browser(allows);

    let { tokens } = await login(server, openBrowserFn);

    expect(tokens.refreshToken).toBeUndefined();
    expect(tokens.connectionEndsAt).toBe('2026-11-24T01:00:00.000Z');
    expect(tokens.connectionEndsAt).toBe(tokens.accessExpiresAt);
  });

  it('stops when the user chooses Deny', async () => {
    let server = realmServer();
    let { openBrowserFn } = browser((authorize) => ({
      error: 'access_denied',
      state: authorize.searchParams.get('state')!,
      iss: ISSUER,
    }));

    await expect(login(server, openBrowserFn)).rejects.toThrow(
      'You chose Deny in the browser, so no profile was saved.',
    );
    expect(server.requests.map((r) => r.url)).not.toContain(
      PROVIDER.tokenEndpoint,
    );
  });

  it('fails the sign-in when the response carries another state', async () => {
    let server = realmServer();
    let { openBrowserFn } = browser(() => ({
      code: 'code-placeholder',
      state: 'another-state',
      iss: ISSUER,
    }));

    await expect(login(server, openBrowserFn)).rejects.toThrow(
      /expected state/,
    );
    expect(server.requests.map((r) => r.url)).not.toContain(
      PROVIDER.tokenEndpoint,
    );
  });

  it('never sends a code from another issuer to the token endpoint', async () => {
    let server = realmServer();
    let { openBrowserFn } = browser((authorize) => ({
      ...allows(authorize),
      iss: 'https://elsewhere.example.test',
    }));

    await expect(login(server, openBrowserFn)).rejects.toThrow(
      /came back from https:\/\/elsewhere\.example\.test/,
    );
    expect(server.requests.map((r) => r.url)).not.toContain(
      PROVIDER.tokenEndpoint,
    );
  });

  it('names what the token endpoint refused', async () => {
    let server = realmServer({
      tokenStatus: 400,
      tokenBody: { error: 'invalid_grant', error_description: 'grant expired' },
    });
    let { openBrowserFn } = browser(allows);

    await expect(login(server, openBrowserFn)).rejects.toThrow(
      "The realm server didn't issue tokens for the sign-in: invalid_grant (grant expired)",
    );
  });

  it("revokes a connection it can't use because the realm server can't say who signed in", async () => {
    let server = realmServer({ userStatus: 404 });
    let { openBrowserFn } = browser(allows);

    await expect(login(server, openBrowserFn)).rejects.toThrow(
      /has no Boxel account for the user who signed in/,
    );
    let revoke = server.requests.find(
      (r) => r.url === PROVIDER.revocationEndpoint,
    )!;
    expect(Object.fromEntries(new URLSearchParams(revoke.body))).toEqual({
      client_id: BOXEL_CLI_CLIENT_ID,
      token: 'refresh-token-placeholder',
      token_type_hint: 'refresh_token',
    });
  });

  it("doesn't open the browser on a realm server that doesn't offer OAuth sign-in", async () => {
    let server = realmServer({ resourceMetadataStatus: 404 });
    let { openBrowserFn } = browser(allows);

    await expect(login(server, openBrowserFn)).rejects.toBeInstanceOf(
      OAuthNotOfferedError,
    );
    expect(openBrowserFn).not.toHaveBeenCalled();
  });
});
