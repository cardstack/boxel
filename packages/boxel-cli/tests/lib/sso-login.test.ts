import { describe, it, expect } from 'vitest';

import {
  SsoTimeoutError,
  browserLogin,
  buildCliAuthUrl,
  redeemLoginToken,
  startLoopbackCallback,
} from '../../src/lib/sso-login.ts';

const MATRIX_URL = 'https://matrix.example.com';
const HOST_URL = 'https://host.example.com/';
const USER_ID = '@example-user:example.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

describe('buildCliAuthUrl', () => {
  it('names the listener by port rather than by URL', () => {
    const url = new URL(
      buildCliAuthUrl(HOST_URL, { port: 1234, state: 'abc123def456' }),
    );
    expect(url.origin).toBe('https://host.example.com');
    expect(url.pathname).toBe('/cli-auth');
    expect(url.searchParams.get('port')).toBe('1234');
    expect(url.searchParams.get('state')).toBe('abc123def456');
  });

  // A URL in a query argument reads as SSRF to the WAF in front of deployed
  // realm servers, which answers 403 before the app ever sees the request.
  it('puts no URL in the query string', () => {
    const href = buildCliAuthUrl(HOST_URL, {
      port: 1234,
      state: 'abc123def456',
    });
    expect(new URL(href).search).not.toMatch(/http/i);
  });

  it('tolerates a host URL without a trailing slash', () => {
    const url = new URL(
      buildCliAuthUrl('https://host.example.com', {
        port: 1,
        state: 'abc123def456',
      }),
    );
    expect(url.pathname).toBe('/cli-auth');
  });
});

describe('startLoopbackCallback', () => {
  it('binds loopback and resolves a login token the browser delivers', async () => {
    const callback = await startLoopbackCallback();
    const redirect = new URL(callback.redirectUrl);

    expect(redirect.hostname).toBe('127.0.0.1');
    expect(redirect.searchParams.get('state')).toBeTruthy();

    const pending = callback.waitForResult();
    redirect.searchParams.set('loginToken', 'syt_token');
    const response = await fetch(redirect.href);

    expect(response.status).toBe(200);
    await expect(pending).resolves.toEqual({
      kind: 'loginToken',
      loginToken: 'syt_token',
    });
  });

  it('accepts a session POSTed by the authorization page', async () => {
    const callback = await startLoopbackCallback();
    const state = new URL(callback.redirectUrl).searchParams.get('state')!;
    const pending = callback.waitForResult();

    const response = await fetch(callback.redirectUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        state,
        access_token: 'access',
        device_id: 'DEVICE',
        user_id: USER_ID,
      }),
    });

    expect(response.status).toBe(200);
    await expect(pending).resolves.toEqual({
      kind: 'session',
      session: {
        accessToken: 'access',
        deviceId: 'DEVICE',
        userId: USER_ID,
      },
    });
  });

  it('rejects a POSTed session whose state does not match', async () => {
    const callback = await startLoopbackCallback({ state: 'expected-state' });
    const settled = expect(callback.waitForResult()).rejects.toThrow(/state/i);

    const response = await fetch(callback.redirectUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        state: 'wrong-state',
        access_token: 'access',
        device_id: 'DEVICE',
        user_id: USER_ID,
      }),
    });

    expect(response.status).toBe(400);
    await settled;
  });

  it('rejects a POSTed session that is missing fields', async () => {
    const callback = await startLoopbackCallback();
    const state = new URL(callback.redirectUrl).searchParams.get('state')!;
    const settled = expect(callback.waitForResult()).rejects.toThrow(
      /access_token, device_id, or user_id/,
    );

    const response = await fetch(callback.redirectUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ state, access_token: 'access' }),
    });

    expect(response.status).toBe(400);
    await settled;
  });

  it('rejects a redirect whose state does not match', async () => {
    const callback = await startLoopbackCallback({ state: 'expected-state' });
    const settled = expect(callback.waitForResult()).rejects.toThrow(/state/i);

    const forged = new URL(callback.redirectUrl);
    forged.searchParams.set('state', 'wrong-state');
    forged.searchParams.set('loginToken', 'syt_token');
    const response = await fetch(forged.href);

    expect(response.status).toBe(400);
    await settled;
  });

  it('rejects when the homeserver comes back without a token', async () => {
    const callback = await startLoopbackCallback();
    const settled = expect(callback.waitForResult()).rejects.toThrow(
      /access_denied/,
    );

    const failed = new URL(callback.redirectUrl);
    failed.searchParams.set('error', 'access_denied');
    const response = await fetch(failed.href);

    expect(response.status).toBe(400);
    await settled;
  });

  it('times out when the user never finishes, and names the escape hatch', async () => {
    const callback = await startLoopbackCallback({ timeoutMs: 20 });
    await expect(callback.waitForResult()).rejects.toThrow(/--no-browser/);
  });

  it('stops listening once the flow settles', async () => {
    const callback = await startLoopbackCallback({ timeoutMs: 20 });
    const { redirectUrl } = callback;
    await expect(callback.waitForResult()).rejects.toBeInstanceOf(
      SsoTimeoutError,
    );
    await expect(fetch(redirectUrl)).rejects.toThrow();
  });
});

