import { describe, it, expect, vi } from 'vitest';

import {
  hostAppUrlForProfile,
  buildBrowseUrl,
  browse,
} from '../../src/commands/browse.js';
import { requestLoginToken, MatrixAuthError } from '../../src/lib/auth.js';
import type { ProfileManager } from '../../src/lib/profile-manager.js';

const MATRIX_URL = 'https://matrix.example.com';
const MATRIX_AUTH = {
  accessToken: 'access-token',
  userId: '@alice:example.com',
  deviceId: 'DEVICE',
  matrixUrl: MATRIX_URL,
};

// A minimal Response stand-in shaped to what requestLoginToken reads.
function fakeResponse(status: number, body: unknown): Response {
  let text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === 'string' ? JSON.parse(text) : body),
    text: async () => text,
  } as unknown as Response;
}

describe('hostAppUrlForProfile', () => {
  it('maps standard local dev to the host dev server origin', () => {
    // The realm server (4201) and host app (4200) run on different origins in
    // local dev; the token must be redeemed on the host app's.
    expect(
      hostAppUrlForProfile({ realmServerUrl: 'https://localhost:4201/' }),
    ).toBe('https://localhost:4200/');
  });

  it('serves the app from the realm-server origin for staging', () => {
    expect(
      hostAppUrlForProfile({
        realmServerUrl: 'https://realms-staging.stack.cards/',
      }),
    ).toBe('https://realms-staging.stack.cards/');
  });

  it('serves the app from the realm-server origin for production', () => {
    expect(
      hostAppUrlForProfile({ realmServerUrl: 'https://app.boxel.ai/' }),
    ).toBe('https://app.boxel.ai/');
  });

  it('normalizes a missing trailing slash', () => {
    expect(
      hostAppUrlForProfile({ realmServerUrl: 'https://app.boxel.ai' }),
    ).toBe('https://app.boxel.ai/');
  });

  it('lets --host-url override the derived URL (e.g. env-slug environments)', () => {
    expect(
      hostAppUrlForProfile(
        { realmServerUrl: 'https://realm-server.my-slug.localhost/' },
        'https://my-slug.localhost:4200',
      ),
    ).toBe('https://my-slug.localhost:4200/');
  });
});

describe('buildBrowseUrl', () => {
  it('appends the login token as a query param', () => {
    expect(buildBrowseUrl('https://app.boxel.ai/', 'tok123')).toBe(
      'https://app.boxel.ai/?loginToken=tok123',
    );
  });

  it('adds an encoded cardPath when given', () => {
    expect(
      buildBrowseUrl('https://app.boxel.ai/', 'tok123', 'my realm/card.json'),
    ).toBe(
      'https://app.boxel.ai/?loginToken=tok123&cardPath=my+realm%2Fcard.json',
    );
  });

  it('omits cardPath when not given', () => {
    expect(buildBrowseUrl('https://localhost:4200/', 'tok')).not.toContain(
      'cardPath',
    );
  });
});

describe('requestLoginToken', () => {
  it('returns the login token and expiry on success', async () => {
    let fetchFn = vi
      .fn()
      .mockResolvedValue(
        fakeResponse(200, { login_token: 'lt_abc', expires_in_ms: 120000 }),
      );

    await expect(requestLoginToken(MATRIX_AUTH, fetchFn)).resolves.toEqual({
      loginToken: 'lt_abc',
      expiresInMs: 120000,
    });

    let [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${MATRIX_URL}/_matrix/client/v1/login/get_token`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer access-token');
  });

  it('throws MatrixAuthError on a rejected access token (M_UNKNOWN_TOKEN)', async () => {
    let fetchFn = vi
      .fn()
      .mockResolvedValue(
        fakeResponse(401, { errcode: 'M_UNKNOWN_TOKEN', error: 'bad token' }),
      );

    await expect(
      requestLoginToken(MATRIX_AUTH, fetchFn),
    ).rejects.toBeInstanceOf(MatrixAuthError);
  });

  it('gives a clear "not enabled" error when the endpoint is unrecognized', async () => {
    let fetchFn = vi
      .fn()
      .mockResolvedValue(
        fakeResponse(404, { errcode: 'M_UNRECOGNIZED', error: 'Unknown' }),
      );

    await expect(requestLoginToken(MATRIX_AUTH, fetchFn)).rejects.toThrow(
      /login_via_existing_session enabled/,
    );
  });

  it('treats a UIA-gated 401 (require_ui_auth) as "not enabled"', async () => {
    let fetchFn = vi
      .fn()
      .mockResolvedValue(
        fakeResponse(401, { flows: [{ stages: ['m.login.password'] }] }),
      );

    await expect(requestLoginToken(MATRIX_AUTH, fetchFn)).rejects.toThrow(
      /login_via_existing_session enabled/,
    );
  });
});

describe('browse', () => {
  function fakeProfileManager(): ProfileManager {
    return {
      getActiveProfile: () => ({
        id: '@alice:localhost',
        profile: {
          displayName: 'Alice',
          matrixUrl: 'http://localhost:8008',
          realmServerUrl: 'https://localhost:4201/',
          matrixAccessToken: 'access-token',
          matrixUserId: '@alice:localhost',
          matrixDeviceId: 'DEVICE',
        },
      }),
      getProfile: () => undefined,
      getStoredMatrixAuth: () => ({
        accessToken: 'access-token',
        userId: '@alice:localhost',
        deviceId: 'DEVICE',
        matrixUrl: 'http://localhost:8008',
      }),
      reAuthenticate: async () => ({
        accessToken: 'fresh-token',
        userId: '@alice:localhost',
        deviceId: 'DEVICE',
        matrixUrl: 'http://localhost:8008',
      }),
    } as unknown as ProfileManager;
  }

  it('opens the derived host URL with a login token', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let requestLoginTokenFn = vi
      .fn()
      .mockResolvedValue({ loginToken: 'lt_abc', expiresInMs: 120000 });

    await browse(undefined, {
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn,
      log: () => {},
    });

    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://localhost:4200/?loginToken=lt_abc',
    );
  });

  it('deep-links to a card path when the positional arg is given', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let requestLoginTokenFn = vi
      .fn()
      .mockResolvedValue({ loginToken: 'lt_abc', expiresInMs: 120000 });

    await browse('cards/1.json', {
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn,
      log: () => {},
    });

    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://localhost:4200/?loginToken=lt_abc&cardPath=cards%2F1.json',
    );
  });

  it('prints the URL and does not open a browser under --print-url', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let requestLoginTokenFn = vi
      .fn()
      .mockResolvedValue({ loginToken: 'lt_abc', expiresInMs: 120000 });
    let stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    await browse(undefined, {
      printUrl: true,
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn,
      log: () => {},
    });

    expect(openBrowserFn).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith(
      'https://localhost:4200/?loginToken=lt_abc\n',
    );
    stdout.mockRestore();
  });

  it('re-authenticates once and retries when the access token is rejected', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let requestLoginTokenFn = vi
      .fn()
      .mockRejectedValueOnce(new MatrixAuthError(401, 'rejected'))
      .mockResolvedValueOnce({ loginToken: 'lt_fresh', expiresInMs: 120000 });

    await browse(undefined, {
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn,
      log: () => {},
    });

    expect(requestLoginTokenFn).toHaveBeenCalledTimes(2);
    // The retry used the freshly re-authenticated session.
    expect(requestLoginTokenFn.mock.calls[1][0]).toMatchObject({
      accessToken: 'fresh-token',
    });
    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://localhost:4200/?loginToken=lt_fresh',
    );
  });
});
