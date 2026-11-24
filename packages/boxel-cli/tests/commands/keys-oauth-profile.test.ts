import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keysSignIn, keysStatus } from '../../src/commands/keys/index.ts';
import {
  context,
  endHeldSecureSessions,
  keysList,
  ordinaryToken,
  runKeysCommand,
  secureToken,
} from '../../src/commands/keys/manage.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';

const USER = '@example-user:example.test';
const REALM_SERVER = 'https://realms.example.test/';
const SECURE_ORIGIN = 'https://secure.example.test/';
const SESSION = 'secure-session-placeholder';
const realFetch = globalThis.fetch;

interface Recorded {
  method: string;
  path: string;
  authorization: string | null;
}

// A realm server for keys calls, recording each request with the credential
// it carried.
function realmServer({ signOutStatus = 204 }: { signOutStatus?: number } = {}) {
  let requests: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      let parsed = new URL(url);
      let method = init.method ?? 'GET';
      requests.push({
        method,
        path: parsed.pathname,
        authorization: new Headers(init.headers).get('Authorization'),
      });
      if (parsed.pathname === '/_secure-origin') {
        return Response.json({ data: { attributes: { url: SECURE_ORIGIN } } });
      }
      if (parsed.pathname === '/_secure-session' && method === 'DELETE') {
        return new Response(null, { status: signOutStatus });
      }
      if (parsed.pathname === '/_user-keys') {
        return Response.json({ data: [] });
      }
      return new Response(null, { status: 500 });
    }),
  );
  return requests;
}

// The browser: signs the profile's account in on the secure origin and posts
// the session back to the CLI's loopback.
function browser(userId = USER) {
  return vi.fn(async (signInUrl: string) => {
    let url = new URL(signInUrl);
    let port = url.searchParams.get('port');
    let state = url.searchParams.get('state')!;
    void realFetch(`http://127.0.0.1:${port}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        state,
        secure_session: SESSION,
        user_id: userId,
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      }).toString(),
    });
    return true;
  });
}

describe('boxel keys on a profile signed in with OAuth', () => {
  let configDir: string;
  let manager: ProfileManager;

  beforeEach(() => {
    configDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-keys-oauth-'));
    manager = new ProfileManager(configDir);
    manager.addOAuthProfile(
      USER,
      {
        issuer: REALM_SERVER.replace(/\/$/, ''),
        tokenEndpoint: `${REALM_SERVER}_oauth-provider/token`,
        accessToken: 'access-token-placeholder',
        refreshToken: 'refresh-token-placeholder',
        accessExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        connectionEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      {
        matrixUrl: 'https://matrix.example.test/',
        realmServerUrl: REALM_SERVER,
      },
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await endHeldSecureSessions();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.exitCode = undefined;
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function savedProfile() {
    return JSON.parse(fs.readFileSync(join(configDir, 'profiles.json'), 'utf8'))
      .profiles[USER];
  }

  it('signs in through the browser for a read, uses that session, ends it when done and keeps none', async () => {
    let requests = realmServer();
    let openBrowserFn = browser();

    await runKeysCommand(false, () =>
      keysList({ profileManager: manager, openBrowserFn }),
    );

    expect(process.exitCode).toBeUndefined();
    expect(openBrowserFn).toHaveBeenCalledTimes(1);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /_secure-origin',
      'GET /_user-keys',
      'DELETE /_secure-session',
    ]);
    expect(requests[1].authorization).toContain(SESSION);
    expect(requests[2].authorization).toContain(SESSION);
    // The OAuth token never reaches key management.
    expect(
      requests.some((r) =>
        r.authorization?.includes('access-token-placeholder'),
      ),
    ).toBe(false);
    expect(savedProfile().secureSession).toBeUndefined();
  });

  it('signs in once for a command that makes several keys calls', async () => {
    realmServer();
    let openBrowserFn = browser();
    let ctx = context(false, { profileManager: manager, openBrowserFn });

    let tokens = [
      await ordinaryToken(ctx),
      await secureToken(ctx),
      await ordinaryToken(ctx),
    ];

    expect(tokens).toEqual([SESSION, SESSION, SESSION]);
    expect(openBrowserFn).toHaveBeenCalledTimes(1);
  });

  it('refuses without a terminal, before asking the server anything', async () => {
    let requests = realmServer();
    let openBrowserFn = vi.fn();

    await expect(
      keysList({ profileManager: manager, interactive: false }),
    ).rejects.toThrow(
      'On a profile signed in with OAuth, every `boxel keys` command signs in through the browser, so it needs a terminal.',
    );
    expect(openBrowserFn).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it("says when the session it used couldn't be ended", async () => {
    realmServer({ signOutStatus: 500 });
    let errors = vi.spyOn(console, 'error');

    await runKeysCommand(false, () =>
      keysList({ profileManager: manager, openBrowserFn: browser() }),
    );

    expect(errors.mock.calls.flat().join('\n')).toMatch(
      /Couldn't end the browser sign-in this command used.*It ends on its own at/,
    );
  });

  it('keys sign-in and keys status explain that each command signs in for itself', async () => {
    let requests = realmServer();
    let openBrowserFn = vi.fn();
    let log = vi.spyOn(console, 'log');

    await keysSignIn({ profileManager: manager, openBrowserFn });
    keysStatus({ profileManager: manager });

    expect(openBrowserFn).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      'This profile is signed in with OAuth, so each `boxel keys` command signs in through the browser for that command, and no session is kept.',
      'This profile is signed in with OAuth, so each `boxel keys` command signs in through the browser for that command, and no session is kept.',
    ]);
    expect(savedProfile().secureSession).toBeUndefined();
  });
});
