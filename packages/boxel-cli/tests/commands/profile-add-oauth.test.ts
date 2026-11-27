import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProfileManager } from '../../src/lib/profile-manager.js';
import type { MatrixAuth } from '../../src/lib/auth.js';
import {
  OAuthNotOfferedError,
  type BoxelApiProvider,
  type OAuthLoginResult,
} from '../../src/lib/oauth-login.js';
import {
  addOAuthProfile,
  addProfile,
  noBrowserHere,
  describeSignIn,
  resolveEnvironment,
  type AddProfileDeps,
} from '../../src/commands/profile.js';

const { environment } = resolveEnvironment({ staging: true });
const matrixId = '@example-user:stack.cards';
const issuer = environment.realmServerUrl.replace(/\/$/, '');

const provider: BoxelApiProvider = {
  resource: issuer,
  issuer,
  authorizationEndpoint: `${issuer}/_oauth-provider/auth`,
  tokenEndpoint: `${issuer}/_oauth-provider/token`,
  revocationEndpoint: `${issuer}/_oauth-provider/token/revocation`,
};

function signedIn(
  overrides: Partial<OAuthLoginResult['tokens']> = {},
): OAuthLoginResult {
  return {
    provider,
    tokens: {
      accessToken: 'access-token-placeholder',
      refreshToken: 'refresh-token-placeholder',
      accessExpiresAt: '2026-11-24T00:10:00.000Z',
      connectionEndsAt: '2026-12-24T00:00:00.000Z',
      ...overrides,
    },
    user: { userId: matrixId, displayName: 'Example User' },
  };
}

function matrixAuth(accessToken = 'matrix-token'): MatrixAuth {
  return {
    accessToken,
    deviceId: 'DEVICE',
    userId: matrixId,
    matrixUrl: environment.matrixUrl,
  };
}

// `boxel profile add --oauth` with the browser sign-in and the terminal
// stood in for. A question `answers` has no reply for fails the test.
function deps({
  tty,
  answers = {},
  oauthLogin = async () => signedIn(),
  remote = false,
}: {
  tty: boolean;
  answers?: Record<string, string>;
  oauthLogin?: AddProfileDeps['oauthLogin'];
  // Whether there is no browser here: SSH, or Linux with no display.
  remote?: boolean;
}) {
  let prompt = vi.fn(async (question: string) => {
    if (!(question in answers)) {
      throw new Error(`unexpected question: ${question}`);
    }
    return answers[question];
  });
  return {
    prompt,
    deps: {
      oauthLogin: vi.fn(oauthLogin),
      oauthDeviceLogin: vi.fn(async () => signedIn()),
      noBrowserHere: () => remote,
      revokeConnection: vi.fn(async () => true),
      secureSignOut: vi.fn(async () => {}),
      matrixLogout: vi.fn(async () => {}),
      ensurePersonalRealmWithOAuth: vi.fn(async () => ({
        outcome: 'has-realms' as const,
      })),
      browserLogin: vi.fn(async () => matrixAuth('browser-token')),
      secureOriginForProfiles: vi.fn(async () => undefined),
      ensurePersonalRealm: vi.fn(async () => ({
        outcome: 'has-realms' as const,
      })),
      prompt,
      isTty: () => tty,
    } satisfies AddProfileDeps,
  };
}

