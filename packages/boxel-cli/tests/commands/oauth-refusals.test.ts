import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { browse } from '../../src/commands/browse.ts';
import { capture } from '../../src/commands/capture.ts';
import { runCommand } from '../../src/commands/run-command.ts';
import { BoxelCLIClient } from '../../src/lib/boxel-cli-client.ts';
import { OAUTH_REFUSALS } from '../../src/lib/oauth-refusals.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import { describeOAuthPolicyRefusal } from '../../src/lib/realm-sync-base.ts';

const REALM_SERVER_URL = 'https://realms.example.test/';
const REALM_URL = `${REALM_SERVER_URL}example-user/example-realm/`;
const USER_ID = '@example-user:example.test';

describe('commands an OAuth profile refuses', () => {
  let dir: string;
  let pm: ProfileManager;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-oauth-refusals-'));
    pm = new ProfileManager(dir);
    pm.addOAuthProfile(
      USER_ID,
      {
        issuer: REALM_SERVER_URL.replace(/\/$/, ''),
        tokenEndpoint: `${REALM_SERVER_URL}_oauth-provider/token`,
        accessToken: 'access-token-placeholder',
        refreshToken: 'refresh-token-placeholder',
        accessExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        connectionEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      {
        matrixUrl: 'https://matrix.example.test/',
        realmServerUrl: REALM_SERVER_URL,
      },
    );
    fetchSpy = vi.fn(async () => {
      throw new Error('no request should be made');
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses boxel run-command', async () => {
    let result = await runCommand('example-command', REALM_URL, {
      profileManager: pm,
    });

    expect(result).toEqual({
      status: 'error',
      error: OAUTH_REFUSALS.runCommand,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses the library's runCommand", async () => {
    let result = await new BoxelCLIClient(pm).runCommand(
      REALM_SERVER_URL,
      REALM_URL,
      'example-command',
    );

    expect(result).toEqual({
      status: 'error',
      error: OAUTH_REFUSALS.runCommand,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses boxel capture', async () => {
    let result = await capture(`${REALM_URL}Card/1`, { profileManager: pm });

    expect(result).toEqual({
      ok: false,
      captures: [],
      error: OAUTH_REFUSALS.capture,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses to sign a browser in with boxel browse', async () => {
    let requestLoginToken = vi.fn();
    let openBrowserFn = vi.fn();

    await expect(
      browse(undefined, {
        profileManager: pm,
        requestLoginToken,
        openBrowserFn,
        log: () => {},
      }),
    ).rejects.toThrow(OAUTH_REFUSALS.browse);
    expect(requestLoginToken).not.toHaveBeenCalled();
    expect(openBrowserFn).not.toHaveBeenCalled();
  });

  it('refuses getServerToken', async () => {
    await expect(new BoxelCLIClient(pm).getServerToken()).rejects.toThrow(
      OAUTH_REFUSALS.serverToken,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('suggests a Matrix profile in each refusal of a command', () => {
    for (let refusal of [
      OAUTH_REFUSALS.runCommand,
      OAUTH_REFUSALS.capture,
      OAUTH_REFUSALS.browse,
    ]) {
      expect(refusal).toContain('`boxel profile add` without --oauth');
    }
  });
});

describe('describeOAuthPolicyRefusal', () => {
  it("explains a realm's refusal of an OAuth write to its policy", () => {
    let body = JSON.stringify({
      errors: [
        {
          status: 403,
          title: 'Forbidden',
          detail:
            "An app connected with OAuth may not change realm.json's policy or config",
        },
      ],
    });

    expect(describeOAuthPolicyRefusal(body)).toBe(
      "An app connected with OAuth may not change realm.json's policy or config. " +
        "This profile is signed in with OAuth, which can't change who a realm admits: make this change in the app, or with a profile signed in with Matrix.",
    );
  });

  it('names a policy card the same way', () => {
    expect(
      describeOAuthPolicyRefusal(
        'An app connected with OAuth may not change a policy card',
      ),
    ).toMatch(/^An app connected with OAuth may not change a policy card\./);
  });

  it('leaves any other failure alone', () => {
    expect(describeOAuthPolicyRefusal('Forbidden')).toBeUndefined();
  });
});
