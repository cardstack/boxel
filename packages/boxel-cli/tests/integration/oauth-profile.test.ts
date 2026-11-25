import '../helpers/setup-realm-server.ts';
import * as fs from 'fs';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// The workspace list and display name are read through Synapse's admin API.
import { ensureMatrixAdminUser } from '#realm-server/tests/helpers/index';
import { testOAuthProviderConfig } from '#realm-server/tests/helpers/oauth-provider';
import {
  createTestHome,
  matrixURL,
  reloadProfile,
  startTestRealmServer,
  stopTestRealmServer,
  TEST_PASSWORD,
  TEST_REALM_SERVER_URL,
  TEST_USERNAME,
  uniqueRealmName,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';
import {
  addOAuthProfile,
  resolveEnvironment,
} from '../../src/commands/profile.ts';
import { createRealm } from '../../src/commands/realm/create.ts';
import { listRealms } from '../../src/commands/realm/list.ts';
import { removeRealm } from '../../src/commands/realm/remove.ts';
import { OAuthNotOfferedError, oauthLogin } from '../../src/lib/oauth-login.ts';
import type { ProfileManager } from '../../src/lib/profile-manager.ts';

const realmServerUrl = `${TEST_REALM_SERVER_URL}/`;
const secureOriginURL = new URL('https://secure.cli-oauth.test/secure');
const matrixId = `@${TEST_USERNAME}:localhost`;
// A realm only the test user can read, so a request that reaches it proves
// the realm accepted the OAuth token.
const PRIVATE_REALM = `${TEST_REALM_SERVER_URL}/private/`;

const environment = resolveEnvironment({
  matrixUrl: matrixURL.href,
  realmServerUrl,
}).environment;

// The browser the CLI opens: it signs the test user in on the secure origin,
// allows the app on the authorize page, follows the provider's redirects
// with the cookies a browser keeps, and lands on the CLI's loopback. Any
// failure is kept for the test to report, since the CLI only sees a timeout.
function consentingBrowser() {
  let failure: unknown;
  let cookies = new Map<string, string>();
  async function get(url: string): Promise<Response> {
    let response = await fetch(url, {
      redirect: 'manual',
      headers: {
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
    });
    for (let header of response.headers.getSetCookie()) {
      let [pair] = header.split(';');
      let index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  function redirectOf(response: Response, what: string): string {
    let location = response.headers.get('location');
    if (!location) {
      throw new Error(`${what}: ${response.status}, no redirect`);
    }
    return new URL(location, realmServerUrl).href;
  }
  async function drive(authorizeUrl: string) {
    let started = await get(authorizeUrl);
    let interaction = redirectOf(started, 'authorize');
    let uid = new URL(interaction).pathname.split('/').pop()!;

    let signedIn = await fetch(`${realmServerUrl}_secure-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Origin: secureOriginURL.origin,
      },
      body: JSON.stringify({
        data: {
          type: 'secure-session',
          attributes: {
            username: TEST_USERNAME,
            password: TEST_PASSWORD,
            client: 'window',
          },
        },
      }),
    });
    if (signedIn.status !== 201) {
      throw new Error(`secure sign-in: ${signedIn.status}`);
    }
    let session = ((await signedIn.json()) as any).data.attributes.token;

    let decided = await fetch(
      `${realmServerUrl}_oauth-provider/consent/${uid}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: secureOriginURL.origin,
          Authorization: `Bearer ${session}`,
        },
        body: JSON.stringify({ decision: 'allow', renew: true }),
      },
    );
    if (decided.status !== 201) {
      throw new Error(`consent: ${decided.status} ${await decided.text()}`);
    }
    let { ticket } = (await decided.json()) as { ticket: string };

    let finished = await get(
      `${realmServerUrl}_oauth-provider/interaction/${uid}/finish?${new URLSearchParams({ ticket })}`,
    );
    let resumed = await get(redirectOf(finished, 'finish'));
    let loopback = redirectOf(resumed, 'resume');
    await fetch(loopback);
  }
  return {
    openBrowserFn: vi.fn(async (url: string) => {
      void drive(url).catch((e) => {
        failure = e;
      });
      return true;
    }),
    failure: () => failure,
  };
}

async function signInWithOAuth(
  home: ReturnType<typeof createTestHome>,
): Promise<ProfileManager> {
  let browser = consentingBrowser();
  await addOAuthProfile(home.profileManager, environment, {
    isTty: () => false,
    oauthLogin: (options) =>
      oauthLogin({
        ...options,
        openBrowserFn: browser.openBrowserFn,
        log: () => {},
        timeoutMs: 30_000,
      }),
  });
  expect(browser.failure()).toBeUndefined();
  return reloadProfile(home.home);
}

describe('a profile signed in with OAuth (integration)', () => {
  let home: ReturnType<typeof createTestHome>;
  let pm: ProfileManager;

  beforeAll(async () => {
    await ensureMatrixAdminUser();
    await startTestRealmServer({
      secureOriginURL,
      oauthProvider: testOAuthProviderConfig(),
      realms: [
        {
          realmURL: new URL(PRIVATE_REALM),
          fileSystem: { 'hello.txt': 'hello from a private realm' },
          permissions: {
            [matrixId]: ['read', 'write', 'realm-owner'],
          },
        },
      ],
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    home = createTestHome();
    pm = await signInWithOAuth(home);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    home?.cleanup();
    await stopTestRealmServer();
  });

  it('keeps only the OAuth connection, in a file only its owner reads', () => {
    let profile = pm.getProfile(matrixId)!;
    expect(profile.oauth).toMatchObject({
      issuer: TEST_REALM_SERVER_URL,
      tokenEndpoint: `${TEST_REALM_SERVER_URL}/_oauth-provider/token`,
    });
    expect(profile.oauth!.refreshToken).toBeTruthy();
    expect(profile.matrixAccessToken).toBeUndefined();
    expect(profile.secureSession).toBeUndefined();
    let mode = fs.statSync(join(home.home, '.boxel-cli', 'profiles.json')).mode;
    expect(mode & 0o777).toBe(0o600);
  });

  it('reads a realm only its owner can, with the OAuth token', async () => {
    let response = await pm.authedRealmFetch(`${PRIVATE_REALM}hello.txt`, {
      headers: { Accept: 'application/vnd.card+source' },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello from a private realm');
    let anonymous = await fetch(`${PRIVATE_REALM}hello.txt`, {
      headers: { Accept: 'application/vnd.card+source' },
    });
    expect(anonymous.status).toBe(401);
  });

  it('gave the account a personal workspace, kept on the realm server', async () => {
    let listed = await listRealms({ profileManager: pm });
    expect(listed.error).toBeUndefined();
    expect(listed.realms.map((r) => r.url)).toContain(
      `${TEST_REALM_SERVER_URL}/${TEST_USERNAME}/personal/`,
    );
  });

  it('creates and removes a workspace, which the realm server lists and unlists', async () => {
    let name = uniqueRealmName();
    let created = await createRealm(name, 'OAuth workspace', {
      profileManager: pm,
    });
    expect(created.created).toBe(true);
    expect(await pm.getUserRealms()).toContain(created.realmUrl);

    let again = await createRealm(name, 'OAuth workspace', {
      profileManager: pm,
    });
    expect(again).toEqual({ realmUrl: created.realmUrl, created: false });

    let removed = await removeRealm({
      realmUrl: created.realmUrl,
      profileManager: pm,
    });
    expect(removed).toMatchObject({ removed: true, unlinked: true });
    expect(await pm.getUserRealms()).not.toContain(created.realmUrl);
  });

  it('keeps the connection when two boxel processes renew at once', async () => {
    // Both commands start with an access token they must renew, and both
    // read the same refresh token. Sent twice, it would end the connection.
    let file = join(home.home, '.boxel-cli', 'profiles.json');
    let config = JSON.parse(fs.readFileSync(file, 'utf8'));
    let before = config.profiles[matrixId].oauth;
    config.profiles[matrixId].oauth.accessExpiresAt = new Date(
      Date.now() - 1000,
    ).toISOString();
    fs.writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });

    let runs = await Promise.all(
      [1, 2].map(() =>
        runBoxel(['file', 'list', '--realm', PRIVATE_REALM], {
          home: home.home,
        }),
      ),
    );

    for (let run of runs) {
      expect(run.stderr).not.toMatch(/ended/);
      expect(run.ok).toBe(true);
      expect(run.stdout).toContain('hello.txt');
    }
    let after = reloadProfile(home.home).getProfile(matrixId)!.oauth!;
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(after.connectionEndsAt).toBe(before.connectionEndsAt);
    // The connection still renews.
    let third = await runBoxel(['file', 'list', '--realm', PRIVATE_REALM], {
      home: home.home,
    });
    expect(third.ok).toBe(true);
  });

  it('refuses boxel run-command before making a request', async () => {
    let run = await runBoxel(
      ['run-command', 'example-command', '--realm', PRIVATE_REALM],
      { home: home.home },
    );
    expect(run.ok).toBe(false);
    expect(`${run.stdout}${run.stderr}`).toContain(
      "Running a command doesn't work on a profile signed in with OAuth yet",
    );
  });
});

describe('a realm server that offers no OAuth sign-in (integration)', () => {
  beforeAll(async () => {
    await startTestRealmServer({ fileSystem: {} });
  });

  afterAll(async () => {
    await stopTestRealmServer();
  });

  it('stops --oauth before opening a browser', async () => {
    let openBrowserFn = vi.fn(async () => true);
    await expect(
      oauthLogin({ realmServerUrl, openBrowserFn, log: () => {} }),
    ).rejects.toBeInstanceOf(OAuthNotOfferedError);
    expect(openBrowserFn).not.toHaveBeenCalled();
  });
});
