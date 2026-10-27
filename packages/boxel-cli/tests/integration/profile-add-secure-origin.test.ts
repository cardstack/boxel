import '../helpers/setup-realm-server.ts';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
} from '#realm-server/lib/secrets-at-rest/index';
// Signing in on the secure origin drives Synapse's admin API.
import { ensureMatrixAdminUser } from '#realm-server/tests/helpers/index';
import {
  startTestRealmServer,
  stopTestRealmServer,
  TEST_REALM_SERVER_URL,
  TEST_USERNAME,
  TEST_PASSWORD,
  matrixURL,
} from '../helpers/integration.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import { addProfile, resolveEnvironment } from '../../src/commands/profile.ts';
import { secureOriginForProfiles } from '../../src/lib/secure-session.ts';
import { addUserKey } from '../../src/lib/user-keys.ts';
import { browserLogin } from '../../src/lib/sso-login.ts';
import { requestLoginToken } from '../../src/lib/auth.ts';
import { pull } from '../../src/commands/realm/pull.ts';

const realmServerUrl = `${TEST_REALM_SERVER_URL}/`;
const secureOriginURL = new URL('https://secure.cli-profile.test/secure');
const matrixId = `@${TEST_USERNAME}:localhost`;
const JSON_API = 'application/vnd.api+json';

const environment = resolveEnvironment({
  matrixUrl: matrixURL.href,
  realmServerUrl,
}).environment;

// What the secure origin's `cli-auth` page does once the user has signed in,
// with the realm server answering it as it answers the page: its requests
// carry the secure origin's `Origin`.
async function signInOnSecureOrigin() {
  let headers = { 'Content-Type': JSON_API, Origin: secureOriginURL.origin };
  let signedIn = await fetch(`${realmServerUrl}_secure-session`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: {
        type: 'secure-session',
        attributes: {
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
          client: 'cli',
        },
      },
    }),
  });
  expect(signedIn.status).toBe(201);
  let session = ((await signedIn.json()) as any).data.attributes;
  let minted = await fetch(`${realmServerUrl}_secure-session/login-token`, {
    method: 'POST',
    headers: { ...headers, Authorization: `Bearer ${session.token}` },
  });
  expect(minted.status).toBe(201);
  let { loginToken } = ((await minted.json()) as any).data.attributes;
  return { session, loginToken };
}

// Matrix mints a user one login token a minute, so each sign-in here waits
// out the last one's minute.
let lastMint = 0;
async function waitForMintWindow() {
  let wait = lastMint + 61_000 - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastMint = Date.now();
}

