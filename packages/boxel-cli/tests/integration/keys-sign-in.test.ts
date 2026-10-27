import '../helpers/setup-realm-server.ts';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
import { keysSignIn, keysSignOut } from '../../src/commands/keys/index.ts';
import { addUserKey } from '../../src/lib/user-keys.ts';

const realmServerUrl = `${TEST_REALM_SERVER_URL}/`;
const secureOriginURL = new URL('https://secure.cli-keys.test/secure');
const matrixId = `@${TEST_USERNAME}:localhost`;

// Stands in for the browser and the secure window: reads the CLI sign-in link
// the CLI opened, signs in on the secure origin as the window does (its
// requests carry the secure origin's `Origin`), and posts the session to the
// CLI's loopback listener as the window's form does.
async function actAsSecureWindow(link: string): Promise<boolean> {
  let url = new URL(link);
  expect(url.origin).toBe(secureOriginURL.origin);
  expect(url.pathname).toBe('/secure/cli-sign-in');
  expect(url.searchParams.get('user')).toBe(TEST_USERNAME);
  let port = url.searchParams.get('port');
  let state = url.searchParams.get('state')!;

  let headers = {
    'Content-Type': 'application/vnd.api+json',
    Origin: secureOriginURL.origin,
  };
  let completed = await fetch(`${realmServerUrl}_secure-session`, {
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
  expect(completed.status).toBe(201);
  let session = ((await completed.json()) as any).data.attributes;

  let handedOver = await fetch(`http://127.0.0.1:${port}/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      state,
      secure_session: session.token,
      user_id: session.user,
      expires_at: session.expiresAt,
    }).toString(),
  });
  expect(handedOver.status).toBe(200);
  return true;
}

describe('boxel keys sign-in (integration)', () => {
  let configDir: string;
  let pm: ProfileManager;

  beforeAll(async () => {
    installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
    await ensureMatrixAdminUser();
    await startTestRealmServer({ secureOriginURL });
    configDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-keys-'));
    pm = new ProfileManager(configDir);
    await pm.addProfile(
      matrixId,
      TEST_PASSWORD,
      'Keys Test',
      matrixURL.href,
      realmServerUrl,
    );
    // The ordinary sign-in's realm-server session, which also makes the user
    // known to the realm server.
    await pm.getOrRefreshServerToken();
  });

  afterAll(async () => {
    await stopTestRealmServer();
    resetSecretsAtRest();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("refuses to add a key with only the CLI's ordinary session", async () => {
    let ordinary = await pm.getOrRefreshServerToken();
    await expect(
      addUserKey(realmServerUrl, ordinary, {
        name: 'ordinary',
        value: 'sk-ordinary-session',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('signs in through the secure origin, then adds a key', async () => {
    await keysSignIn({
      profileManager: pm,
      openBrowserFn: actAsSecureWindow,
    });
    let session = pm.getSecureSession();
    expect(session?.userId).toBe(matrixId);

    let key = await addUserKey(realmServerUrl, session!.token, {
      name: 'weather',
      value: 'sk-secure-session',
    });
    expect(key.name).toBe('weather');

    await keysSignOut({ profileManager: pm });
    expect(pm.getSecureSession()).toBeUndefined();
    await expect(
      addUserKey(realmServerUrl, session!.token, {
        name: 'after-sign-out',
        value: 'sk-after-sign-out',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
