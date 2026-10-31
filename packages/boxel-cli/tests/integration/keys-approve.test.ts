import '../helpers/setup-realm-server.ts';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rri } from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
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
  keysShow,
  type KeysCommandDeps,
} from '../../src/commands/keys/manage.ts';
import {
  keysApprove,
  keysPending,
  keysRevoke,
  keysUngrant,
} from '../../src/commands/keys/approve.ts';
import { invokeOperation } from '../../src/commands/operations.ts';
import { listOwnBindings } from '../../src/lib/key-bindings.ts';
import { SecureSessionRequestError } from '../../src/lib/secure-session.ts';

// ============================================================================
// Approving a card's operations from the terminal, against the stub vendor:
// an approval that grants the key a new destination is confirmed in the
// secure window and doesn't complete from the terminal alone; one that
// reuses the grant approves the class as one batch in the terminal; a
// changed request is listed as pending; revoking and removing the grant take
// the approvals away; and invoking from the CLI reaches the vendor.
// ============================================================================

const realmServerUrl = `${TEST_REALM_SERVER_URL}/`;
const realm = `${TEST_REALM_SERVER_URL}/test/`;
const secureOriginURL = new URL('https://secure.cli-keys-approve.test/secure');
const matrixId = `@${TEST_USERNAME}:localhost`;
const KEY_VALUE = 'sk-approve-test-4f3e2d1c';

function stdinWith(text: string): NodeJS.ReadStream {
  let stdin = new PassThrough();
  stdin.end(text);
  return stdin as unknown as NodeJS.ReadStream;
}

function serviceSource(vendorURL: string, { edited = false } = {}) {
  return `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { operation, params } from "@cardstack/base/operations";

    export class Service extends CardDef {
      @field title = contains(StringField);

      @operation static list = {
        base: 'callApi',
        label: 'List items',
        url: '${vendorURL}/echo',
        headers: { authorization: 'Bearer {{userKey}}' },
      };

      @operation static create = {
        base: 'callApi',
        label: 'Create an item',
        params: { name: StringField },
        method: 'POST',
        url: '${vendorURL}/echo',
        headers: { authorization: '${edited ? 'Token' : 'Bearer'} {{userKey}}' },
        json: { name: params('name') },
      };

      @operation static remove = {
        base: 'callApi',
        label: 'Remove an item',
        method: 'DELETE',
        url: '${vendorURL}/echo',
        headers: { authorization: 'Bearer {{userKey}}' },
      };

      @operation static ping = {
        base: 'callApi',
        label: 'Ping',
        url: '${vendorURL}/echo',
      };
    }
  `;
}