describe('redeemLoginToken', () => {
  it('maps a Matrix session onto MatrixAuth', async () => {
    const auth = await redeemLoginToken(MATRIX_URL, 'syt_token', (async (
      _url: string,
      init?: RequestInit,
    ) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        type: 'm.login.token',
        token: 'syt_token',
      });
      return jsonResponse({
        access_token: 'access',
        device_id: 'DEVICE',
        user_id: USER_ID,
      });
    }) as unknown as typeof fetch);

    expect(auth).toEqual({
      accessToken: 'access',
      deviceId: 'DEVICE',
      userId: USER_ID,
      matrixUrl: MATRIX_URL,
    });
  });

  it('surfaces a rejected token', async () => {
    await expect(
      redeemLoginToken(MATRIX_URL, 'stale', (async () =>
        jsonResponse(
          { errcode: 'M_FORBIDDEN' },
          403,
        )) as unknown as typeof fetch),
    ).rejects.toThrow(/403/);
  });
});

describe('browserLogin', () => {
  // Stands in for the homeserver: redeems a login token, and answers the
  // whoami check the password branch runs against a POSTed session.
  function homeserver(overrides?: { whoamiStatus?: number; whoami?: string }) {
    return (async (url: string | URL, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.href;
      if (href.endsWith('/_matrix/client/v3/account/whoami')) {
        return jsonResponse(
          { user_id: overrides?.whoami ?? USER_ID },
          overrides?.whoamiStatus ?? 200,
        );
      }
      if (
        href.endsWith('/_matrix/client/v3/login') &&
        init?.method === 'POST'
      ) {
        return jsonResponse({
          access_token: 'redeemed',
          device_id: 'DEVICE',
          user_id: USER_ID,
        });
      }
      throw new Error(`unexpected request to ${href}`);
    }) as unknown as typeof fetch;
  }

  // Pulls the loopback target back out of the authorization URL and finishes
  // the flow the way the page would.
  // Rebuilds the callback address from the port and nonce the way the
  // authorization page does.
  function loopbackFrom(authUrl: string): URL {
    const params = new URL(authUrl).searchParams;
    const target = new URL(`http://127.0.0.1:${params.get('port')}/callback`);
    target.searchParams.set('state', params.get('state')!);
    return target;
  }

  it('redeems the single-use token the SSO branch returns', async () => {
    const auth = await browserLogin({
      matrixUrl: MATRIX_URL,
      hostUrl: HOST_URL,
      fetchFn: homeserver(),
      log: () => {},
      openBrowserFn: async (authUrl) => {
        const target = loopbackFrom(authUrl);
        target.searchParams.set('loginToken', 'syt_from_sso');
        await fetch(target.href);
        return true;
      },
    });

    expect(auth).toEqual({
      accessToken: 'redeemed',
      deviceId: 'DEVICE',
      userId: USER_ID,
      matrixUrl: MATRIX_URL,
    });
  });

  it('takes the session the password branch POSTs, once whoami agrees', async () => {
    const auth = await browserLogin({
      matrixUrl: MATRIX_URL,
      hostUrl: HOST_URL,
      fetchFn: homeserver(),
      log: () => {},
      openBrowserFn: async (authUrl) => {
        const target = loopbackFrom(authUrl);
        await fetch(target.href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formBody({
            state: target.searchParams.get('state')!,
            access_token: 'from-password',
            device_id: 'DEVICE',
            user_id: USER_ID,
          }),
        });
        return true;
      },
    });

    expect(auth).toEqual({
      accessToken: 'from-password',
      deviceId: 'DEVICE',
      userId: USER_ID,
      matrixUrl: MATRIX_URL,
    });
  });

  it('refuses a session the homeserver does not recognize', async () => {
    await expect(
      browserLogin({
        matrixUrl: MATRIX_URL,
        hostUrl: HOST_URL,
        fetchFn: homeserver({ whoamiStatus: 401 }),
        log: () => {},
        openBrowserFn: async (authUrl) => {
          const target = loopbackFrom(authUrl);
          await fetch(target.href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formBody({
              state: target.searchParams.get('state')!,
              access_token: 'stale',
              device_id: 'DEVICE',
              user_id: USER_ID,
            }),
          });
          return true;
        },
      }),
    ).rejects.toThrow(/does not recognize/);
  });

  it('refuses a session whose user disagrees with whoami', async () => {
    await expect(
      browserLogin({
        matrixUrl: MATRIX_URL,
        hostUrl: HOST_URL,
        fetchFn: homeserver({ whoami: '@someone-else:example.com' }),
        log: () => {},
        openBrowserFn: async (authUrl) => {
          const target = loopbackFrom(authUrl);
          await fetch(target.href, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formBody({
              state: target.searchParams.get('state')!,
              access_token: 'mismatched',
              device_id: 'DEVICE',
              user_id: USER_ID,
            }),
          });
          return true;
        },
      }),
    ).rejects.toThrow(/someone-else/);
  });

  it('prints a URL when no browser could be launched', async () => {
    const logged: string[] = [];
    await browserLogin({
      matrixUrl: MATRIX_URL,
      hostUrl: HOST_URL,
      fetchFn: homeserver(),
      log: (message) => logged.push(message),
      openBrowserFn: async (authUrl) => {
        const target = loopbackFrom(authUrl);
        target.searchParams.set('loginToken', 'syt_from_sso');
        await fetch(target.href);
        return false;
      },
    });

    expect(logged.join('\n')).toMatch(/Open this URL in your browser/);
    expect(logged.join('\n')).toContain('/cli-auth');
  });
});
