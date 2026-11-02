import '../helpers/setup-realm-server.ts';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rri } from '@cardstack/runtime-common';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
} from '#realm-server/lib/secrets-at-rest/index';
import {
  configureOutbound,
  resetOutbound,
} from '#realm-server/lib/outbound/client';
import {
  ensureMatrixAdminUser,
  getTestPrerenderer,
  stopTestPrerenderServer,
} from '#realm-server/tests/helpers/index';
import { secureSessionAuth } from '#realm-server/tests/helpers/secure-session';
import {
  startStubVendor,
  type StubVendor,
} from '#realm-server/tests/helpers/stub-vendor';
import {
  getTestDbAdapter,
  setupJwtTestProfile,
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
  keysLimits,
  keysShare,
  runKeysCommand,
  type KeysCommandDeps,
} from '../../src/commands/keys/manage.ts';
import { invokeOperation } from '../../src/commands/operations.ts';
import { SecureSessionRequestError } from '../../src/lib/secure-session.ts';

// ============================================================================
// Setting a key's limits from the terminal, against the stub vendor: limits
// set on a personal key and on a share hold the next calls invoked from the
// CLI to them, `default` puts a limit back to the platform's, and a realm's
// other direct writer can read a share's limits but is refused changing them.
//
// The approval API approves a binding for pipelines only, so the test turns
// each binding interactive in the database, as allowing interactive use
// would: limits count interactive calls only.
// ============================================================================

const realmServerUrl = `${TEST_REALM_SERVER_URL}/`;
const realm = `${TEST_REALM_SERVER_URL}/test/`;
const secureOriginURL = new URL('https://secure.cli-keys-limits.test/secure');
const matrixId = `@${TEST_USERNAME}:localhost`;
// Another direct writer of the realm, who doesn't own the key.
const writerId = `@${TEST_USERNAME}-writer:localhost`;
const KEY_VALUE = 'sk-limits-test-8a7b6c5d';

function stdinWith(text: string): NodeJS.ReadStream {
  let stdin = new PassThrough();
  stdin.end(text);
  return stdin as unknown as NodeJS.ReadStream;
}

function serviceSource(vendorURL: string) {
  return `
    import { CardDef } from "@cardstack/base/card-api";
    import { operation } from "@cardstack/base/operations";

    export class Service extends CardDef {
      @operation static mine = {
        base: 'callApi',
        label: 'Read with my key',
        url: '${vendorURL}/echo',
        headers: { authorization: 'Bearer {{userKey}}' },
      };

      @operation static shared = {
        base: 'callApi',
        label: 'Read with the realm’s key',
        url: '${vendorURL}/echo',
        headers: { authorization: 'Bearer {{apiKey}}' },
      };
    }
  `;
}

const SERVICE = () => ({ module: `${realm}service`, name: 'Service' });

