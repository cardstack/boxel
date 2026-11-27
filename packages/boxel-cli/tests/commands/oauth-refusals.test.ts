import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { browse, registerBrowseCommand } from '../../src/commands/browse.ts';
import { capture, registerCaptureCommand } from '../../src/commands/capture.ts';
import {
  registerRunCommand,
  runCommand,
} from '../../src/commands/run-command.ts';
import { BoxelCLIClient } from '../../src/lib/boxel-cli-client.ts';
import { OAUTH_REFUSALS } from '../../src/lib/oauth-refusals.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  RealmSyncBase,
  describeOAuthPolicyRefusal,
} from '../../src/lib/realm-sync-base.ts';

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

  it('opens boxel browse naming the account, with no login token', async () => {
    let requestLoginToken = vi.fn();
    let openBrowserFn = vi.fn().mockResolvedValue(true);

    await browse(undefined, {
      profileManager: pm,
      requestLoginToken,
      openBrowserFn,
      log: () => {},
    });

    expect(requestLoginToken).not.toHaveBeenCalled();
    expect(openBrowserFn).toHaveBeenCalledTimes(1);
    let opened = new URL(openBrowserFn.mock.calls[0][0]);
    expect(opened.searchParams.get('signInAs')).toBe(USER_ID);
    expect(opened.searchParams.has('loginToken')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses getServerToken', async () => {
    await expect(new BoxelCLIClient(pm).getServerToken()).rejects.toThrow(
      OAUTH_REFUSALS.serverToken,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('suggests a Matrix profile in each refusal of a command', () => {
    for (let refusal of [OAUTH_REFUSALS.runCommand, OAUTH_REFUSALS.capture]) {
      expect(refusal).toContain('`boxel profile add` without --oauth');
    }
  });
});

// What the realm sends when it refuses an OAuth caller's write to its policy:
// a serialized CardError, with the reason in a top-level `message`.
function policyRefusal(change: string): Response {
  return new Response(
    JSON.stringify({
      message: `An app connected with OAuth may not change ${change}`,
      status: 403,
      title: 'Forbidden',
      additionalErrors: null,
      realm: REALM_URL,
    }),
    { status: 403, statusText: 'Forbidden' },
  );
}

class Uploader extends RealmSyncBase {
  async sync(): Promise<void> {}
  upload(files: Map<string, string>) {
    return this.uploadFilesAtomic(files, new Set());
  }
}

describe("a realm's refusal of an OAuth write to its policy", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-oauth-policy-'));
    fs.writeFileSync(path.join(dir, 'realm.json'), '{}');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is explained when push or sync uploads a batch', async () => {
    let uploader = new Uploader(
      { realmUrl: REALM_URL, localDir: dir },
      {
        authedRealmFetch: async () =>
          policyRefusal("realm.json's policy or config"),
      },
    );

    let result = await uploader.upload(
      new Map([['realm.json', path.join(dir, 'realm.json')]]),
    );

    expect(result.error).toEqual({
      status: 403,
      perFile: [],
      message:
        "Atomic upload failed: 403 Forbidden. An app connected with OAuth may not change realm.json's policy or config. " +
        "This profile is signed in with OAuth, which can't change who a realm admits: make this change in the app, or with a profile signed in with Matrix. " +
        '(0 of 1 text file(s) written, 1 rejected, 0 not sent)',
    });
  });

  it('names a policy card the same way', async () => {
    let body = await policyRefusal('a policy card').text();
    expect(describeOAuthPolicyRefusal(body)).toMatch(
      /^An app connected with OAuth may not change a policy card\./,
    );
  });

  it('leaves any other failure alone', () => {
    expect(describeOAuthPolicyRefusal('Forbidden')).toBeUndefined();
  });
});

describe('the help of a command an OAuth profile refuses', () => {
  function helpOf(name: string): string {
    let program = new Command();
    registerRunCommand(program);
    registerCaptureCommand(program);
    registerBrowseCommand(program);
    let command = program.commands.find((c) => c.name() === name)!;
    let out = '';
    command.configureOutput({ writeOut: (text) => (out += text) });
    command.outputHelp();
    return out;
  }

  it('says, before anyone runs it, what needs a profile signed in with Matrix', () => {
    expect(helpOf('run-command')).toContain(
      "Needs a profile signed in with Matrix: the realm server doesn't let an OAuth token run commands yet.",
    );
    expect(helpOf('capture')).toContain(
      "Needs a profile signed in with Matrix: the realm server doesn't let an OAuth token capture cards yet.",
    );
    expect(helpOf('browse')).toContain(
      'On a profile signed in with OAuth, the app opens as the profile',
    );
  });
});
