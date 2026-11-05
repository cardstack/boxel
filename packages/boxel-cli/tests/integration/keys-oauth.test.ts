import '../helpers/setup-realm-server.ts';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import {
  installSecretsKeyring,
  LocalKeyProvider,
  resetSecretsAtRest,
  secretsKeyring,
} from '#realm-server/lib/secrets-at-rest/index';
import {
  configureOutbound,
  resetOutbound,
} from '#realm-server/lib/outbound/client';
import { addPlatformClient } from '#realm-server/lib/oauth';
// Signing in on the secure origin drives Synapse's admin API.
import {
  createJWT,
  ensureMatrixAdminUser,
  getTestPrerenderer,
  stopTestPrerenderServer,
} from '#realm-server/tests/helpers/index';
import {
  startStubOAuthProvider,
  type StubOAuthProvider,
} from '#realm-server/tests/helpers/stub-oauth-provider';
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
  keysClients,
  keysConnect,
  keysShare,
  keysShow,
  type KeysCommandDeps,
} from '../../src/commands/keys/manage.ts';

// ============================================================================
// OAuth clients and connections from the terminal, against the stub OAuth
// vendor: a person adds a client, shares it into a realm, lists the clients
// they can connect through (the platform's among them), connects through
// one in the browser, approves an operation for the connection, and the
// operation calls the vendor's API with a token the realm server minted.
// ============================================================================

const realmServerUrl = `${TEST_REALM_SERVER_URL}/`;
const realm = `${TEST_REALM_SERVER_URL}/test/`;
const secureOriginURL = new URL('https://secure.cli-keys-oauth.test/secure');
const matrixId = `@${TEST_USERNAME}:localhost`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const PLATFORM_CLIENT = {
  clientId: 'Iv1.boxel-read-only',
  clientSecret: 'platform-client-secret-0f9e8d',
};
const TEAM_CLIENT = {
  clientId: 'Iv1.team-app',
  clientSecret: 'team-client-secret-7a6b5c',
};

function stdinWith(text: string): NodeJS.ReadStream {
  let stdin = new PassThrough();
  stdin.end(text);
  return stdin as unknown as NodeJS.ReadStream;
}