describe('boxel profile add on the secure origin (integration)', () => {
  let configDir: string;

  beforeAll(async () => {
    installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
    await ensureMatrixAdminUser();
    await startTestRealmServer({
      secureOriginURL,
      fileSystem: { 'hello.gts': 'export const hello = "world";\n' },
    });
    // The account signs in once the ordinary way, as one made in the app
    // has, so the realm server knows it.
    configDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-profile-'));
    let pm = new ProfileManager(configDir);
    await pm.addProfile(
      matrixId,
      TEST_PASSWORD,
      'Existing',
      matrixURL.href,
      realmServerUrl,
    );
    await pm.getOrRefreshServerToken();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await stopTestRealmServer();
    resetSecretsAtRest();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('the realm server says its secure origin signs profiles in', async () => {
    expect(await secureOriginForProfiles(realmServerUrl)).toBe(
      secureOriginURL.href,
    );
  });

  it('keeps an existing profile working, with no new sign-in: it pulls a realm', async () => {
    let pm = new ProfileManager(configDir);
    let before = pm.getProfile(matrixId)!;
    let localDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-pull-'));
    try {
      let result = await pull(`${TEST_REALM_SERVER_URL}/test/`, localDir, {
        profileManager: pm,
      });
      expect(result.error).toBeUndefined();
      expect(result.files).toContain('hello.gts');
    } finally {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
    let after = new ProfileManager(configDir).getProfile(matrixId)!;
    expect(after.matrixAccessToken).toBe(before.matrixAccessToken);
    expect(after.matrixDeviceId).toBe(before.matrixDeviceId);
  });

  it('signs a profile in with a password, without the browser, as -u/-p, --no-browser and migrate do', async () => {
    // Each of them ends in `addProfile`'s direct Matrix password login.
    let dir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-password-'));
    try {
      let pm = new ProfileManager(dir);
      await pm.addProfile(
        matrixId,
        TEST_PASSWORD,
        'Password',
        matrixURL.href,
        realmServerUrl,
      );
      expect(await pm.getOrRefreshServerToken()).toBeTruthy();
      expect(pm.getProfile(matrixId)!.secureSession).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('signs in again with the password when the stored Matrix token is rejected', async () => {
    let dir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-reauth-'));
    try {
      let pm = new ProfileManager(dir, {
        isTty: () => true,
        promptPassword: async () => TEST_PASSWORD,
      });
      await pm.addProfile(
        matrixId,
        TEST_PASSWORD,
        'Re-auth',
        matrixURL.href,
        realmServerUrl,
      );
      let { accessToken } = pm.getStoredMatrixAuth();
      let loggedOut = await fetch(
        new URL('_matrix/client/v3/logout', matrixURL).href,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } },
      );
      expect(loggedOut.status).toBe(200);
      expect(await pm.refreshServerToken()).toBeTruthy();
      expect(pm.getStoredMatrixAuth().accessToken).not.toBe(accessToken);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mints a login token for the app from the profile's own Matrix device, as browse does", async () => {
    await waitForMintWindow();
    let pm = new ProfileManager(configDir);
    let { loginToken } = await requestLoginToken(pm.getStoredMatrixAuth());
    expect(loginToken).toBeTruthy();
  });

  it('adds a profile with a Matrix device and a secure session from one sign-in', async () => {
    await waitForMintWindow();
    let dir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-profile-new-'));
    try {
      let pm = new ProfileManager(dir);
      let opened: URL | undefined;
      await addProfile(pm, environment, true, {
        isTty: () => false,
        browserLogin: (options) =>
          browserLogin({
            ...options,
            log: () => {},
            openBrowserFn: async (link) => {
              opened = new URL(link);
              let { session, loginToken } = await signInOnSecureOrigin();
              let handedOver = await fetch(
                `http://127.0.0.1:${opened.searchParams.get('port')}/callback`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                  body: new URLSearchParams({
                    state: opened.searchParams.get('state')!,
                    login_token: loginToken,
                    secure_session: session.token,
                    user_id: session.user,
                    expires_at: session.expiresAt,
                  }).toString(),
                },
              );
              expect(handedOver.status).toBe(200);
              return true;
            },
          }),
      });

      expect(opened!.origin).toBe(secureOriginURL.origin);
      expect(opened!.pathname).toBe('/secure/cli-auth');
      expect(opened!.searchParams.get('session')).toBe('secure');
      expect(opened!.search).not.toMatch(/localhost|127\.0\.0\.1/);

      let profile = pm.getProfile(matrixId)!;
      expect(profile.matrixDeviceId).toBeTruthy();
      expect(profile.matrixDeviceId).not.toBe(
        new ProfileManager(configDir).getProfile(matrixId)!.matrixDeviceId,
      );
      // The Matrix device works for realm commands...
      expect(await pm.getOrRefreshServerToken()).toBeTruthy();
      // ...and the secure session for `boxel keys`, with no separate sign-in.
      let secureSession = pm.getSecureSession()!;
      expect(secureSession.userId).toBe(matrixId);
      let key = await addUserKey(realmServerUrl, secureSession.token, {
        name: 'from-profile-add',
        value: 'sk-from-profile-add',
      });
      expect(key.name).toBe('from-profile-add');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('redeems a login token sent in the query, as every released CLI accepts it', async () => {
    await waitForMintWindow();
    // What the `cli-auth` page sends a CLI that can't hold a secure session:
    // a navigation to its listener with the login token and state in the
    // query. Ending the session it signed in is the page's part, covered by
    // the secure origin's own tests.
    let auth = await browserLogin({
      matrixUrl: matrixURL.href,
      hostUrl: realmServerUrl,
      log: () => {},
      openBrowserFn: async (link) => {
        let url = new URL(link);
        expect(url.pathname).toBe('/cli-auth');
        let { loginToken } = await signInOnSecureOrigin();
        let target = new URL(
          `http://127.0.0.1:${url.searchParams.get('port')}/callback`,
        );
        target.searchParams.set('state', url.searchParams.get('state')!);
        target.searchParams.set('loginToken', loginToken);
        expect((await fetch(target.href)).status).toBe(200);
        return true;
      },
    });
    expect(auth.userId).toBe(matrixId);
    let whoami = await fetch(
      new URL('_matrix/client/v3/account/whoami', matrixURL).href,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } },
    );
    expect(whoami.status).toBe(200);
    expect(auth).not.toHaveProperty('secureSession');
  }, 120_000);
});
