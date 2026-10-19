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
}: {
  tty: boolean;
  answers?: Record<string, string>;
  browserLogin?: AddProfileDeps['browserLogin'];
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

    it('switches to the new profile when another one is active', async () => {
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
      expect(manager.getActiveProfileId()).toBe(matrixId);
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