describe('boxel keys approve, revoke, pending, ungrant and operations invoke (integration)', () => {
  let configDir: string;
  let pm: ProfileManager;
  let deps: KeysCommandDeps;
  let vendor: StubVendor;
  let testRealm: Realm;
  let keyId: string;
  // The approve pages the CLI opened, and the bindings that existed when the
  // window was opened, before it approved anything.
  let windows: {
    url: URL;
    fragment: URLSearchParams;
    bindingsBefore: number;
  }[];

  async function signInOnSecureOrigin() {
    let response = await fetch(`${realmServerUrl}_secure-session`, {
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
    expect(response.status).toBe(201);
    return ((await response.json()) as any).data.attributes;
  }

  async function bindingCount() {
    let [{ count }] = (await getTestDbAdapter()!.execute(
      `SELECT COUNT(*)::int AS count FROM key_bindings`,
    )) as { count: number }[];
    return count;
  }

  // Stands in for the browser. The CLI's sign-in link signs in on the secure
  // origin and hands the session to the CLI's listener, as the window's form
  // does. The approve page signs in with the window's own session, builds
  // the card's batch, approves the operations the CLI named with the key it
  // named, and tells the CLI's listener the approval is made, as the page
  // does.
  async function browser(link: string): Promise<boolean> {
    let url = new URL(link);
    expect(url.origin).toBe(secureOriginURL.origin);
    if (url.pathname.endsWith('/cli-sign-in')) {
      let session = await signInOnSecureOrigin();
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
    expect(url.pathname).toBe(`${secureOriginURL.pathname}/approve`);
    let fragment = new URLSearchParams(url.hash.slice(1));
    windows.push({ url, fragment, bindingsBefore: await bindingCount() });
    void (async () => {
      let window = await secureSessionAuth(getTestDbAdapter()!, matrixId);
      let headers = {
        Authorization: window,
        Origin: secureOriginURL.origin,
        'Content-Type': 'application/vnd.api+json',
      };
      let batch = (
        (await (
          await fetch(`${realmServerUrl}_key-bindings/batch`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              data: {
                type: 'key-binding-batch',
                attributes: {
                  target: {
                    kind: 'type',
                    module: fragment.get('module'),
                    name: fragment.get('name'),
                    realm: fragment.get('realm'),
                  },
                },
              },
            }),
          })
        ).json()) as any
      ).data.attributes;
      let named = new Set(fragment.get('operations')!.split(','));
      let operations = batch.groups.flatMap((group: any) =>
        group.operations
          .filter((o: any) => named.has(o.name))
          .map((o: any) => ({
            codeRef: {
              module: batch.card.module,
              name: batch.card.exportName,
            },
            operation: o.name,
            expectedDestination: group.destination.href,
            slots: Object.fromEntries(
              o.slots.map((s: any) => [
                s.slot,
                {
                  keyId: fragment.get('key'),
                  expectedFingerprint: s.fingerprint,
                },
              ]),
            ),
          })),
      );
      let approved = await fetch(`${realmServerUrl}_key-bindings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: {
            type: 'key-binding-approval',
            attributes: { realm: batch.realm.url, operations },
          },
        }),
      });
      expect(approved.status, await approved.clone().text()).toBe(201);
      let told = await fetch(
        `http://127.0.0.1:${fragment.get('cli_port')}/callback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            state: fragment.get('cli_state')!,
            window_outcome: 'done',
          }).toString(),
        },
      );
      expect(told.status).toBe(200);
    })();
    return true;
  }

  beforeAll(async () => {
    installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
    configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
    await ensureMatrixAdminUser();
    vendor = await startStubVendor();
    let { realms } = await startTestRealmServer({
      secureOriginURL,
      prerenderer: await getTestPrerenderer(),
      fileSystem: {
        'service.gts': serviceSource(vendor.url),
        'the-service.json': {
          data: {
            type: 'card',
            attributes: { title: 'the service' },
            meta: {
              adoptsFrom: { module: rri(`${realm}service`), name: 'Service' },
            },
          },
        },
      },
    });
    testRealm = realms.find((r) => r.url === realm)!;
    configDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-keys-approve-'));
    pm = new ProfileManager(configDir);
    await pm.addProfile(
      matrixId,
      TEST_PASSWORD,
      'Keys Approve Test',
      matrixURL.href,
      realmServerUrl,
    );
    await pm.getOrRefreshServerToken();
    windows = [];
    deps = { profileManager: pm, openBrowserFn: browser };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let added = await keysAdd('my key', {
      ...deps,
      stdin: true,
      input: stdinWith(`${KEY_VALUE}\n`),
    });
    keyId = added.id;
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
    }
  }, 600_000);

  it('confirms an approval that grants the key a new destination in the secure window, not the terminal', async () => {
    let result = await keysApprove('my key', {
      ...deps,
      operation: 'service#Service.list',
      realm,
      yes: true,
    });
    expect(windows).toHaveLength(1);
    let [opened] = windows;
    expect(
      opened!.bindingsBefore,
      'the terminal approved nothing before the window did',
    ).toBe(0);
    expect(opened!.fragment.get('operations')).toBe('list');
    expect(opened!.fragment.get('key')).toBe(keyId);
    expect(opened!.fragment.get('operation')).toBe('list');
    expect(result.via).toBe('window');
    expect(result.approved.map((b) => b.operation)).toEqual(['list']);

    let { key } = await keysShow('my key', deps);
    expect(key.grants).toEqual([
      expect.objectContaining({
        destination: `${vendor.url}/`,
        approvedVia: 'window',
      }),
    ]);
  });

  it('refuses interactive use, which the realm server does not offer yet', async () => {
    let refused = await keysApprove('my key', {
      ...deps,
      operation: 'service#Service.create',
      realm,
      interactive: true,
      yes: true,
    }).catch((e) => e);
    expect(refused).toBeInstanceOf(SecureSessionRequestError);
    expect(refused.status).toBe(403);
    expect(await bindingCount()).toBe(1);
  });

  it('approves the rest of the class as one batch in the terminal, reusing the grant', async () => {
    let result = await keysApprove('my key', {
      ...deps,
      operation: 'service#Service',
      realm,
      yes: true,
    });
    expect(windows).toHaveLength(1);
    expect(result.via).toBe('cli');
    expect(result.approved.map((b) => b.operation).sort()).toEqual([
      'create',
      'remove',
    ]);
    let rows = (await getTestDbAdapter()!.execute(
      `SELECT DISTINCT batch_id, via FROM key_binding_approvals a
         JOIN key_bindings b ON b.approval_id = a.id
        WHERE b.operation_name IN ('create', 'remove')`,
    )) as { batch_id: string; via: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.via).toBe('cli');
    let { key } = await keysShow('my key', deps);
    expect(key.grants).toHaveLength(1);
  });

  it('lists an approval whose request changed since it was approved', async () => {
    expect(await keysPending(deps)).toEqual([]);
    await testRealm.write(
      'service.gts',
      serviceSource(vendor.url, { edited: true }),
    );
    let pending = await keysPending(deps);
    expect(
      pending.map(({ binding, reason }) => [binding.operation, reason]),
    ).toEqual([['create', 'changed']]);
  });

  it('revokes an approval, leaving its grant', async () => {
    let revoked = await keysRevoke('my key', {
      ...deps,
      operation: 'service#Service.remove',
      realm,
      yes: true,
    });
    expect(revoked.map((b) => b.operation)).toEqual(['remove']);
    let left = await listOwnBindings(
      realmServerUrl,
      await pm.getOrRefreshServerToken(),
    );
    expect(left.map((b) => b.operation).sort()).toEqual(['create', 'list']);
    let { key } = await keysShow('my key', deps);
    expect(key.grants).toHaveLength(1);
  });

  it('invokes an operation, answering with what the vendor answered', async () => {
    let answer = await invokeOperation(`${realm}service#Service`, 'ping', {
      profileManager: pm,
    });
    expect(answer.status).toBe(200);
    expect(answer.result).toMatchObject({
      status: 200,
      body: { method: 'GET', path: '/echo' },
    });

    // The CLI is interactive, and every approval is for pipelines only.
    let refused = await invokeOperation(`${realm}the-service`, 'list', {
      profileManager: pm,
    });
    expect(JSON.stringify(refused.errors)).toContain(
      'interactive-use-not-approved',
    );
    expect(vendor.requests.some((r) => r.headers.authorization)).toBe(false);
  });

  it('removes a grant, revoking the approvals that send under it', async () => {
    let result = await keysUngrant('my key', {
      ...deps,
      destination: `${vendor.url}/`,
      yes: true,
    });
    expect(result.revoked.map((b) => b.operation).sort()).toEqual([
      'create',
      'list',
    ]);
    expect(await bindingCount()).toBe(0);
    let { key } = await keysShow('my key', deps);
    expect(key.grants).toEqual([]);
  });
});
