import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProfileManager } from '../../src/lib/profile-manager.js';
import { SsoTimeoutError } from '../../src/lib/sso-login.js';
import type { MatrixAuth } from '../../src/lib/auth.js';
import {
  addProfile,
  resolveEnvironment,
  type AddProfileDeps,
} from '../../src/commands/profile.js';

const { environment } = resolveEnvironment({ staging: true });
const matrixId = '@example-user:stack.cards';

function authFor(userId: string, accessToken = 'browser-token'): MatrixAuth {
  return {
    accessToken,
    deviceId: 'BROWSERDEVICE',
    userId,
    matrixUrl: environment.matrixUrl,
  };
}

// `boxel profile add` as the browser path runs it, with the browser and the
// terminal stood in for. `answers` maps each question to its reply; a question
// it has no reply for fails the test, so a test that gives none asserts that
// nothing was asked.
function deps({
  tty,
  answers = {},
  browserLogin = async () => authFor(matrixId),
  secureOrigin,
}: {
  tty: boolean;
  answers?: Record<string, string>;
  browserLogin?: AddProfileDeps['browserLogin'];
  // The secure origin the realm server says can sign a profile in; none
  // stands for a realm server without one.
  secureOrigin?: string;
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
      browserLogin: vi.fn(browserLogin),
      secureOriginForProfiles: vi.fn(async () => secureOrigin),
      secureSignOut: vi.fn(async () => {}),
      ensurePersonalRealm: vi.fn(async () => ({
        outcome: 'has-realms' as const,
      })),
      prompt,
      isTty: () => tty,
    } satisfies AddProfileDeps,
  };
}

