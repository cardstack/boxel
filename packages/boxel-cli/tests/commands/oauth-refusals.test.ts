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

  it('refuses boxel capture --url-only', async () => {
    let result = await capture(`${REALM_URL}Card/1`, {
      profileManager: pm,
      urlOnly: true,
    });

    expect(result).toEqual({
      ok: false,
      captures: [],
      error: OAUTH_REFUSALS.captureUrlOnly,
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

  it('suggests a Matrix profile when browse refuses', () => {
    expect(OAUTH_REFUSALS.browse).toContain(
      '`boxel profile add` without --oauth',
    );
  });
});

// The bearer challenge a realm server sends with a `403` when the OAuth
// connection doesn't hold a scope the route needs.
function insufficientScope(scope: string): Response {
  return new Response(JSON.stringify({ error: 'insufficient_scope' }), {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${scope}"`,
    },
  });
}

describe('commands an OAuth profile runs with its access token', () => {
  let dir: string;
  let pm: ProfileManager;
  let requests: { url: string; authorization: string | null; body: unknown }[];
  let respond: (url: string) => Response;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-oauth-commands-'));
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
    requests = [];
    respond = () => new Response('unexpected request', { status: 500 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        let url = input instanceof Request ? input.url : String(input);
        let headers = new Headers(init?.headers);
        requests.push({
          url,
          authorization: headers.get('Authorization'),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return respond(url);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function commandResult(): Response {
    return new Response(
      JSON.stringify({
        data: {
          type: 'run-command-result',
          attributes: { status: 'ready', cardResultString: '{"ok":true}' },
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/vnd.api+json' } },
    );
  }

  it('sends boxel run-command with the access token', async () => {
    respond = commandResult;

    let result = await runCommand('example-command', REALM_URL, {
      profileManager: pm,
    });

    expect(result).toEqual({
      status: 'ready',
      result: '{"ok":true}',
      error: null,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `${REALM_SERVER_URL}_run-command`,
      authorization: 'Bearer access-token-placeholder',
    });
  });

  it("sends the library's runCommand with the access token", async () => {
    respond = commandResult;

    let result = await new BoxelCLIClient(pm).runCommand(
      REALM_SERVER_URL,
      REALM_URL,
      'example-command',
    );

    expect(result.status).toBe('ready');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `${REALM_SERVER_URL}_run-command`,
      authorization: 'Bearer access-token-placeholder',
    });
  });

  it('says which access a command needs when the connection only reads', async () => {
    respond = () => insufficientScope('boxel:write');
    let expected =
      "Running a command needs a connection that allows boxel:write, and this profile's OAuth connection doesn't. " +
      'Run `boxel profile add --oauth` again and allow it.';

    expect(
      await runCommand('example-command', REALM_URL, { profileManager: pm }),
    ).toEqual({ status: 'error', error: expected });
    expect(
      await new BoxelCLIClient(pm).runCommand(
        REALM_SERVER_URL,
        REALM_URL,
        'example-command',
      ),
    ).toEqual({ status: 'error', error: expected });
  });

  it('captures a card with the access token and saves the bytes it answers with', async () => {
    let bytes = Buffer.from('capture bytes');
    respond = () =>
      new Response(
        JSON.stringify({
          data: {
            type: 'capture-result',
            attributes: {
              status: 'ready',
              contentType: 'image/png',
              captures: [
                {
                  name: null,
                  url: null,
                  width: 800,
                  height: 600,
                  deviceScaleFactor: 1,
                  base64: bytes.toString('base64'),
                },
              ],
            },
          },
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/vnd.api+json' },
        },
      );
    let out = path.join(dir, 'captures');

    let result = await capture(`${REALM_URL}Card/1`, {
      profileManager: pm,
      realm: REALM_URL,
      out,
    });

    expect(result.ok).toBe(true);
    expect(result.captures).toHaveLength(1);
    expect(result.captures[0]).toMatchObject({ status: 'ok', url: null });
    expect(fs.readFileSync(result.captures[0].file!)).toEqual(bytes);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `${REALM_SERVER_URL}_capture`,
      authorization: 'Bearer access-token-placeholder',
    });
  });

  it('says which access a capture needs when the connection lacks it', async () => {
    respond = () => insufficientScope('boxel:read');

    let result = await capture(`${REALM_URL}Card/1`, {
      profileManager: pm,
      realm: REALM_URL,
      out: path.join(dir, 'captures'),
    });

    expect(result.ok).toBe(false);
    expect(result.captures[0].error).toBe(
      "Capturing a card needs a connection that allows boxel:read, and this profile's OAuth connection doesn't. " +
        'Run `boxel profile add --oauth` again and allow it.',
    );
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

describe('the help of a command whose use an OAuth profile limits', () => {
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

  it('says, before anyone runs it, what a profile signed in with OAuth needs or lacks', () => {
    expect(helpOf('run-command')).toContain(
      'On a profile signed in with OAuth, running a command needs the connection to allow writing (boxel:write).',
    );
    expect(helpOf('capture')).toContain(
      "--url-only doesn't work on a profile signed in with OAuth",
    );
    expect(helpOf('browse')).toContain(
      'Signing a browser in needs a profile signed in with Matrix',
    );
  });
});
