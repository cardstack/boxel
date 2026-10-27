import '../helpers/setup-realm-server.ts';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
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
import {
  keysAdd,
  keysDelete,
  keysList,
  keysReplace,
  keysShare,
  keysShares,
  keysShow,
  keysSwap,
  keysUnshare,
  runKeysCommand,
  type KeysCommandDeps,
} from '../../src/commands/keys/manage.ts';
import {
  deleteUserKey,
  mintKeyWriteTicket,
  replaceUserKey,
} from '../../src/lib/user-keys.ts';

const realmServerUrl = `${TEST_REALM_SERVER_URL}/`;
const realm = `${TEST_REALM_SERVER_URL}/test/`;
const secureOriginURL = new URL('https://secure.cli-keys-manage.test/secure');
const matrixId = `@${TEST_USERNAME}:localhost`;

// Stands in for the browser and the secure window: signs in on the secure
// origin as the window does (its requests carry the secure origin's
// `Origin`), and posts the session to the CLI's loopback listener as the
// window's form does.
async function actAsSecureWindow(link: string): Promise<boolean> {
  let url = new URL(link);
  expect(url.origin).toBe(secureOriginURL.origin);
  expect(url.pathname).toBe('/secure/cli-sign-in');
  let completed = await fetch(`${realmServerUrl}_secure-session`, {
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
          client: 'cli',
        },
      },
    }),
  });
  expect(completed.status).toBe(201);
  let session = ((await completed.json()) as any).data.attributes;
  let handedOver = await fetch(
    `http://127.0.0.1:${url.searchParams.get('port')}/callback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        state: url.searchParams.get('state')!,
        secure_session: session.token,
        user_id: session.user,
        expires_at: session.expiresAt,
      }).toString(),
    },
  );
  expect(handedOver.status).toBe(200);
  return true;
}

function stdinWith(text: string): NodeJS.ReadStream {
  let stdin = new PassThrough();
  stdin.end(text);
  return stdin as unknown as NodeJS.ReadStream;
}

// What a command prints to stdout under `--json`.
async function jsonOutput(fn: () => Promise<unknown>): Promise<any> {
  let out = '';
  let spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  try {
    await runKeysCommand(true, fn);
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(out);
}

describe('boxel keys: managing keys and shares (integration)', () => {
  let configDir: string;
  let pm: ProfileManager;
  let deps: KeysCommandDeps;

  beforeAll(async () => {
    installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
    await ensureMatrixAdminUser();
    await startTestRealmServer({ secureOriginURL });
    configDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-keys-manage-'));
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
    deps = { profileManager: pm, openBrowserFn: actAsSecureWindow };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await stopTestRealmServer();
    resetSecretsAtRest();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("refuses every change with only the CLI's ordinary session", async () => {
    let ordinary = await pm.getOrRefreshServerToken();
    for (let target of [
      { action: 'add' as const },
      { action: 'share' as const, keyId: crypto.randomUUID(), realm },
    ]) {
      await expect(
        mintKeyWriteTicket(realmServerUrl, ordinary, target),
      ).rejects.toMatchObject({ status: 403 });
    }
    await expect(
      keysAdd('ordinary', {
        ...deps,
        interactive: false,
        openBrowserFn: undefined,
        stdin: true,
        input: stdinWith('sk-ordinary\n'),
      }),
    ).rejects.toThrow(/sign in through the browser/);
    expect(await keysList({ profileManager: pm })).toEqual([]);
  });

  it('signs in through the secure origin on the first change, then adds, lists, shows and replaces a key', async () => {
    expect(pm.getSecureSession()).toBeUndefined();
    let added = await keysAdd('weather', {
      ...deps,
      stdin: true,
      input: stdinWith('sk-weather-one\n'),
    });
    expect(pm.getSecureSession()?.userId).toBe(matrixId);
    expect(added).toMatchObject({ name: 'weather', state: 'active' });

    let listed = await jsonOutput(() => keysList({ ...deps, json: true }));
    expect(listed.map((key: any) => key.name)).toEqual(['weather']);
    expect(JSON.stringify(listed)).not.toContain('sk-weather');

    let file = join(configDir, 'weather-key');
    fs.writeFileSync(file, 'sk-weather-two\n');
    let replaced = await keysReplace('weather', { ...deps, keyFile: file });
    expect(replaced.id).toBe(added.id);
    expect(Date.parse(replaced.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(added.updatedAt),
    );

    let shown = await keysShow('weather', deps);
    expect(shown.key.id).toBe(added.id);
    expect(shown.shares).toEqual([]);
  });

  it('shares a key into a realm, lists its shares, swaps a key into a suspended share and unshares it', async () => {
    let backup = await keysAdd('weather-backup', {
      ...deps,
      stdin: true,
      input: stdinWith('sk-weather-backup\n'),
    });
    let share = await keysShare('weather', {
      ...deps,
      realm,
      as: 'forecast',
    });
    expect(share).toMatchObject({
      realm,
      label: 'forecast',
      state: 'active',
    });
    expect((await keysShow('weather', deps)).shares.map((s) => s.id)).toEqual([
      share.id,
    ]);
    let shares = await keysShares({ ...deps, realm });
    expect(shares.map((s) => [s.label, s.owner, s.state])).toEqual([
      ['forecast', matrixId, 'active'],
    ]);

    // A writer suspends the share; swapping a key in resumes it.
    let suspended = await fetch(
      `${realmServerUrl}_key-shares/${share.id}/suspend`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await pm.getOrRefreshServerToken()}`,
        },
      },
    );
    expect(suspended.status).toBe(200);
    let swapped = await keysSwap('forecast', {
      ...deps,
      realm,
      key: 'weather-backup',
    });
    expect(swapped).toMatchObject({
      id: share.id,
      state: 'active',
      keyId: backup.id,
    });

    let unshared = await keysUnshare('forecast', { ...deps, realm });
    expect(unshared.id).toBe(share.id);
    expect(await keysShares({ ...deps, realm })).toEqual([]);
  });

  it('deletes a key after listing the shares it suspends', async () => {
    let share = await keysShare('weather', { ...deps, realm });
    expect(share.label).toBe('weather');
    let confirmFn = vi.fn(async () => true);
    let result = await keysDelete('weather', { ...deps, confirmFn });
    expect(confirmFn).toHaveBeenCalledOnce();
    expect(result.suspended.map((s) => s.id)).toEqual([share.id]);
    let [after] = await keysShares({ ...deps, realm });
    expect(after).toMatchObject({
      id: share.id,
      state: 'suspended',
      suspensionReason: 'key-deleted',
    });
    expect((await keysList({ profileManager: pm })).map((k) => k.name)).toEqual(
      ['weather-backup'],
    );
    await keysUnshare('weather', { ...deps, realm });
  });

  it('spends a ticket only on the change it was minted for', async () => {
    let token = pm.getSecureSession()!.token;
    let [backup] = await keysList({ profileManager: pm });
    let other = await keysAdd('other', {
      ...deps,
      stdin: true,
      input: stdinWith('sk-other\n'),
    });

    let addTicket = await mintKeyWriteTicket(realmServerUrl, token, {
      action: 'add',
    });
    await expect(
      deleteUserKey(realmServerUrl, token, {
        keyId: other.id,
        ticket: addTicket,
      }),
    ).rejects.toMatchObject({ status: 403 });

    let deleteOther = await mintKeyWriteTicket(realmServerUrl, token, {
      action: 'delete',
      keyId: other.id,
    });
    await expect(
      deleteUserKey(realmServerUrl, token, {
        keyId: backup.id,
        ticket: deleteOther,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      replaceUserKey(realmServerUrl, token, {
        keyId: other.id,
        value: 'sk-replaced',
        ticket: deleteOther,
      }),
    ).rejects.toMatchObject({ status: 403 });

    // Refused elsewhere, the ticket still does the one change it names.
    await deleteUserKey(realmServerUrl, token, {
      keyId: other.id,
      ticket: deleteOther,
    });
    expect((await keysList({ profileManager: pm })).map((k) => k.name)).toEqual(
      ['weather-backup'],
    );
  });

  it("prints a refusal's status and the server's errors unchanged under --json", async () => {
    let output = await jsonOutput(() =>
      keysAdd('weather-backup', {
        ...deps,
        json: true,
        stdin: true,
        input: stdinWith('sk-duplicate\n'),
      }),
    );
    process.exitCode = undefined;
    expect(output.error.status).toBe(409);
    expect(output.error.errors).toEqual([expect.any(String)]);
    expect(output.error.reason).toBe(output.error.errors[0]);

    let notWriter = await jsonOutput(() =>
      keysShares({
        ...deps,
        json: true,
        realm: `${TEST_REALM_SERVER_URL}/nowhere/`,
      }),
    );
    process.exitCode = undefined;
    expect(notWriter.error.status).toBe(403);
  });
});