describe('boxel profile add through the browser', () => {
  let tmpDir: string;
  let manager: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-profile-add-'));
    manager = new ProfileManager(tmpDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('without a TTY', () => {
    it('saves the signed-in account without asking anything', async () => {
      let { prompt, deps: d } = deps({ tty: false });
      await addProfile(manager, environment, true, d);

      expect(prompt).not.toHaveBeenCalled();
      let profile = manager.getProfile(matrixId)!;
      expect(profile.matrixAccessToken).toBe('browser-token');
      expect(profile.displayName).toBe('example-user · stack.cards');
      expect(manager.getActiveProfileId()).toBe(matrixId);
      expect(d.ensurePersonalRealm).toHaveBeenCalledOnce();
    });

    it('replaces a stored profile for the same account and keeps its name', async () => {
      await manager.addProfileWithAuth(
        matrixId,
        authFor(matrixId, 'old-token'),
        'Example Name',
        environment.realmServerUrl,
      );

      let { prompt, deps: d } = deps({ tty: false });
      await addProfile(manager, environment, true, d);

      expect(prompt).not.toHaveBeenCalled();
      let profile = manager.getProfile(matrixId)!;
      expect(profile.matrixAccessToken).toBe('browser-token');
      expect(profile.displayName).toBe('Example Name');
    });

    it('leaves a different active profile active, and names the switch command', async () => {
      let otherId = '@other-example-user:stack.cards';
      await manager.addProfileWithAuth(
        otherId,
        authFor(otherId),
        undefined,
        environment.realmServerUrl,
      );

      let { prompt, deps: d } = deps({ tty: false });
      await addProfile(manager, environment, true, d);

      expect(prompt).not.toHaveBeenCalled();
      expect(manager.getProfile(matrixId)).toBeDefined();
      expect(manager.getActiveProfileId()).toBe(otherId);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(`boxel profile switch ${matrixId}`),
      );
    });

    it('fails instead of falling back to a terminal password sign-in when the browser times out', async () => {
      let { prompt, deps: d } = deps({
        tty: false,
        browserLogin: async () => {
          throw new SsoTimeoutError('Timed out waiting for the browser.');
        },
      });
      await addProfile(manager, environment, true, d);

      expect(prompt).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringMatching(/BOXEL_PASSWORD=\.\.\. boxel profile add -u/),
      );
      expect(manager.listProfiles()).toEqual([]);
    });

    it('fails with --no-browser rather than asking for a username', async () => {
      let { prompt, deps: d } = deps({ tty: false });
      await addProfile(manager, environment, false, d);

      expect(d.browserLogin).not.toHaveBeenCalled();
      expect(prompt).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('on a realm server whose secure origin signs profiles in', () => {
    const SECURE_ORIGIN = 'https://secure.stack.cards/';
    const secureSession = {
      token: 'secure-session-token',
      userId: matrixId,
      expiresAt: '2099-01-01T00:00:00.000Z',
    };

    it('signs in there, and keeps the secure session with the profile', async () => {
      let { deps: d } = deps({
        tty: false,
        secureOrigin: SECURE_ORIGIN,
        browserLogin: async () => ({ ...authFor(matrixId), secureSession }),
      });
      await addProfile(manager, environment, true, d);

      expect(d.secureOriginForProfiles).toHaveBeenCalledWith(
        environment.realmServerUrl,
      );
      expect(d.browserLogin).toHaveBeenCalledWith(
        expect.objectContaining({ secureOriginUrl: SECURE_ORIGIN }),
      );
      let profile = manager.getProfile(matrixId)!;
      expect(profile.matrixAccessToken).toBe('browser-token');
      expect(profile).not.toHaveProperty('secureSession.secureSession');
      expect(profile.secureSession).toEqual(secureSession);
      expect(manager.getSecureSession()).toEqual(secureSession);
      expect(d.ensurePersonalRealm).toHaveBeenCalledWith(
        authFor(matrixId),
        environment.realmServerUrl,
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Signed in to manage keys until'),
      );
    });

    it('ends a secure session whose login token could not be redeemed, on this realm server', async () => {
      let { deps: d } = deps({
        tty: false,
        secureOrigin: SECURE_ORIGIN,
        browserLogin: async (options) => {
          await options.discardSecureSession!(secureSession);
          throw new Error('The homeserver refused the login token.');
        },
      });
      await expect(addProfile(manager, environment, true, d)).rejects.toThrow(
        'refused the login token',
      );

      expect(d.secureSignOut).toHaveBeenCalledWith(
        environment.realmServerUrl,
        secureSession.token,
      );
      expect(manager.getProfile(matrixId)).toBeUndefined();
    });

    it('ends the secure session the profile had, which the new one replaces', async () => {
      await manager.addProfileWithAuth(
        matrixId,
        authFor(matrixId, 'old-token'),
        'Example Name',
        environment.realmServerUrl,
        { ...secureSession, token: 'old-secure-session' },
      );
      let { deps: d } = deps({
        tty: false,
        secureOrigin: SECURE_ORIGIN,
        browserLogin: async () => ({ ...authFor(matrixId), secureSession }),
      });
      await addProfile(manager, environment, true, d);

      expect(manager.getProfile(matrixId)!.secureSession).toEqual(
        secureSession,
      );
      expect(d.secureSignOut).toHaveBeenCalledWith(
        environment.realmServerUrl,
        'old-secure-session',
      );
    });

    it('ends the secure session a profile drops on moving to another realm server, on the server that issued it', async () => {
      await manager.addProfileWithAuth(
        matrixId,
        authFor(matrixId, 'old-token'),
        'Example Name',
        'https://other-realm.example.test/',
        { ...secureSession, token: 'other-server-session' },
      );
      let { deps: d } = deps({ tty: false });
      await addProfile(manager, environment, true, d);

      expect(manager.getProfile(matrixId)!.secureSession).toBeUndefined();
      expect(d.secureSignOut).toHaveBeenCalledWith(
        'https://other-realm.example.test/',
        'other-server-session',
      );
    });

    it('ends a replaced secure session on the server that issued it', async () => {
      await manager.addProfileWithAuth(
        matrixId,
        authFor(matrixId, 'old-token'),
        'Example Name',
        'https://other-realm.example.test/',
        { ...secureSession, token: 'other-server-session' },
      );
      let { deps: d } = deps({
        tty: false,
        secureOrigin: SECURE_ORIGIN,
        browserLogin: async () => ({ ...authFor(matrixId), secureSession }),
      });
      await addProfile(manager, environment, true, d);

      expect(manager.getProfile(matrixId)!.secureSession).toEqual(
        secureSession,
      );
      expect(d.secureSignOut).toHaveBeenCalledTimes(1);
      expect(d.secureSignOut).toHaveBeenCalledWith(
        'https://other-realm.example.test/',
        'other-server-session',
      );
    });

    it('keeps the secure session a profile had when the sign-in brings none', async () => {
      let kept = { ...secureSession, token: 'kept-secure-session' };
      await manager.addProfileWithAuth(
        matrixId,
        authFor(matrixId, 'old-token'),
        'Example Name',
        environment.realmServerUrl,
        kept,
      );
      let { deps: d } = deps({ tty: false });
      await addProfile(manager, environment, true, d);

      expect(manager.getProfile(matrixId)!.secureSession).toEqual(kept);
      expect(d.secureSignOut).not.toHaveBeenCalled();
    });

    it("ends a secure session that isn't for the account signed in, rather than keeping it", async () => {
      let { deps: d } = deps({
        tty: false,
        secureOrigin: SECURE_ORIGIN,
        browserLogin: async () => ({
          ...authFor(matrixId),
          secureSession: {
            ...secureSession,
            userId: '@someone-else:stack.cards',
          },
        }),
      });
      await addProfile(manager, environment, true, d);

      expect(manager.getProfile(matrixId)!.secureSession).toBeUndefined();
      expect(d.secureSignOut).toHaveBeenCalledWith(
        environment.realmServerUrl,
        'secure-session-token',
      );
    });

    it('ends the secure session when saving the profile is declined', async () => {
      let { deps: d } = deps({
        tty: true,
        secureOrigin: SECURE_ORIGIN,
        answers: { 'Save this profile? [Y/n]: ': 'n' },
        browserLogin: async () => ({ ...authFor(matrixId), secureSession }),
      });
      await addProfile(manager, environment, true, d);

      expect(manager.getProfile(matrixId)).toBeUndefined();
      expect(d.secureSignOut).toHaveBeenCalledWith(
        environment.realmServerUrl,
        'secure-session-token',
      );
    });

    it('opens the page --host-url names instead', async () => {
      let { environment: hostEnvironment } = resolveEnvironment({
        staging: true,
        hostUrl: 'https://host.example.test/',
      });
      let { deps: d } = deps({ tty: false, secureOrigin: SECURE_ORIGIN });
      await addProfile(manager, hostEnvironment, true, d);

      expect(d.secureOriginForProfiles).not.toHaveBeenCalled();
      expect(d.browserLogin).toHaveBeenCalledWith(
        expect.objectContaining({
          hostUrl: 'https://host.example.test/',
          secureOriginUrl: undefined,
        }),
      );
    });
  });

  describe('on a realm server whose secure origin cannot sign profiles in', () => {
    it("opens the host app's own page, as it always has", async () => {
      let { deps: d } = deps({ tty: false });
      await addProfile(manager, environment, true, d);

      expect(d.browserLogin).toHaveBeenCalledWith(
        expect.objectContaining({
          matrixUrl: environment.matrixUrl,
          hostUrl: environment.realmServerUrl,
          secureOriginUrl: undefined,
        }),
      );
      expect(manager.getProfile(matrixId)!.secureSession).toBeUndefined();
    });
  });

  describe('with a TTY', () => {
    it('asks before saving, and saves under the name given', async () => {
      let { prompt, deps: d } = deps({
        tty: true,
        answers: {
          'Save this profile? [Y/n]: ': '',
          'Display name [example-user · stack.cards]: ': 'Chosen Name',
        },
      });
      await addProfile(manager, environment, true, d);

      expect(prompt).toHaveBeenCalledTimes(2);
      expect(manager.getProfile(matrixId)!.displayName).toBe('Chosen Name');
    });

    it('leaves a stored profile alone when replacing it is declined', async () => {
      await manager.addProfileWithAuth(
        matrixId,
        authFor(matrixId, 'old-token'),
        'Example Name',
        environment.realmServerUrl,
      );

      let { deps: d } = deps({
        tty: true,
        answers: {
          'Save this profile? [Y/n]: ': 'y',
          'Overwrite? [y/N]: ': '',
        },
      });
      await addProfile(manager, environment, true, d);

      expect(manager.getProfile(matrixId)!.matrixAccessToken).toBe('old-token');
    });
  });
});