describe('boxel profile add --oauth, signing in with a code', () => {
  let tmpDir: string;
  let manager: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-profile-oauth-'));
    manager = new ProfileManager(tmpDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('--no-browser signs in with a code on another device', async () => {
    let { deps: d } = deps({ tty: false });
    await addOAuthProfile(manager, environment, d, { browser: false });
    expect(d.oauthDeviceLogin).toHaveBeenCalledWith({
      realmServerUrl: environment.realmServerUrl,
      allowAiCredits: false,
    });
    expect(d.oauthLogin).not.toHaveBeenCalled();
    expect(manager.getProfile(matrixId)?.oauth?.accessToken).toBe(
      'access-token-placeholder',
    );
  });

  it('finds no browser over SSH, or on Linux with no display', () => {
    expect(noBrowserHere({ SSH_CONNECTION: '1 2 3 4' }, 'darwin')).toBe(true);
    expect(noBrowserHere({ SSH_TTY: '/dev/pts/0' }, 'linux')).toBe(true);
    expect(noBrowserHere({}, 'linux')).toBe(true);
    expect(noBrowserHere({ DISPLAY: ':0' }, 'linux')).toBe(false);
    expect(noBrowserHere({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBe(
      false,
    );
    expect(noBrowserHere({}, 'darwin')).toBe(false);
    expect(noBrowserHere({}, 'win32')).toBe(false);
  });

  it('over SSH, signs in with a code without being asked to', async () => {
    let { deps: d } = deps({ tty: false, remote: true });
    await addOAuthProfile(manager, environment, d);
    expect(d.oauthDeviceLogin).toHaveBeenCalledOnce();
    expect(d.oauthLogin).not.toHaveBeenCalled();
  });
});

describe('boxel profile add --oauth', () => {
  let tmpDir: string;
  let manager: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-profile-oauth-'));
    manager = new ProfileManager(tmpDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores the OAuth connection and no Matrix token', async () => {
    let { deps: d } = deps({
      tty: true,
      answers: {
        'Save this profile? [Y/n]: ': '',
        'Display name [example-user · stack.cards]: ': 'Example',
      },
    });

    await addOAuthProfile(manager, environment, d);

    expect(d.oauthLogin).toHaveBeenCalledWith({
      realmServerUrl: environment.realmServerUrl,
      allowAiCredits: false,
      deviceFallback: true,
    });
    expect(d.oauthDeviceLogin).not.toHaveBeenCalled();
    let profile = manager.getProfile(matrixId)!;
    expect(profile).toEqual({
      displayName: 'Example',
      matrixUrl: environment.matrixUrl,
      realmServerUrl: environment.realmServerUrl,
      matrixUserId: matrixId,
      oauth: {
        issuer,
        tokenEndpoint: provider.tokenEndpoint,
        revocationEndpoint: provider.revocationEndpoint,
        accessToken: 'access-token-placeholder',
        refreshToken: 'refresh-token-placeholder',
        accessExpiresAt: '2026-11-24T00:10:00.000Z',
        connectionEndsAt: '2026-12-24T00:00:00.000Z',
      },
    });
    expect(manager.getActiveProfileId()).toBe(matrixId);
    expect(d.revokeConnection).not.toHaveBeenCalled();

    // The file on disk holds the same, readable only by its owner.
    let file = path.join(tmpDir, 'profiles.json');
    let onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.profiles[matrixId].matrixAccessToken).toBeUndefined();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('sets up a personal workspace with the new access token when the account has none', async () => {
    let { deps: d } = deps({ tty: false });
    d.ensurePersonalRealmWithOAuth.mockResolvedValueOnce({
      outcome: 'created',
      realmUrl: 'https://realms.example.test/example-user/personal/',
    } as never);
    let log = vi.spyOn(console, 'log');

    await addOAuthProfile(manager, environment, d);

    expect(d.ensurePersonalRealmWithOAuth).toHaveBeenCalledWith(
      {
        accessToken: 'access-token-placeholder',
        userId: matrixId,
        displayName: 'Example User',
      },
      environment.realmServerUrl,
    );
    expect(log.mock.calls.flat().join('\n')).toContain(
      'Created your personal workspace',
    );
  });

  it("ends the new connection when the profile can't be saved", async () => {
    let failing = new ProfileManager(tmpDir, {
      renameFile: () => {
        throw Object.assign(new Error('no space left on device'), {
          code: 'ENOSPC',
        });
      },
    });
    let { deps: d } = deps({ tty: false });
    let error = vi.spyOn(console, 'error');

    await addOAuthProfile(failing, environment, d);

    expect(d.revokeConnection).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toMatch(
      /Couldn't save the profile: no space left on device\. The new connection was ended/,
    );
    expect(new ProfileManager(tmpDir).getProfile(matrixId)).toBeUndefined();
    expect(d.ensurePersonalRealmWithOAuth).not.toHaveBeenCalled();
  });

  it('says what a Matrix profile it replaces gives up', async () => {
    await manager.addProfileWithAuth(
      matrixId,
      matrixAuth(),
      'Example Name',
      environment.realmServerUrl,
    );
    let { deps: d } = deps({ tty: false });
    let log = vi.spyOn(console, 'log');

    await addOAuthProfile(manager, environment, d);

    expect(log.mock.calls.flat().join('\n')).toMatch(
      /This replaces a profile signed in with Matrix\. A profile signed in with OAuth can't yet run `boxel run-command`/,
    );
  });

  it('asks nothing without a TTY', async () => {
    let { prompt, deps: d } = deps({ tty: false });

    await addOAuthProfile(manager, environment, d);

    expect(prompt).not.toHaveBeenCalled();
    expect(manager.getProfile(matrixId)!.oauth?.accessToken).toBe(
      'access-token-placeholder',
    );
  });

  it('ends the connection when the user declines to save the profile', async () => {
    let { deps: d } = deps({
      tty: true,
      answers: { 'Save this profile? [Y/n]: ': 'n' },
    });

    await addOAuthProfile(manager, environment, d);

    expect(manager.getProfile(matrixId)).toBeUndefined();
    expect(d.revokeConnection).toHaveBeenCalledWith(
      provider,
      signedIn().tokens,
    );
  });

  it('replaces a Matrix profile, signing out its Matrix token and ending its secure session', async () => {
    await manager.addProfileWithAuth(
      matrixId,
      matrixAuth(),
      'Example Name',
      environment.realmServerUrl,
      {
        token: 'secure-session-placeholder',
        userId: matrixId,
        expiresAt: '2026-12-01T00:00:00.000Z',
      },
    );
    let { deps: d } = deps({ tty: false });

    await addOAuthProfile(manager, environment, d);

    let profile = manager.getProfile(matrixId)!;
    expect(profile.displayName).toBe('Example Name');
    expect(profile.matrixAccessToken).toBeUndefined();
    expect(profile.secureSession).toBeUndefined();
    expect(profile.oauth?.accessToken).toBe('access-token-placeholder');
    expect(d.secureSignOut).toHaveBeenCalledWith(
      environment.realmServerUrl,
      'secure-session-placeholder',
    );
    expect(d.matrixLogout).toHaveBeenCalledWith(
      environment.matrixUrl,
      'matrix-token',
    );
  });

  it('keeps the new profile when signing out the replaced Matrix token fails', async () => {
    await manager.addProfileWithAuth(
      matrixId,
      matrixAuth(),
      'Example Name',
      environment.realmServerUrl,
    );
    let { deps: d } = deps({ tty: false });
    d.matrixLogout.mockRejectedValueOnce(new Error('network down'));

    await addOAuthProfile(manager, environment, d);

    expect(manager.getProfile(matrixId)?.oauth?.accessToken).toBe(
      'access-token-placeholder',
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('ends the connection a profile signed in again replaces', async () => {
    let { deps: first } = deps({
      tty: false,
      oauthLogin: async () =>
        signedIn({
          accessToken: 'old-access-token',
          refreshToken: 'old-refresh-token',
        }),
    });
    await addOAuthProfile(manager, environment, first);
    let { deps: d } = deps({ tty: false });

    await addOAuthProfile(manager, environment, d);

    expect(d.revokeConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        revocationEndpoint: provider.revocationEndpoint,
      }),
      expect.objectContaining({ refreshToken: 'old-refresh-token' }),
    );
    expect(manager.getProfile(matrixId)!.oauth?.refreshToken).toBe(
      'refresh-token-placeholder',
    );
  });

  it('ends the connection of an OAuth profile a Matrix sign-in replaces', async () => {
    await addOAuthProfile(manager, environment, deps({ tty: false }).deps);
    let { deps: d } = deps({ tty: false });

    await addProfile(manager, environment, true, d);

    let profile = manager.getProfile(matrixId)!;
    expect(profile.matrixAccessToken).toBe('browser-token');
    expect(profile.oauth).toBeUndefined();
    expect(d.revokeConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        revocationEndpoint: provider.revocationEndpoint,
      }),
      expect.objectContaining({ refreshToken: 'refresh-token-placeholder' }),
    );
  });

  it('stops without saving anything where the realm server offers no OAuth sign-in', async () => {
    let { deps: d } = deps({
      tty: true,
      oauthLogin: async () => {
        throw new OAuthNotOfferedError(
          environment.realmServerUrl,
          'its resource metadata answered 404',
        );
      },
    });

    await addOAuthProfile(manager, environment, d);

    expect(process.exitCode).toBe(1);
    expect(manager.listProfiles()).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("doesn't offer OAuth sign-in"),
    );
    expect(d.browserLogin).not.toHaveBeenCalled();
  });

  it("warns that a connection that doesn't renew ends with its access token", async () => {
    let { deps: d } = deps({
      tty: false,
      oauthLogin: async () =>
        signedIn({
          refreshToken: undefined,
          connectionEndsAt: '2026-11-24T01:00:00.000Z',
        }),
    });

    await addOAuthProfile(manager, environment, d);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("This connection doesn't renew"),
    );
  });
});

describe('boxel profile add --oauth --allow-ai-credits', () => {
  let tmpDir: string;
  let manager: ProfileManager;
  let logged: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-profile-oauth-'));
    manager = new ProfileManager(tmpDir);
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('asks to spend AI credits, keeps the scopes granted, and says it may spend', async () => {
    let { deps: d } = deps({
      tty: false,
      oauthLogin: async () =>
        signedIn({ scope: 'boxel:read boxel:write boxel:spend-credit' }),
    });

    await addOAuthProfile(manager, environment, d, { allowAiCredits: true });

    expect(d.oauthLogin).toHaveBeenCalledWith({
      realmServerUrl: environment.realmServerUrl,
      allowAiCredits: true,
      deviceFallback: true,
    });
    expect(manager.getProfile(matrixId)!.oauth!.scope).toBe(
      'boxel:read boxel:write boxel:spend-credit',
    );
    expect(logged.join('\n')).toContain('It may spend your AI credits.');
    expect(manager.canSpendAiCredits()).toBe(true);
  });

  it('asks to spend AI credits when it signs in with a code', async () => {
    let { deps: d } = deps({ tty: false });

    await addOAuthProfile(manager, environment, d, {
      browser: false,
      allowAiCredits: true,
    });

    expect(d.oauthDeviceLogin).toHaveBeenCalledWith({
      realmServerUrl: environment.realmServerUrl,
      allowAiCredits: true,
    });
    expect(d.oauthLogin).not.toHaveBeenCalled();
  });

  it('says how to let a connection without it spend', async () => {
    let { deps: d } = deps({
      tty: false,
      oauthLogin: async () => signedIn({ scope: 'boxel:read boxel:write' }),
    });

    await addOAuthProfile(manager, environment, d);

    expect(logged.join('\n')).toContain('--allow-ai-credits');
    expect(manager.canSpendAiCredits()).toBe(false);
  });

  it('refuses --allow-ai-credits without --oauth, before signing in', async () => {
    let { profileCommand } = await import('../../src/commands/profile.js');
    let { setProfileManager, resetProfileManager } =
      await import('../../src/lib/profile-manager.js');
    setProfileManager(tmpDir);
    try {
      await profileCommand('add', undefined, {
        allowAiCredits: true,
        staging: true,
      });
    } finally {
      resetProfileManager();
    }
    expect(manager.listProfiles()).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(logged.join('\n')).toContain('--allow-ai-credits goes with --oauth');
  });
});

describe('describeSignIn', () => {
  const now = Date.parse('2026-11-24T00:00:00Z');
  const base = {
    displayName: 'Example',
    matrixUrl: environment.matrixUrl,
    realmServerUrl: environment.realmServerUrl,
    matrixUserId: matrixId,
  };
  const oauthEnding = (connectionEndsAt: string) => ({
    ...base,
    oauth: {
      issuer,
      tokenEndpoint: provider.tokenEndpoint,
      accessToken: 'access-token-placeholder',
      accessExpiresAt: '2026-11-24T00:10:00.000Z',
      connectionEndsAt,
    },
  });

  it('names a Matrix profile', () => {
    expect(describeSignIn({ ...base, matrixAccessToken: 'token' }, now)).toBe(
      'Matrix',
    );
  });

  it("names when an OAuth profile's connection ends", () => {
    let text = describeSignIn(oauthEnding('2026-12-20T00:00:00Z'), now);
    expect(text).toMatch(/^OAuth, ends /);
    expect(text).not.toContain('sign in again');
  });

  it('warns three days before the connection ends', () => {
    let text = describeSignIn(oauthEnding('2026-11-26T00:00:00Z'), now);
    expect(text).toContain('sign in again before then');
  });

  it('says a connection that has ended needs a new sign-in', () => {
    let text = describeSignIn(oauthEnding('2026-11-23T00:00:00Z'), now);
    expect(text).toContain('ended');
    expect(text).toContain('boxel profile add --oauth');
  });
});
