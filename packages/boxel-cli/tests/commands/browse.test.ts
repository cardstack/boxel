import { describe, it, expect, vi } from 'vitest';

import {
  hostAppUrlForProfile,
  buildBrowseUrl,
  browse,
} from '../../src/commands/browse.js';
import {
  requestLoginToken,
  MatrixAuthError,
  MatrixRateLimitError,
} from '../../src/lib/auth.js';
import type { ProfileManager } from '../../src/lib/profile-manager.js';

const MATRIX_URL = 'https://matrix.example.com';
const MATRIX_AUTH = {
  accessToken: 'access-token',
  userId: '@alice:example.com',
  deviceId: 'DEVICE',
  matrixUrl: MATRIX_URL,
};

// A minimal Response stand-in shaped to what requestLoginToken reads.
function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  let text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
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

  it('treats an old-Synapse 400 M_UNRECOGNIZED as "not enabled"', async () => {
    let fetchFn = vi
      .fn()
      .mockResolvedValue(
        fakeResponse(400, { errcode: 'M_UNRECOGNIZED', error: 'Unrecognized' }),
      );

    await expect(requestLoginToken(MATRIX_AUTH, fetchFn)).rejects.toThrow(
      /login_via_existing_session enabled/,
    );
  });

  it('throws MatrixRateLimitError with the wait on a 429 M_LIMIT_EXCEEDED', async () => {
    let fetchFn = vi.fn().mockResolvedValue(
      fakeResponse(429, {
        errcode: 'M_LIMIT_EXCEEDED',
        error: 'Too Many Requests',
        retry_after_ms: 45000,
      }),
    );

    await expect(requestLoginToken(MATRIX_AUTH, fetchFn)).rejects.toMatchObject(
      {
        name: 'MatrixRateLimitError',
        retryAfterMs: 45000,
      },
    );
  });

  it('falls back to the Retry-After header when the body has no retry_after_ms', async () => {
    let fetchFn = vi
      .fn()
      .mockResolvedValue(
        fakeResponse(
          429,
          { errcode: 'M_LIMIT_EXCEEDED', error: 'Too Many Requests' },
          { 'Retry-After': '30' },
        ),
      );

    await expect(requestLoginToken(MATRIX_AUTH, fetchFn)).rejects.toMatchObject(
      {
        name: 'MatrixRateLimitError',
        retryAfterMs: 30000,
      },
    );
  });

  it('throws MatrixRateLimitError with no wait when retry_after_ms is absent', async () => {
    let fetchFn = vi
      .fn()
      .mockResolvedValue(
        fakeResponse(429, { errcode: 'M_LIMIT_EXCEEDED', error: 'slow down' }),
      );

    let err = await requestLoginToken(MATRIX_AUTH, fetchFn).catch((e) => e);
    expect(err).toBeInstanceOf(MatrixRateLimitError);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('classifies an M_LIMIT_EXCEEDED errcode on a non-429 status as a rate limit', async () => {
    let fetchFn = vi
      .fn()
      .mockResolvedValue(
        fakeResponse(400, { errcode: 'M_LIMIT_EXCEEDED', error: 'slow down' }),
      );

    await expect(
      requestLoginToken(MATRIX_AUTH, fetchFn),
    ).rejects.toBeInstanceOf(MatrixRateLimitError);
  });

  it('reports a 400 with another errcode as a raw failure, not "not enabled"', async () => {
    let fetchFn = vi
      .fn()
      .mockResolvedValue(
        fakeResponse(400, { errcode: 'M_NOT_JSON', error: 'Bad request' }),
      );

    await expect(requestLoginToken(MATRIX_AUTH, fetchFn)).rejects.toThrow(
      /login-token request failed: 400/,
    );
  });

  it('errors when a 200 response has no login_token', async () => {
    let fetchFn = vi
      .fn()
      .mockResolvedValue(fakeResponse(200, { expires_in_ms: 120000 }));

    await expect(requestLoginToken(MATRIX_AUTH, fetchFn)).rejects.toThrow(
      /did not include a login_token/,
    );
  });

  it('omits expiresInMs when the server does not report one', async () => {
    let fetchFn = vi
      .fn()
      .mockResolvedValue(fakeResponse(200, { login_token: 'lt_abc' }));

    await expect(requestLoginToken(MATRIX_AUTH, fetchFn)).resolves.toEqual({
      loginToken: 'lt_abc',
    });
  });
});

