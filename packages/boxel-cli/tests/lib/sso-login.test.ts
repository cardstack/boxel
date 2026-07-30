import { describe, it, expect } from 'vitest';

import {
  GOOGLE_IDP_ID,
  SsoNotSupportedError,
  SsoTimeoutError,
  buildSsoRedirectUrl,
  redeemLoginToken,
  selectSsoIdp,
  ssoLogin,
  startLoopbackCallback,
  supportsTokenLogin,
  type LoginFlow,
} from '../../src/lib/sso-login.ts';

const MATRIX_URL = 'https://matrix.example.com';

// What a Synapse configured like staging/production advertises.
const FULL_FLOWS: LoginFlow[] = [
  {
    type: 'm.login.sso',
    identity_providers: [{ id: GOOGLE_IDP_ID, name: 'Google' }],
  },
  { type: 'm.login.token' },
  { type: 'm.login.password' },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('selectSsoIdp', () => {
  it('prefers the provider the web app uses', () => {
    expect(selectSsoIdp(FULL_FLOWS)).toBe(GOOGLE_IDP_ID);
  });

  it('falls back to the only provider a homeserver offers', () => {
    const flows: LoginFlow[] = [
      { type: 'm.login.sso', identity_providers: [{ id: 'oidc-okta' }] },
    ];
    expect(selectSsoIdp(flows)).toBe('oidc-okta');
  });

  it('returns undefined when the provider list is empty, so the un-suffixed redirect is used', () => {
    expect(selectSsoIdp([{ type: 'm.login.sso' }])).toBeUndefined();
  });

  it('returns undefined when there is no SSO flow at all', () => {
    expect(selectSsoIdp([{ type: 'm.login.password' }])).toBeUndefined();
  });
});

describe('supportsTokenLogin', () => {
  it('is true when the homeserver can redeem a login token', () => {
    expect(supportsTokenLogin(FULL_FLOWS)).toBe(true);
  });

  it('is false without m.login.token', () => {
    expect(supportsTokenLogin([{ type: 'm.login.sso' }])).toBe(false);
  });
});

describe('buildSsoRedirectUrl', () => {
  it('targets the provider-specific redirect endpoint', () => {
    const url = new URL(
      buildSsoRedirectUrl(
        MATRIX_URL,
        'http://127.0.0.1:1234/callback?state=abc',
        GOOGLE_IDP_ID,
      ),
    );
    expect(url.pathname).toBe(
      `/_matrix/client/v3/login/sso/redirect/${GOOGLE_IDP_ID}`,
    );
    expect(url.searchParams.get('redirectUrl')).toBe(
      'http://127.0.0.1:1234/callback?state=abc',
    );
  });

  it('omits the provider segment when none was selected', () => {
    const url = new URL(
      buildSsoRedirectUrl(MATRIX_URL, 'http://127.0.0.1:1234/callback'),
    );
    expect(url.pathname).toBe('/_matrix/client/v3/login/sso/redirect');
  });
});

describe('startLoopbackCallback', () => {
  it('binds loopback and resolves the token the browser delivers', async () => {
    const callback = await startLoopbackCallback();
    const redirect = new URL(callback.redirectUrl);

    expect(redirect.hostname).toBe('127.0.0.1');
    expect(redirect.searchParams.get('state')).toBeTruthy();

    const pending = callback.waitForToken();
    redirect.searchParams.set('loginToken', 'syt_token');
    const response = await fetch(redirect.href);

    expect(response.status).toBe(200);
    await expect(pending).resolves.toBe('syt_token');
  });

  it('rejects a callback whose state does not match', async () => {
    const callback = await startLoopbackCallback({ state: 'expected-state' });
    // Assert on the promise before triggering it, so the rejection always has a
    // handler attached and never surfaces as an unhandled rejection.
    const settled = expect(callback.waitForToken()).rejects.toThrow(/state/i);

    const forged = new URL(callback.redirectUrl);
    forged.searchParams.set('state', 'wrong-state');
    forged.searchParams.set('loginToken', 'syt_token');
    const response = await fetch(forged.href);

    expect(response.status).toBe(400);
    await settled;
  });

  it('rejects when the homeserver comes back without a token', async () => {
    const callback = await startLoopbackCallback();
    const settled = expect(callback.waitForToken()).rejects.toThrow(
      /access_denied/,
    );

    const failed = new URL(callback.redirectUrl);
    failed.searchParams.set('error', 'access_denied');
    const response = await fetch(failed.href);

    expect(response.status).toBe(400);
    await settled;
  });

  it('times out when the user never finishes', async () => {
    const callback = await startLoopbackCallback({ timeoutMs: 20 });
    await expect(callback.waitForToken()).rejects.toBeInstanceOf(
      SsoTimeoutError,
    );
  });

  it('stops listening once the flow settles', async () => {
    const callback = await startLoopbackCallback({ timeoutMs: 20 });
    const { redirectUrl } = callback;
    await expect(callback.waitForToken()).rejects.toBeInstanceOf(
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
        user_id: '@luke:example.com',
      });
    }) as unknown as typeof fetch);

    expect(auth).toEqual({
      accessToken: 'access',
      deviceId: 'DEVICE',
      userId: '@luke:example.com',
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

describe('ssoLogin', () => {
  // Stands in for Synapse: serves login flows, redeems the token, and (via
  // openBrowserFn) performs the redirect back to the loopback listener the way
  // a real browser would.
  function fakeHomeserver(flows: LoginFlow[] = FULL_FLOWS) {
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.href;
      if (href.endsWith('/_matrix/client/v3/login') && !init) {
        return jsonResponse({ flows });
      }
      if (href.endsWith('/_matrix/client/v3/login')) {
        return jsonResponse({
          access_token: 'access',
          device_id: 'DEVICE',
          user_id: '@luke:example.com',
        });
      }
      throw new Error(`unexpected request to ${href}`);
    }) as unknown as typeof fetch;

    const openBrowserFn = async (ssoUrl: string) => {
      const redirectUrl = new URL(
        new URL(ssoUrl).searchParams.get('redirectUrl')!,
      );
      redirectUrl.searchParams.set('loginToken', 'syt_from_browser');
      await fetch(redirectUrl.href);
      return true;
    };

    return { fetchFn, openBrowserFn };
  }

  it('completes the round trip and returns a session', async () => {
    const { fetchFn, openBrowserFn } = fakeHomeserver();

    const auth = await ssoLogin({
      matrixUrl: MATRIX_URL,
      fetchFn,
      openBrowserFn,
      log: () => {},
    });

    expect(auth.userId).toBe('@luke:example.com');
    expect(auth.accessToken).toBe('access');
    expect(auth.matrixUrl).toBe(MATRIX_URL);
  });

  it('still prints a URL when no browser could be launched', async () => {
    const { fetchFn, openBrowserFn } = fakeHomeserver();
    const logged: string[] = [];

    await ssoLogin({
      matrixUrl: MATRIX_URL,
      fetchFn,
      openBrowserFn: async (url) => {
        await openBrowserFn(url);
        return false;
      },
      log: (message) => logged.push(message),
    });

    expect(logged.join('\n')).toMatch(/Open this URL in your browser/);
  });

  it('refuses a homeserver with no SSO provider', async () => {
    const { openBrowserFn } = fakeHomeserver();
    const { fetchFn } = fakeHomeserver([
      { type: 'm.login.password' },
      { type: 'm.login.token' },
    ]);

    await expect(
      ssoLogin({
        matrixUrl: MATRIX_URL,
        fetchFn,
        openBrowserFn,
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(SsoNotSupportedError);
  });

  it('refuses a homeserver that cannot redeem the token it would issue', async () => {
    const { openBrowserFn } = fakeHomeserver();
    const { fetchFn } = fakeHomeserver([
      { type: 'm.login.sso', identity_providers: [{ id: GOOGLE_IDP_ID }] },
      { type: 'm.login.password' },
    ]);

    await expect(
      ssoLogin({
        matrixUrl: MATRIX_URL,
        fetchFn,
        openBrowserFn,
        log: () => {},
      }),
    ).rejects.toThrow(/m\.login\.token/);
  });
});