describe('boxel keys: OAuth clients and connections (integration)', () => {
  let configDir: string;
  let pm: ProfileManager;
  let deps: KeysCommandDeps;
  let provider: StubOAuthProvider;
  let testRealm: Realm;
  let serviceModule: string;
  // What the browser did after the CLI opened the vendor's page, awaited by
  // the test that opened it.
  let browsing: Promise<void> | undefined;

  async function signInOnSecureOrigin(client: 'cli') {
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
            client,
          },
        },
      }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as any).data.attributes;
  }

  // Stands in for the browser, which holds no session on the secure origin.
  // Given the CLI's sign-in link, it signs in on the secure origin and hands
  // the session to the CLI's loopback listener, as the window's form does.
  // Given a vendor's sign-in page, it approves there, follows the vendor back
  // through the realm server's callback to the secure window's `connected`
  // page, and hands the code to the CLI as that page does.
  async function browser(link: string): Promise<boolean> {
    let url = new URL(link);
    if (url.origin === secureOriginURL.origin) {
      let session = await signInOnSecureOrigin('cli');
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
    expect(url.origin).toBe(provider.url);
    browsing = (async () => {
      let approved = await fetch(link, { redirect: 'manual' });
      let callback = new URL(approved.headers.get('location')!);
      expect(
        callback.href.startsWith(`${realmServerUrl}_oauth/callback?`),
      ).toBe(true);
      let back = await fetch(callback, { redirect: 'manual' });
      let landing = new URL(back.headers.get('location')!);
      expect(`${landing.origin}${landing.pathname}`).toBe(
        `${secureOriginURL.href}/connected`,
      );
      // The `connected` page, with no session of its own, hands the code to
      // the CLI's listener the sign-in named, as its form does.
      let fragment = new URLSearchParams(landing.hash.slice(1));
      let handedBack = await fetch(
        `http://127.0.0.1:${fragment.get('cli_port')}/callback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            state: fragment.get('cli_state')!,
            oauth_code: fragment.get('code')!,
            oauth_state: fragment.get('state')!,
          }).toString(),
        },
      );
      expect(handedBack.status).toBe(200);
    })();
    return true;
  }

  // Approves an operation for one of the user's keys, as the secure window's
  // approval does: shows the request, then approves what was shown.
  async function approve(keyId: string) {
    let auth = `Bearer ${pm.getSecureSession()!.token}`;
    let codeRef = { module: rri(`${realm}service`), name: 'Service' };
    let shown = await fetch(
      `${realmServerUrl}_key-bindings/preview?${new URLSearchParams({
        realm,
        module: codeRef.module,
        name: codeRef.name,
        operation: 'me',
      })}`,
      { headers: { Authorization: auth } },
    );
    expect(shown.status).toBe(200);
    let preview = ((await shown.json()) as any).data.attributes;
    let approved = await fetch(`${realmServerUrl}_key-bindings`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        Origin: secureOriginURL.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'key-binding-approval',
          attributes: {
            realm,
            operations: [
              {
                codeRef,
                operation: 'me',
                expectedDestination: preview.destination,
                slots: {
                  userKey: {
                    keyId,
                    expectedFingerprint: preview.slots[0].fingerprint,
                  },
                },
              },
            ],
          },
        },
      }),
    });
    expect(approved.status, await approved.clone().text()).toBe(201);
  }

  const invokeBody = JSON.stringify({
    'boxel:operations': [
      { op: 'invoke', 'boxel:name': 'me', href: '/the-service' },
    ],
  });

  beforeAll(async () => {
    installSecretsKeyring(await new LocalKeyProvider().loadDataKeys());
    configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
    await ensureMatrixAdminUser();
    provider = await startStubOAuthProvider({
      clients: [PLATFORM_CLIENT, TEAM_CLIENT],
    });
    serviceModule = `
      import { contains, field, CardDef } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { operation } from "@cardstack/base/operations";

      export class Service extends CardDef {
        @field title = contains(StringField);

        @operation static me = {
          base: 'callApi',
          url: '${provider.url}/api/user',
          headers: { authorization: 'Bearer {{userKey}}' },
        };
      }
    `;
    let { realms } = await startTestRealmServer({
      secureOriginURL,
      prerenderer: await getTestPrerenderer(),
      fileSystem: {
        'service.gts': serviceModule,
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
    await addPlatformClient(getTestDbAdapter()!, secretsKeyring(), {
      name: 'github',
      label: 'Boxel (read-only)',
      secret: PLATFORM_CLIENT.clientSecret,
      note: 'adding the platform client for tests',
      oauth: {
        clientId: PLATFORM_CLIENT.clientId,
        authorizeUrl: `${provider.url}/authorize`,
        tokenUrl: `${provider.url}/token`,
        scopes: 'read:user',
        apiHosts: [`${provider.url}/api/`],
      },
    });
    configDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-keys-oauth-'));
    pm = new ProfileManager(configDir);
    await pm.addProfile(
      matrixId,
      TEST_PASSWORD,
      'Keys OAuth Test',
      matrixURL.href,
      realmServerUrl,
    );
    await pm.getOrRefreshServerToken();
    deps = { profileManager: pm, openBrowserFn: browser };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  }, 600_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      await stopTestRealmServer();
    } finally {
      // The prerender port is process-wide; see search.test.ts for why it
      // stops after the realm server, in `finally`.
      await stopTestPrerenderServer();
      await provider?.close();
      resetOutbound();
      resetSecretsAtRest();
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  }, 600_000);

  it('adds a client with its secret entered as any secret, and shares it into a realm', async () => {
    let added = await keysAdd('team app', {
      ...deps,
      kind: 'oauth-client',
      stdin: true,
      input: stdinWith(`${TEAM_CLIENT.clientSecret}\n`),
      clientId: TEAM_CLIENT.clientId,
      authorizeUrl: `${provider.url}/authorize`,
      tokenUrl: `${provider.url}/token`,
      scopes: ['read:user'],
      apiHost: [`${provider.alternateUrl}/api/`],
    });
    expect(added).toMatchObject({ name: 'team app', kind: 'oauth-client' });
    let shown = await keysShow('team app', deps);
    expect(shown.key.oauth?.client).toMatchObject({
      clientId: TEAM_CLIENT.clientId,
      tokenURL: `${provider.url}/token`,
      scopes: 'read:user',
      apiHosts: [`${provider.alternateUrl}/api/`],
      state: 'active',
    });
    expect(JSON.stringify(shown)).not.toContain(TEAM_CLIENT.clientSecret);
    await keysShare('team app', { ...deps, realm, as: 'team forge' });
  });

  it("lists the realm's shared clients, the platform's and the user's own", async () => {
    let clients = await keysClients({ ...deps, realm });
    expect(
      clients.map((c) => [c.kind, c.kind === 'platform' ? c.name : c.label]),
    ).toEqual([
      ['share', 'team forge'],
      ['platform', 'github'],
      ['own', 'team app'],
    ]);
    expect(JSON.stringify(clients)).not.toContain('client-secret');
    expect((await keysClients(deps)).map((c) => c.kind).sort()).toEqual([
      'own',
      'platform',
    ]);
  });

  it('connects through the platform client in the browser, and the connection serves an approved operation', async () => {
    let connection = await keysConnect('my account', {
      ...deps,
      client: 'platform:github',
    });
    await browsing;
    expect(connection).toMatchObject({
      name: 'my account',
      kind: 'oauth-connection',
    });
    expect(connection.oauth?.connection).toMatchObject({
      client: { kind: 'platform', label: 'Boxel (read-only)' },
      status: 'active',
    });
    // No token the vendor issued ever reaches the CLI.
    expect(JSON.stringify(connection)).not.toMatch(
      new RegExp(provider.issued.join('|')),
    );

    await approve(connection.id);

    // The CLI's own session invokes interactively, and a binding is
    // approved for pipelines only.
    let interactive = await fetch(`${realm}_operations`, {
      method: 'POST',
      headers: {
        Accept: OPERATIONS,
        'Content-Type': OPERATIONS,
        Authorization: `Bearer ${await pm.getRealmTokenForUrl(realm)}`,
      },
      body: invokeBody,
    });
    expect(await interactive.text()).toContain('interactive-use-not-approved');
    expect(provider.apiCalls).toEqual([]);

    let piped = (await testRealm.handlePipeline(
      new Request(`${realm}_operations`, {
        method: 'POST',
        headers: {
          Accept: OPERATIONS,
          'Content-Type': OPERATIONS,
          Authorization: `Bearer ${createJWT(testRealm, matrixId, ['read', 'write'])}`,
        },
        body: invokeBody,
      }),
    ))!;
    expect(piped.status, await piped.clone().text()).toBe(200);
    expect(provider.apiCalls).toHaveLength(1);
    expect(provider.issued).toContain(provider.apiCalls[0].token);
  });

  it('connects through a client shared into the realm', async () => {
    let connection = await keysConnect('team account', {
      ...deps,
      client: 'team forge',
      realm,
    });
    await browsing;
    expect(connection.oauth?.connection).toMatchObject({
      client: { kind: 'share', label: 'team forge' },
      status: 'active',
    });
    let authorized = provider.authorizeRequests.at(-1)!;
    expect(authorized.get('client_id')).toBe(TEAM_CLIENT.clientId);
  });
});