describe('boxel keys limits (integration)', () => {
  let configDir: string;
  let writerConfigDir: string;
  let pm: ProfileManager;
  let writerPm: ProfileManager;
  let deps: KeysCommandDeps;
  let writerDeps: KeysCommandDeps;
  let vendor: StubVendor;
  let keyId: string;
  let shareId: string;

  // A secure session for `user`, as signing in on the secure origin from the
  // CLI leaves the profile holding.
  async function giveSecureSession(profile: ProfileManager, user: string) {
    let auth = await secureSessionAuth(getTestDbAdapter()!, user, {
      client: 'cli',
    });
    profile.setSecureSession({
      token: auth.replace(/^Bearer /, ''),
      userId: user,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
  }

  // Approves `operation` with `slot` filled, then turns its bindings
  // interactive, as allowing interactive use would.
  async function approveInteractive(
    operation: string,
    fill: { keyId?: string; shareId?: string },
  ) {
    let auth = await secureSessionAuth(getTestDbAdapter()!, matrixId);
    let preview = new URL(`${realmServerUrl}_key-bindings/preview`);
    preview.searchParams.set('realm', realm);
    preview.searchParams.set('module', SERVICE().module);
    preview.searchParams.set('name', SERVICE().name);
    preview.searchParams.set('operation', operation);
    let shown = (
      (await (
        await fetch(preview, {
          headers: { Authorization: auth, Accept: 'application/vnd.api+json' },
        })
      ).json()) as any
    ).data.attributes;
    let response = await fetch(`${realmServerUrl}_key-bindings`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        Origin: secureOriginURL.origin,
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'key-binding-approval',
          attributes: {
            realm,
            operations: [
              {
                codeRef: SERVICE(),
                operation,
                expectedDestination: shown.destination,
                slots: Object.fromEntries(
                  shown.slots.map(
                    (s: { slot: string; fingerprint: string }) => [
                      s.slot,
                      { ...fill, expectedFingerprint: s.fingerprint },
                    ],
                  ),
                ),
              },
            ],
          },
        },
      }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    await getTestDbAdapter()!.execute(
      `UPDATE key_bindings SET interactive = true WHERE operation_name = $1`,
      { bind: [operation] },
    );
  }

  function invoke(operation: string) {
    return invokeOperation(`${realm}service#Service`, operation, {
      realm,
      profileManager: pm,
    });
  }

  function codeOf(result: { errors?: unknown[] }) {
    return (result.errors?.[0] as { code?: string } | undefined)?.code;
  }

  beforeAll(async () => {
    installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
    configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
    await ensureMatrixAdminUser();
    vendor = await startStubVendor();
    await startTestRealmServer({
      secureOriginURL,
      prerenderer: await getTestPrerenderer(),
      realms: [
        {
          realmURL: new URL(realm),
          fileSystem: {
            'service.gts': serviceSource(vendor.url),
            'the-service.json': {
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: rri(`${realm}service`),
                    name: 'Service',
                  },
                },
              },
            },
          },
          permissions: {
            [matrixId]: ['read', 'write', 'realm-owner'],
            [writerId]: ['read', 'write'],
          },
        },
      ],
    });

    configDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-keys-limits-'));
    pm = new ProfileManager(configDir);
    await pm.addProfile(
      matrixId,
      TEST_PASSWORD,
      'Keys Limits Test',
      matrixURL.href,
      realmServerUrl,
    );
    await pm.getOrRefreshServerToken();
    await giveSecureSession(pm, matrixId);
    deps = { profileManager: pm, interactive: false };

    writerConfigDir = fs.mkdtempSync(
      join(os.tmpdir(), 'boxel-cli-keys-limits-writer-'),
    );
    writerPm = new ProfileManager(writerConfigDir);
    await setupJwtTestProfile(writerPm, { user: writerId, realmServerUrl });
    await giveSecureSession(writerPm, writerId);
    writerDeps = { profileManager: writerPm, interactive: false };

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    keyId = (
      await keysAdd('my key', {
        ...deps,
        stdin: true,
        input: stdinWith(`${KEY_VALUE}\n`),
      })
    ).id;
    shareId = (await keysShare('my key', { ...deps, realm, as: 'Vendor' })).id;
    await approveInteractive('mine', { keyId });
    await approveInteractive('shared', { shareId });
  }, 600_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      await stopTestRealmServer();
    } finally {
      await stopTestPrerenderServer();
      await vendor?.close();
      resetOutbound();
      resetSecretsAtRest();
      fs.rmSync(configDir, { recursive: true, force: true });
      fs.rmSync(writerConfigDir, { recursive: true, force: true });
    }
  }, 600_000);

  it("holds the next invokes to a personal key's rate", async () => {
    let limits = await keysLimits('my key', { ...deps, rate: '2/0.001' });
    expect(limits).toMatchObject({ rateBurst: 2, rateRefillPerMinute: 0.001 });

    let sentBefore = vendor.requests.length;
    expect((await invoke('mine')).status).toBe(200);
    expect((await invoke('mine')).status).toBe(200);
    let refused = await invoke('mine');
    expect(refused.status).toBe(429);
    expect(codeOf(refused)).toBe('rate-limited');
    expect(vendor.requests.length, 'the refused call sent nothing').toBe(
      sentBefore + 2,
    );
  });

  it("holds the next invoke to a personal key's daily budget, and default puts the limits back", async () => {
    // Two calls are spent today; a daily budget of two leaves none.
    await keysLimits('my key', {
      ...deps,
      rate: 'default/default',
      daily: '2',
    });
    let refused = await invoke('mine');
    expect(refused.status).toBe(429);
    expect(codeOf(refused)).toBe('over-budget');

    let shown = await keysLimits('my key', deps);
    expect(shown.dailyBudget).toBe(2);
    expect(shown.monthlyBudget, 'the monthly budget follows the daily').toBe(
      60,
    );

    let restored = await keysLimits('my key', { ...deps, daily: 'default' });
    expect(restored.dailyBudget).toBeGreaterThan(2);
    expect((await invoke('mine')).status).toBe(200);
  });

  it("holds the next invokes to a share's limits, set with --realm", async () => {
    let limits = await keysLimits('Vendor', {
      ...deps,
      realm,
      rate: '1/0.001',
      monthly: '500',
    });
    expect(limits).toMatchObject({
      rateBurst: 1,
      rateRefillPerMinute: 0.001,
      monthlyBudget: 500,
    });
    expect((await invoke('shared')).status).toBe(200);
    let refused = await invoke('shared');
    expect(refused.status).toBe(429);
    expect(codeOf(refused)).toBe('rate-limited');
  });

  it("lets another direct writer read a share's limits but not change them", async () => {
    let shown = await keysLimits('Vendor', { ...writerDeps, realm });
    expect(shown).toMatchObject({ rateBurst: 1, monthlyBudget: 500 });

    let refused = await keysLimits('Vendor', {
      ...writerDeps,
      realm,
      daily: '100000',
    }).catch((e) => e);
    expect(refused).toBeInstanceOf(SecureSessionRequestError);
    expect(refused.status).toBe(403);
    expect(
      (await keysLimits('Vendor', { ...deps, realm })).dailyBudget,
    ).not.toBe(100000);
  });

  it('refuses a limit that is not a number before asking the realm server', async () => {
    await expect(keysLimits('my key', { ...deps, rate: '25' })).rejects.toThrow(
      '--rate is <burst>/<refill per minute>',
    );
    await expect(
      keysLimits('my key', { ...deps, daily: 'lots' }),
    ).rejects.toThrow('--daily is a number, or default');
  });

  it("passes the realm server's refusal through under --json", async () => {
    let output: string[] = [];
    let log = vi
      .spyOn(console, 'log')
      .mockImplementation((line: string) => void output.push(line));
    try {
      await runKeysCommand(true, () =>
        keysLimits('my key', { ...deps, json: true, daily: '0' }),
      );
    } finally {
      log.mockImplementation(() => {});
      process.exitCode = undefined;
    }
    let { error } = JSON.parse(output.join('\n'));
    expect(error.status).toBe(400);
    expect(error.errors[0].detail ?? error.reason).toContain('dailyBudget');
  });
});