describe('browse', () => {
  const ALICE_PROFILE = {
    displayName: 'Alice',
    matrixUrl: 'http://localhost:8008',
    realmServerUrl: 'https://localhost:4201/',
    matrixAccessToken: 'access-token',
    matrixUserId: '@alice:localhost',
    matrixDeviceId: 'DEVICE',
  };

  // A ProfileManager stub whose relevant methods can be overridden per test.
  function fakeProfileManager(
    overrides: Partial<Record<string, unknown>> = {},
  ): ProfileManager {
    return {
      getActiveProfile: () => ({
        id: '@alice:localhost',
        profile: ALICE_PROFILE,
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
      ...overrides,
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

  it('propagates a second auth rejection instead of re-authenticating again', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let reAuthenticate = vi.fn().mockResolvedValue({
      accessToken: 'fresh-token',
      userId: '@alice:localhost',
      deviceId: 'DEVICE',
      matrixUrl: 'http://localhost:8008',
    });
    let requestLoginTokenFn = vi
      .fn()
      .mockRejectedValue(new MatrixAuthError(401, 'still rejected'));

    await expect(
      browse(undefined, {
        profileManager: fakeProfileManager({ reAuthenticate }),
        requestLoginToken: requestLoginTokenFn,
        openBrowserFn,
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(MatrixAuthError);

    expect(reAuthenticate).toHaveBeenCalledTimes(1);
    expect(requestLoginTokenFn).toHaveBeenCalledTimes(2);
    expect(openBrowserFn).not.toHaveBeenCalled();
  });

  it('surfaces a clear rate-limit error and does not open a browser for a long wait', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let sleep = vi.fn().mockResolvedValue(undefined);
    let requestLoginTokenFn = vi
      .fn()
      .mockRejectedValue(new MatrixRateLimitError('rate limited', 45000));

    let err: Error = await browse(undefined, {
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn,
      sleep,
      log: () => {},
    }).catch((e) => e);

    expect(err.message).toMatch(/once per minute per account/);
    // Waiting would have worked here, so the message points at `--wait`.
    expect(err.message).toMatch(/--wait/);
    // No wait, no retry, no browser opened.
    expect(sleep).not.toHaveBeenCalled();
    expect(requestLoginTokenFn).toHaveBeenCalledTimes(1);
    expect(openBrowserFn).not.toHaveBeenCalled();
  });

  it('says "shortly" and suggests --wait when the rate limit reports no wait', async () => {
    let requestLoginTokenFn = vi
      .fn()
      .mockRejectedValue(new MatrixRateLimitError('rate limited'));

    let err: Error = await browse(undefined, {
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn: vi.fn(),
      sleep: vi.fn(),
      log: () => {},
    }).catch((e) => e);

    expect(err.message).toMatch(/Try again shortly/);
    expect(err.message).toMatch(/--wait/);
  });

  it('handles a rate limit surfaced by the post-re-auth mint', async () => {
    // The first mint fails auth, re-auth succeeds, and the second mint hits the
    // rate limit — the wait/retry layer applies just the same.
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let sleep = vi.fn().mockResolvedValue(undefined);
    let requestLoginTokenFn = vi
      .fn()
      .mockRejectedValueOnce(new MatrixAuthError(401, 'rejected'))
      .mockRejectedValueOnce(new MatrixRateLimitError('rate limited', 2000))
      .mockResolvedValueOnce({ loginToken: 'lt_fresh', expiresInMs: 120000 });

    await browse(undefined, {
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn,
      sleep,
      log: () => {},
    });

    expect(sleep).toHaveBeenCalledWith(2000);
    expect(requestLoginTokenFn).toHaveBeenCalledTimes(3);
    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://localhost:4200/?loginToken=lt_fresh',
    );
  });

  it('auto-waits and retries once when the rate-limit wait is short', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let sleep = vi.fn().mockResolvedValue(undefined);
    let requestLoginTokenFn = vi
      .fn()
      .mockRejectedValueOnce(new MatrixRateLimitError('rate limited', 2000))
      .mockResolvedValueOnce({ loginToken: 'lt_fresh', expiresInMs: 120000 });

    await browse(undefined, {
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn,
      sleep,
      log: () => {},
    });

    expect(sleep).toHaveBeenCalledWith(2000);
    expect(requestLoginTokenFn).toHaveBeenCalledTimes(2);
    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://localhost:4200/?loginToken=lt_fresh',
    );
  });

  it('waits out the reported delay and retries when --wait is set for a long window', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let sleep = vi.fn().mockResolvedValue(undefined);
    let requestLoginTokenFn = vi
      .fn()
      .mockRejectedValueOnce(new MatrixRateLimitError('rate limited', 45000))
      .mockResolvedValueOnce({ loginToken: 'lt_fresh', expiresInMs: 120000 });

    await browse(undefined, {
      wait: true,
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn,
      sleep,
      log: () => {},
    });

    expect(sleep).toHaveBeenCalledWith(45000);
    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://localhost:4200/?loginToken=lt_fresh',
    );
  });

  it('blocks a full rate-limit window under --wait when no wait is reported', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let sleep = vi.fn().mockResolvedValue(undefined);
    let requestLoginTokenFn = vi
      .fn()
      .mockRejectedValueOnce(new MatrixRateLimitError('rate limited'))
      .mockResolvedValueOnce({ loginToken: 'lt_fresh', expiresInMs: 120000 });

    await browse(undefined, {
      wait: true,
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn,
      sleep,
      log: () => {},
    });

    // A 5s-style short wait would land inside the ~1/min window and fail; the
    // fallback is a full window (DEFAULT_WAIT_MS).
    expect(sleep).toHaveBeenCalledWith(60000);
    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://localhost:4200/?loginToken=lt_fresh',
    );
  });

  it('errors immediately under --wait when the reported wait exceeds the ceiling', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let sleep = vi.fn().mockResolvedValue(undefined);
    let requestLoginTokenFn = vi
      .fn()
      .mockRejectedValue(new MatrixRateLimitError('rate limited', 120000));

    let err: Error = await browse(undefined, {
      wait: true,
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn,
      sleep,
      log: () => {},
    }).catch((e) => e);

    // Sleeping less than the server asked guarantees the retry fails, so no
    // time is burned waiting — and `--wait` isn't suggested (it can't help).
    expect(err.message).toMatch(/once per minute per account/);
    expect(err.message).not.toMatch(/--wait/);
    expect(sleep).not.toHaveBeenCalled();
    expect(requestLoginTokenFn).toHaveBeenCalledTimes(1);
    expect(openBrowserFn).not.toHaveBeenCalled();
  });

  it('gives up with a friendly error when the rate limit persists after the retry', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let sleep = vi.fn().mockResolvedValue(undefined);
    let requestLoginTokenFn = vi
      .fn()
      .mockRejectedValue(new MatrixRateLimitError('rate limited', 2000));

    let err: Error = await browse(undefined, {
      wait: true,
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      openBrowserFn,
      sleep,
      log: () => {},
    }).catch((e) => e);

    expect(err.message).toMatch(/once per minute per account/);
    // `--wait` was already in effect, so the message doesn't suggest it.
    expect(err.message).not.toMatch(/--wait/);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(requestLoginTokenFn).toHaveBeenCalledTimes(2);
    expect(openBrowserFn).not.toHaveBeenCalled();
  });

  it('under --print-url, a rate limit throws and prints no URL to stdout', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let sleep = vi.fn().mockResolvedValue(undefined);
    let requestLoginTokenFn = vi
      .fn()
      .mockRejectedValue(new MatrixRateLimitError('rate limited', 45000));
    let stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    await expect(
      browse(undefined, {
        printUrl: true,
        profileManager: fakeProfileManager(),
        requestLoginToken: requestLoginTokenFn,
        openBrowserFn,
        sleep,
        log: () => {},
      }),
    ).rejects.toThrow(/once per minute per account/);

    expect(sleep).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    stdout.mockRestore();
  });

  it('uses a named --profile via getProfile', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let getStoredMatrixAuth = vi.fn().mockReturnValue({
      accessToken: 'access-token',
      userId: '@bob:boxel.ai',
      deviceId: 'DEVICE',
      matrixUrl: 'https://matrix.boxel.ai',
    });
    let pm = fakeProfileManager({
      // A named profile shouldn't fall back to the active one.
      getActiveProfile: () => null,
      getProfile: (id: string) =>
        id === '@bob:boxel.ai'
          ? { ...ALICE_PROFILE, realmServerUrl: 'https://app.boxel.ai/' }
          : undefined,
      getStoredMatrixAuth,
    });

    await browse(undefined, {
      profile: '@bob:boxel.ai',
      profileManager: pm,
      requestLoginToken: vi
        .fn()
        .mockResolvedValue({ loginToken: 'lt_abc', expiresInMs: 120000 }),
      openBrowserFn,
      log: () => {},
    });

    expect(getStoredMatrixAuth).toHaveBeenCalledWith('@bob:boxel.ai');
    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://app.boxel.ai/?loginToken=lt_abc',
    );
  });

  it('errors when the named --profile does not exist', async () => {
    await expect(
      browse(undefined, {
        profile: '@nobody:boxel.ai',
        profileManager: fakeProfileManager({ getProfile: () => undefined }),
        requestLoginToken: vi.fn(),
        openBrowserFn: vi.fn(),
        log: () => {},
      }),
    ).rejects.toThrow(/No profile named "@nobody:boxel.ai"/);
  });

  it('errors when there is no active profile', async () => {
    await expect(
      browse(undefined, {
        profileManager: fakeProfileManager({ getActiveProfile: () => null }),
        requestLoginToken: vi.fn(),
        openBrowserFn: vi.fn(),
        log: () => {},
      }),
    ).rejects.toThrow(/No active profile/);
  });

  it('honors --host-url over the derived URL', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);

    await browse(undefined, {
      hostUrl: 'https://cs-123.localhost:4200',
      profileManager: fakeProfileManager(),
      requestLoginToken: vi
        .fn()
        .mockResolvedValue({ loginToken: 'lt_abc', expiresInMs: 120000 }),
      openBrowserFn,
      log: () => {},
    });

    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://cs-123.localhost:4200/?loginToken=lt_abc',
    );
  });

  it('opens a published-realm URL as-is, with no token', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let requestLoginTokenFn = vi.fn();
    let resolveAnonymousBrowseUrl = vi
      .fn()
      .mockResolvedValue('https://alice.boxel.space/Post/1');

    await browse('https://alice.boxel.space/Post/1', {
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      resolveAnonymousBrowseUrl,
      openBrowserFn,
      log: () => {},
    });

    expect(resolveAnonymousBrowseUrl).toHaveBeenCalledWith(
      'https://localhost:4201/',
      'https://alice.boxel.space/Post/1',
    );
    // No token minted, and the opened URL carries no loginToken.
    expect(requestLoginTokenFn).not.toHaveBeenCalled();
    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://alice.boxel.space/Post/1',
    );
  });

  it('opens an absolute published-realm URL with no active profile', async () => {
    // A fresh install (no profile) can still open a published URL: the
    // anonymous path runs before the token flow insists on a profile.
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let requestLoginTokenFn = vi.fn();
    let resolveAnonymousBrowseUrl = vi
      .fn()
      .mockResolvedValue('https://alice.boxel.space/Post/1');

    await browse('https://alice.boxel.space/Post/1', {
      profileManager: fakeProfileManager({ getActiveProfile: () => null }),
      requestLoginToken: requestLoginTokenFn,
      resolveAnonymousBrowseUrl,
      openBrowserFn,
      log: () => {},
    });

    // No profile, so no realm-server URL is passed to the resolver.
    expect(resolveAnonymousBrowseUrl).toHaveBeenCalledWith(
      undefined,
      'https://alice.boxel.space/Post/1',
    );
    expect(requestLoginTokenFn).not.toHaveBeenCalled();
    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://alice.boxel.space/Post/1',
    );
  });

  it('errors with no active profile when the URL is not a published realm', async () => {
    // The anonymous path missed, so the token flow needs a profile — and
    // there is none.
    await expect(
      browse('alice/blog/Post/1', {
        profileManager: fakeProfileManager({ getActiveProfile: () => null }),
        requestLoginToken: vi.fn(),
        resolveAnonymousBrowseUrl: vi.fn().mockResolvedValue(undefined),
        openBrowserFn: vi.fn(),
        log: () => {},
      }),
    ).rejects.toThrow(/No active profile/);
  });

  it('prints the published URL under --print-url without minting a token', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let requestLoginTokenFn = vi.fn();
    let stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    await browse('https://alice.boxel.space/Post/1', {
      printUrl: true,
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      resolveAnonymousBrowseUrl: vi
        .fn()
        .mockResolvedValue('https://alice.boxel.space/Post/1'),
      openBrowserFn,
      log: () => {},
    });

    expect(openBrowserFn).not.toHaveBeenCalled();
    expect(requestLoginTokenFn).not.toHaveBeenCalled();
    expect(stdout).toHaveBeenCalledWith('https://alice.boxel.space/Post/1\n');
    stdout.mockRestore();
  });

  it('falls back to the login-token flow when the card path is not a published-realm URL', async () => {
    let openBrowserFn = vi.fn().mockResolvedValue(true);
    let requestLoginTokenFn = vi
      .fn()
      .mockResolvedValue({ loginToken: 'lt_abc', expiresInMs: 120000 });

    await browse('alice/blog/Post/1', {
      profileManager: fakeProfileManager(),
      requestLoginToken: requestLoginTokenFn,
      resolveAnonymousBrowseUrl: vi.fn().mockResolvedValue(undefined),
      openBrowserFn,
      log: () => {},
    });

    expect(requestLoginTokenFn).toHaveBeenCalledTimes(1);
    expect(openBrowserFn).toHaveBeenCalledWith(
      'https://localhost:4200/?loginToken=lt_abc&cardPath=alice%2Fblog%2FPost%2F1',
    );
  });

  it('does not attempt the anonymous path for bare browse (no card path)', async () => {
    let resolveAnonymousBrowseUrl = vi.fn();

    await browse(undefined, {
      profileManager: fakeProfileManager(),
      requestLoginToken: vi
        .fn()
        .mockResolvedValue({ loginToken: 'lt_abc', expiresInMs: 120000 }),
      resolveAnonymousBrowseUrl,
      openBrowserFn: vi.fn().mockResolvedValue(true),
      log: () => {},
    });

    expect(resolveAnonymousBrowseUrl).not.toHaveBeenCalled();
  });

  it('does not attempt the anonymous path when --host-url is given', async () => {
    let resolveAnonymousBrowseUrl = vi.fn();

    await browse('alice/blog/Post/1', {
      hostUrl: 'https://cs-123.localhost:4200',
      profileManager: fakeProfileManager(),
      requestLoginToken: vi
        .fn()
        .mockResolvedValue({ loginToken: 'lt_abc', expiresInMs: 120000 }),
      resolveAnonymousBrowseUrl,
      openBrowserFn: vi.fn().mockResolvedValue(true),
      log: () => {},
    });

    expect(resolveAnonymousBrowseUrl).not.toHaveBeenCalled();
  });

  it('warns with the URL when the browser cannot be opened', async () => {
    // spawn failed → the URL (a live single-use credential) is surfaced on
    // stderr so the user can finish by hand.
    let openBrowserFn = vi.fn().mockResolvedValue(false);
    let stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await browse(undefined, {
      profileManager: fakeProfileManager(),
      requestLoginToken: vi
        .fn()
        .mockResolvedValue({ loginToken: 'lt_abc', expiresInMs: 120000 }),
      openBrowserFn,
      log: () => {},
    });

    let written = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('https://localhost:4200/?loginToken=lt_abc');
    stderr.mockRestore();
  });
});
