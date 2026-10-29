import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { PassThrough, Writable } from 'stream';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  keysAdd,
  keysClients,
  keysConnect,
  keysReplace,
  keysDelete,
  keysList,
  keysShow,
  runKeysCommand,
} from '../../src/commands/keys/manage.ts';
import { canonicalRealmUrl } from '../../src/lib/user-keys.ts';
import { buildBoxelProgram } from '../../src/build-program.ts';

const USER = '@bob:stack.cards';
const REALM_SERVER = 'https://realms.example.test/';
const KEY = {
  id: '7b0c9a52-3f63-4cb5-9d55-2f8f0e1d6a11',
  name: 'weather',
  kind: 'static',
  state: 'active',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function fakeTerminal() {
  let input = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => void;
  };
  input.isTTY = true;
  input.setRawMode = () => {};
  let written = '';
  let output = new Writable({
    write(chunk, _encoding, callback) {
      written += chunk.toString();
      callback();
    },
  });
  return {
    input: input as unknown as NodeJS.ReadStream,
    type: (text: string) => input.write(text),
    output,
    written: () => written,
  };
}

interface Recorded {
  method: string;
  path: string;
  body: any;
}

// A realm server answering each request from `answer`, recording it.
function stubServer(
  answer: (request: Recorded) => { status?: number; body?: unknown },
) {
  let requests: Recorded[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      let parsed = new URL(url);
      let request = {
        method: init.method ?? 'GET',
        path: `${parsed.pathname}${parsed.search}`,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      requests.push(request);
      let { status = 200, body } = answer(request);
      return new Response(
        status === 204 || body === undefined ? null : JSON.stringify(body),
        { status },
      );
    }),
  );
  return requests;
}

function captureStdout() {
  let out = '';
  let spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: any) => {
      out += String(chunk);
      return true;
    });
  let log = vi.spyOn(console, 'log').mockImplementation((...args) => {
    out += `${args.join(' ')}\n`;
  });
  return {
    text: () => out,
    restore: () => {
      spy.mockRestore();
      log.mockRestore();
    },
  };
}

describe('boxel keys: managing keys', () => {
  let configDir: string;
  let manager: ProfileManager;

  beforeEach(async () => {
    configDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-keys-manage-'));
    manager = new ProfileManager(configDir);
    await manager.addProfileWithAuth(USER, {
      accessToken: 'matrix-token',
      deviceId: 'DEVICE',
      userId: USER,
      matrixUrl: 'https://matrix-staging.stack.cards',
      realmServerUrl: REALM_SERVER,
    } as any);
    // The profile's ordinary realm-server session, unexpired.
    manager.setRealmServerToken(
      jwt.sign({ user: USER }, 'a secret', { expiresIn: '1h' }),
    );
    manager.setSecureSession({
      token: 'secure-session',
      userId: USER,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('adds a key typed at a masked prompt that never echoes it, under a ticket minted for the add', async () => {
    let value = 'sk-weather-0123456789abcdef';
    let requests = stubServer(({ method, path }) => {
      if (path === '/_secure-session') return { status: 204 };
      if (path === '/_key-write-tickets') {
        return {
          status: 201,
          body: { data: { attributes: { ticket: 'ticket-1' } } },
        };
      }
      if (method === 'POST' && path === '/_user-keys') {
        return {
          status: 201,
          body: { data: { type: 'user-key', id: KEY.id, attributes: KEY } },
        };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
    let terminal = fakeTerminal();
    let stdout = captureStdout();
    try {
      let adding = keysAdd('weather', {
        profileManager: manager,
        input: terminal.input,
        output: terminal.output,
      });
      terminal.type(`${value}\r`);
      await adding;
    } finally {
      stdout.restore();
    }

    let written = terminal.written();
    expect(written).toContain('*'.repeat(value.length));
    expect(written).toContain(`ending in ${value.slice(-4)}`);
    expect(written).not.toContain(value.slice(0, -4));
    expect(stdout.text()).not.toContain(value.slice(0, -4));

    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /_secure-session',
      'POST /_key-write-tickets',
      'POST /_user-keys',
    ]);
    expect(requests[1].body.data.attributes).toEqual({ action: 'add' });
    expect(requests[2].body).toEqual({
      data: { type: 'user-key', attributes: { name: 'weather', value } },
      meta: { ticket: 'ticket-1' },
    });
  });

  it('reveals nothing of a value of 8 characters or fewer', async () => {
    stubServer(({ path }) =>
      path === '/_secure-session'
        ? { status: 204 }
        : path === '/_key-write-tickets'
          ? { status: 201, body: { data: { attributes: { ticket: 't' } } } }
          : {
              status: 201,
              body: { data: { id: KEY.id, attributes: KEY } },
            },
    );
    let terminal = fakeTerminal();
    let stdout = captureStdout();
    try {
      let adding = keysAdd('weather', {
        profileManager: manager,
        input: terminal.input,
        output: terminal.output,
      });
      terminal.type('abcdefgh\r');
      await adding;
    } finally {
      stdout.restore();
    }
    expect(terminal.written()).toBe('Key value: ********\n');
  });

  it('refuses without a terminal, --stdin or --key-file, before signing in or asking the server anything', async () => {
    let requests = stubServer(() => ({ status: 500 }));
    let openBrowserFn = vi.fn(async () => true);
    manager.clearSecureSession();
    await expect(
      keysAdd('weather', {
        profileManager: manager,
        openBrowserFn,
        input: new PassThrough() as unknown as NodeJS.ReadStream,
      }),
    ).rejects.toThrow(/stdin is not a terminal. Pass --stdin or --key-file/);
    expect(openBrowserFn).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it("refuses a change without a secure session when nobody is there to sign in, and doesn't use the ordinary one", async () => {
    let requests = stubServer(() => ({ status: 500 }));
    manager.clearSecureSession();
    let stdin = new PassThrough();
    stdin.end('sk-value\n');
    await expect(
      keysAdd('weather', {
        profileManager: manager,
        interactive: false,
        stdin: true,
        input: stdin as unknown as NodeJS.ReadStream,
      }),
    ).rejects.toThrow(/sign in through the browser/);
    expect(requests).toEqual([]);
  });

  it('lists keys with the ordinary session', async () => {
    let requests = stubServer(() => ({
      body: { data: [{ type: 'user-key', id: KEY.id, attributes: KEY }] },
    }));
    let stdout = captureStdout();
    let keys;
    try {
      keys = await keysList({ profileManager: manager, json: true });
    } finally {
      stdout.restore();
    }
    expect(keys).toEqual([KEY]);
    expect(JSON.parse(stdout.text())).toEqual([KEY]);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /_user-keys',
    ]);
  });

  it("shows a key's grants and shares when the server reports them", async () => {
    let grants = [
      {
        id: 'grant-1',
        destination: 'https://api.weather.test/v1/',
        state: 'active',
        approvedAt: '2026-10-02T00:00:00.000Z',
        approvedVia: 'cli',
      },
    ];
    stubServer(({ path }) =>
      path === '/_user-keys'
        ? {
            body: {
              data: [{ id: KEY.id, attributes: { ...KEY, grants } }],
            },
          }
        : { body: { data: [] } },
    );
    let stdout = captureStdout();
    try {
      await keysShow('weather', { profileManager: manager });
    } finally {
      stdout.restore();
    }
    expect(stdout.text()).toContain(
      'https://api.weather.test/v1/: active, approved 2026-10-02T00:00:00.000Z in the CLI',
    );
    expect(stdout.text()).toContain('shares: none');
  });

  it("passes a refusal's errors through unchanged under --json", async () => {
    let errors = [
      'a valid key write ticket is required: tickets are single-use, expire, and are minted for one user and one change',
    ];
    stubServer(({ path }) =>
      path === '/_secure-session'
        ? { status: 204 }
        : path === '/_key-write-tickets'
          ? { status: 201, body: { data: { attributes: { ticket: 't' } } } }
          : { status: 403, body: { errors } },
    );
    let stdin = new PassThrough();
    stdin.end('sk-value\n');
    let stdout = captureStdout();
    try {
      await runKeysCommand(true, () =>
        keysAdd('weather', {
          profileManager: manager,
          json: true,
          stdin: true,
          input: stdin as unknown as NodeJS.ReadStream,
        }),
      );
    } finally {
      stdout.restore();
    }
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    expect(JSON.parse(stdout.text())).toEqual({
      error: { status: 403, reason: errors[0], errors },
    });
  });

  it('prints a refusal with its status and reason', async () => {
    let stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubServer(() => ({
      status: 409,
      body: { errors: ['you already have a key named weather'] },
    }));
    await runKeysCommand(false, () => keysList({ profileManager: manager }));
    process.exitCode = undefined;
    expect(stderr.mock.calls[0][0]).toMatch(
      /Refused \(HTTP 409\): you already have a key named weather/,
    );
  });

  it('keeps the masked prompt off stdout under --json, so stdout is only the JSON', async () => {
    let value = 'sk-weather-0123456789abcdef';
    stubServer(({ path }) =>
      path === '/_secure-session'
        ? { status: 204 }
        : path === '/_key-write-tickets'
          ? { status: 201, body: { data: { attributes: { ticket: 't' } } } }
          : { status: 201, body: { data: { id: KEY.id, attributes: KEY } } },
    );
    let terminal = fakeTerminal();
    let prompted = '';
    let stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: any) => {
        prompted += String(chunk);
        return true;
      });
    let stdout = captureStdout();
    try {
      let adding = keysAdd('weather', {
        profileManager: manager,
        json: true,
        input: terminal.input,
      });
      terminal.type(`${value}\r`);
      await adding;
    } finally {
      stdout.restore();
      stderr.mockRestore();
    }
    expect(JSON.parse(stdout.text())).toEqual(KEY);
    expect(prompted).toContain('*'.repeat(value.length));
    expect(stdout.text()).not.toContain(value.slice(-4));
  });

  it('refuses a delete without --yes and without a terminal before signing in or asking the server anything', async () => {
    let requests = stubServer(() => ({ status: 500 }));
    let openBrowserFn = vi.fn(async () => true);
    manager.clearSecureSession();
    await expect(
      keysDelete('weather', {
        profileManager: manager,
        json: true,
        openBrowserFn,
      }),
    ).rejects.toThrow(/--yes/);
    expect(openBrowserFn).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('names a realm as the server keys it: no query or fragment, one trailing slash', () => {
    expect(
      canonicalRealmUrl('https://realms.example.test/team/realm?x=1#top'),
    ).toBe('https://realms.example.test/team/realm/');
    expect(canonicalRealmUrl('https://realms.example.test/team/realm/')).toBe(
      'https://realms.example.test/team/realm/',
    );
  });

  it('takes no value as an argument', () => {
    let program = buildBoxelProgram('0.0.0');
    let keys = program.commands.find((command) => command.name() === 'keys');
    let names = keys!.commands.map((command) => command.name());
    expect(names).toEqual(
      expect.arrayContaining([
        'list',
        'show',
        'add',
        'replace',
        'delete',
        'share',
        'unshare',
        'swap',
        'shares',
        'clients',
        'connect',
      ]),
    );
    const oauthOptions = [
      '--client-id',
      '--authorize-url',
      '--token-url',
      '--scopes',
      '--grant-type',
      '--token-auth',
      '--api-host',
    ];
    for (let [name, kindOption, oauthOption] of [
      ['add', ['--kind'], oauthOptions],
      ['replace', [], []],
    ] as const) {
      let command = keys!.commands.find((c) => c.name() === name)!;
      expect(command.registeredArguments.map((a) => a.name())).toEqual([
        'name',
      ]);
      expect(command.options.map((o) => o.long)).toEqual([
        '--stdin',
        '--key-file',
        '--json',
        ...kindOption,
        '--subject',
        '--scope',
        ...oauthOption,
      ]);
    }
    let connect = keys!.commands.find((c) => c.name() === 'connect')!;
    expect(connect.registeredArguments.map((a) => a.name())).toEqual(['name']);
    expect(connect.options.map((o) => o.long)).toEqual([
      '--client',
      '--realm',
      '--timeout',
      '--json',
    ]);
  });
});

describe('boxel keys: Google service accounts', () => {
  let configDir: string;
  let manager: ProfileManager;
  let keyFile: string;
  const KEY_FILE = JSON.stringify({
    type: 'service_account',
    client_email: 'sheets-bot@boxel-test.iam.gserviceaccount.com',
    private_key:
      '-----BEGIN PRIVATE KEY-----\nplaceholder\n-----END PRIVATE KEY-----\n',
  });
  const SERVICE_ACCOUNT = {
    ...KEY,
    name: 'sheets',
    kind: 'google-service-account',
  };

  beforeEach(async () => {
    configDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-keys-gsa-'));
    keyFile = join(configDir, 'service-account.json');
    fs.writeFileSync(keyFile, `${KEY_FILE}\n`);
    manager = new ProfileManager(configDir);
    await manager.addProfileWithAuth(USER, {
      accessToken: 'matrix-token',
      deviceId: 'DEVICE',
      userId: USER,
      matrixUrl: 'https://matrix-staging.stack.cards',
      realmServerUrl: REALM_SERVER,
    } as any);
    manager.setRealmServerToken(
      jwt.sign({ user: USER }, 'a secret', { expiresIn: '1h' }),
    );
    manager.setSecureSession({
      token: 'secure-session',
      userId: USER,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  function serveKeys() {
    return stubServer(({ method, path }) => {
      if (path === '/_secure-session') {
        return { status: 204 };
      }
      if (path === '/_key-write-tickets') {
        return {
          status: 201,
          body: { data: { attributes: { ticket: 'ticket-1' } } },
        };
      }
      if (method === 'GET' && path === '/_user-keys') {
        return {
          body: {
            data: [
              {
                type: 'user-key',
                id: SERVICE_ACCOUNT.id,
                attributes: SERVICE_ACCOUNT,
              },
            ],
          },
        };
      }
      return {
        status: method === 'POST' ? 201 : 200,
        body: {
          data: {
            type: 'user-key',
            id: SERVICE_ACCOUNT.id,
            attributes: SERVICE_ACCOUNT,
          },
        },
      };
    });
  }

  it('adds one from its key file, with its scopes and the user to act as', async () => {
    let requests = serveKeys();
    let stdout = captureStdout();
    try {
      await keysAdd('sheets', {
        profileManager: manager,
        kind: 'google-service-account',
        keyFile,
        subject: 'owner@example.com',
        scope: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive.readonly',
        ],
      });
    } finally {
      stdout.restore();
    }
    let post = requests.find(
      (r) => r.method === 'POST' && r.path === '/_user-keys',
    )!;
    expect(post.body).toEqual({
      data: {
        type: 'user-key',
        attributes: {
          name: 'sheets',
          kind: 'google-service-account',
          value: KEY_FILE,
          subject: 'owner@example.com',
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.readonly',
          ],
        },
      },
      meta: { ticket: 'ticket-1' },
    });
    expect(stdout.text()).not.toContain('placeholder');
  });

  it('refuses a service account without a key file or a scope, before asking the server anything', async () => {
    let requests = stubServer(() => ({ status: 500 }));
    await expect(
      keysAdd('sheets', {
        profileManager: manager,
        kind: 'google-service-account',
        scope: ['openid'],
        input: fakeTerminal().input,
      }),
    ).rejects.toThrow(/read with --key-file or --stdin/);
    await expect(
      keysAdd('sheets', {
        profileManager: manager,
        kind: 'google-service-account',
        keyFile,
      }),
    ).rejects.toThrow(/at least one --scope/);
    await expect(
      keysAdd('weather', {
        profileManager: manager,
        keyFile,
        scope: ['openid'],
      }),
    ).rejects.toThrow(/only for a google-service-account key/);
    await expect(
      keysAdd('weather', { profileManager: manager, kind: 'oauth', keyFile }),
    ).rejects.toThrow(/--kind is one of: static, google-service-account/);
    expect(requests).toEqual([]);
  });

  it('points a key file added without --kind to the service account kind, and sends nothing', async () => {
    let requests = serveKeys();
    await expect(
      keysAdd('sheets', { profileManager: manager, keyFile }),
    ).rejects.toThrow(
      /a Google service account's JSON key file. Add it with --kind google-service-account/,
    );
    expect(requests.filter((r) => r.path === '/_user-keys')).toEqual([]);
  });

  it('replaces one with a new key file and scopes, as its own kind', async () => {
    let requests = serveKeys();
    let stdout = captureStdout();
    try {
      await keysReplace('sheets', {
        profileManager: manager,
        keyFile,
        scope: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } finally {
      stdout.restore();
    }
    let patch = requests.find((r) => r.method === 'PATCH')!;
    expect(patch.body).toEqual({
      data: {
        type: 'user-key',
        attributes: {
          value: KEY_FILE,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        },
      },
      meta: { ticket: 'ticket-1' },
    });
  });

  it('replaces an OAuth app’s secret, a kind add doesn’t take', async () => {
    let oauthApp = {
      ...SERVICE_ACCOUNT,
      name: 'github-app',
      kind: 'oauth-client',
    };
    let requests = stubServer(({ method, path }) => {
      if (path === '/_secure-session') return { status: 204 };
      if (path === '/_key-write-tickets')
        return { status: 201, body: { data: { attributes: { ticket: 't' } } } };
      if (method === 'GET')
        return {
          body: {
            data: [{ type: 'user-key', id: oauthApp.id, attributes: oauthApp }],
          },
        };
      return {
        body: {
          data: { type: 'user-key', id: oauthApp.id, attributes: oauthApp },
        },
      };
    });
    let secretFile = join(configDir, 'secret.txt');
    fs.writeFileSync(secretFile, 'new-client-secret\n');
    let stdout = captureStdout();
    try {
      await keysReplace('github-app', {
        profileManager: manager,
        keyFile: secretFile,
      });
    } finally {
      stdout.restore();
    }
    expect(
      requests.find((r) => r.method === 'PATCH')!.body.data.attributes,
    ).toEqual({
      value: 'new-client-secret',
    });
  });

  it('refuses to replace a service account without its scopes, before minting a ticket', async () => {
    let requests = serveKeys();
    await expect(
      keysReplace('sheets', { profileManager: manager, keyFile }),
    ).rejects.toThrow(/at least one --scope/);
    expect(requests.filter((r) => r.path === '/_key-write-tickets')).toEqual(
      [],
    );
  });
});

describe('boxel keys: OAuth clients and connections', () => {
  let configDir: string;
  let manager: ProfileManager;
  const REALM = 'https://realms.example.test/team/';
  const CLIENT_KEY = {
    ...KEY,
    id: '0d6f4a8e-6c1b-4f4e-9a57-3c2b7e1f9d20',
    name: 'forge app',
    kind: 'oauth-client',
  };
  const CONNECTION = {
    ...KEY,
    id: '5a1e2c3d-4b5f-4a6e-8b7c-9d0e1f2a3b4c',
    name: 'my forge',
    kind: 'oauth-connection',
  };
  const PLATFORM = {
    ref: { kind: 'platform', clientId: '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a' },
    kind: 'platform',
    label: 'Boxel (read-only)',
    name: 'github',
    clientId: 'Iv1.boxel',
    scopes: '',
    apiHosts: ['https://api.github.com/'],
    authorizeHost: 'github.com',
  };
  const SHARED = {
    ref: { kind: 'share', shareId: '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b' },
    kind: 'share',
    label: 'team forge',
    clientId: 'forge-team',
    scopes: 'read:user',
    apiHosts: [],
    authorizeHost: 'forge.example',
  };
  const OWN = {
    ref: { kind: 'own', keyId: CLIENT_KEY.id },
    kind: 'own',
    label: 'forge app',
    clientId: 'forge-mine',
    scopes: 'repo:read',
    apiHosts: [],
    authorizeHost: 'forge.example',
  };

  beforeEach(async () => {
    configDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-keys-oauth-'));
    manager = new ProfileManager(configDir);
    await manager.addProfileWithAuth(USER, {
      accessToken: 'matrix-token',
      deviceId: 'DEVICE',
      userId: USER,
      matrixUrl: 'https://matrix-staging.stack.cards',
      realmServerUrl: REALM_SERVER,
    } as any);
    manager.setRealmServerToken(
      jwt.sign({ user: USER }, 'a secret', { expiresIn: '1h' }),
    );
    manager.setSecureSession({
      token: 'secure-session',
      userId: USER,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('adds a client with its secret typed at the masked prompt and its settings beside it', async () => {
    let secret = 'forge-client-secret-0123456789';
    let requests = stubServer(({ path }) => {
      if (path === '/_secure-session') return { status: 204 };
      if (path === '/_key-write-tickets') {
        return {
          status: 201,
          body: { data: { attributes: { ticket: 'ticket-1' } } },
        };
      }
      return {
        status: 201,
        body: { data: { id: CLIENT_KEY.id, attributes: CLIENT_KEY } },
      };
    });
    let terminal = fakeTerminal();
    let stdout = captureStdout();
    try {
      let adding = keysAdd('forge app', {
        profileManager: manager,
        input: terminal.input,
        output: terminal.output,
        kind: 'oauth-client',
        clientId: 'forge-mine',
        authorizeUrl: 'https://forge.example/authorize',
        tokenUrl: 'https://forge.example/token',
        scopes: ['repo:read', 'read:user'],
        apiHost: ['https://api.forge.example/'],
      });
      terminal.type(`${secret}\r`);
      await adding;
    } finally {
      stdout.restore();
    }
    expect(terminal.written()).toContain('*'.repeat(secret.length));
    expect(terminal.written()).not.toContain(secret.slice(0, -4));
    expect(stdout.text()).not.toContain(secret.slice(0, -4));
    expect(stdout.text()).toContain('--client forge app');
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /_secure-session',
      'POST /_key-write-tickets',
      'POST /_user-keys',
    ]);
    expect(requests[2].body).toEqual({
      data: {
        type: 'user-key',
        attributes: {
          name: 'forge app',
          kind: 'oauth-client',
          value: secret,
          oauth: {
            clientId: 'forge-mine',
            authorizeUrl: 'https://forge.example/authorize',
            tokenUrl: 'https://forge.example/token',
            scopes: 'repo:read read:user',
            apiHosts: ['https://api.forge.example/'],
          },
        },
      },
      meta: { ticket: 'ticket-1' },
    });
  });

  it('refuses a client missing what it needs, and OAuth options on another kind, before asking the server anything', async () => {
    let requests = stubServer(() => ({ status: 500 }));
    let base = {
      profileManager: manager,
      stdin: true,
      input: new PassThrough() as unknown as NodeJS.ReadStream,
    };
    await expect(
      keysAdd('forge app', {
        ...base,
        kind: 'oauth-client',
        authorizeUrl: 'https://forge.example/authorize',
        tokenUrl: 'https://forge.example/token',
      }),
    ).rejects.toThrow(/--client-id/);
    await expect(
      keysAdd('forge app', {
        ...base,
        kind: 'oauth-client',
        clientId: 'forge-mine',
        tokenUrl: 'https://forge.example/token',
      }),
    ).rejects.toThrow(/--authorize-url/);
    await expect(
      keysAdd('forge app', {
        ...base,
        kind: 'oauth-client',
        clientId: 'forge-mine',
        grantType: 'client_credentials',
        authorizeUrl: 'https://forge.example/authorize',
        tokenUrl: 'https://forge.example/token',
      }),
    ).rejects.toThrow(/client_credentials client has no --authorize-url/);
    await expect(
      keysAdd('weather', { ...base, clientId: 'forge-mine' }),
    ).rejects.toThrow(/--client-id is only for an oauth-client key/);
    expect(requests).toEqual([]);
  });

  it("lists the clients to connect through, each named as connect's --client takes it", async () => {
    let requests = stubServer(() => ({
      body: {
        data: [PLATFORM, SHARED, OWN].map((attributes) => ({
          type: 'oauth-client',
          attributes,
        })),
      },
    }));
    let stdout = captureStdout();
    let clients;
    try {
      clients = await keysClients({ profileManager: manager, realm: REALM });
    } finally {
      stdout.restore();
    }
    expect(clients).toHaveLength(3);
    expect(requests.map((r) => r.path)).toEqual([
      `/_oauth/clients?realm=${encodeURIComponent(REALM)}`,
    ]);
    let lines = stdout.text().trim().split('\n');
    expect(lines[0]).toMatch(
      /^platform:github .*Boxel \(read-only\), Boxel's own, signs in at github\.com/,
    );
    expect(lines[1]).toMatch(
      /^team forge .*shared into https:\/\/realms\.example\.test\/team\/, signs in at forge\.example, scopes read:user/,
    );
    expect(lines[2]).toMatch(/^forge app .*yours, signs in at forge\.example/);
  });

  function serveConnect({
    clients = [PLATFORM, SHARED, OWN],
    appearsAfter = 1,
    appearing = CONNECTION,
  }: {
    clients?: unknown[];
    appearsAfter?: number;
    appearing?: unknown;
  } = {}) {
    let listings = 0;
    return stubServer(({ method, path }) => {
      if (path === '/_secure-session') return { status: 204 };
      if (path.startsWith('/_oauth/clients')) {
        return {
          body: {
            data: clients.map((attributes) => ({
              type: 'oauth-client',
              attributes,
            })),
          },
        };
      }
      if (path === '/_key-write-tickets') {
        return {
          status: 201,
          body: { data: { attributes: { ticket: 'ticket-1' } } },
        };
      }
      if (method === 'POST' && path === '/_oauth/connections') {
        return {
          status: 201,
          body: {
            data: {
              type: 'oauth-connect',
              attributes: {
                authorizeUrl:
                  'https://github.com/login/oauth/authorize?state=s',
                expiresAt: new Date(Date.now() + 600_000).toISOString(),
              },
            },
          },
        };
      }
      if (method === 'GET' && path === '/_user-keys') {
        listings++;
        let data =
          listings > appearsAfter
            ? [
                {
                  type: 'user-key',
                  id: (appearing as any).id,
                  attributes: appearing,
                },
              ]
            : [];
        return { body: { data } };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
  }

  it('connects through a platform client: opens the vendor in the browser and waits for the connection, printing no token', async () => {
    let requests = serveConnect();
    let opened: string[] = [];
    let stdout = captureStdout();
    let key;
    try {
      key = await keysConnect('my forge', {
        profileManager: manager,
        client: 'platform:github',
        openBrowserFn: async (url) => {
          opened.push(url);
          return true;
        },
        pollIntervalMs: 1,
      });
    } finally {
      stdout.restore();
    }
    expect(key.id).toBe(CONNECTION.id);
    expect(opened).toEqual([
      'https://github.com/login/oauth/authorize?state=s',
    ]);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /_secure-session',
      'GET /_oauth/clients',
      'POST /_key-write-tickets',
      'POST /_oauth/connections',
      'GET /_user-keys',
      'GET /_user-keys',
    ]);
    expect(requests[2].body.data.attributes).toEqual({ action: 'add' });
    expect(requests[3].body).toEqual({
      data: {
        type: 'oauth-connect',
        attributes: { name: 'my forge', client: PLATFORM.ref },
      },
      meta: { ticket: 'ticket-1' },
    });
    expect(stdout.text()).toContain(
      'Connected my forge through Boxel (read-only).',
    );
  });

  it('names a shared client by its label in the --realm, and one of your own by its name', async () => {
    let requests = serveConnect({ appearsAfter: 0 });
    let quiet = captureStdout();
    try {
      await keysConnect('my forge', {
        profileManager: manager,
        client: 'team forge',
        realm: REALM,
        openBrowserFn: async () => true,
        pollIntervalMs: 1,
      });
      await keysConnect('my forge', {
        profileManager: manager,
        client: 'forge app',
        openBrowserFn: async () => true,
        pollIntervalMs: 1,
      });
    } finally {
      quiet.restore();
    }
    let started = requests.filter((r) => r.path === '/_oauth/connections');
    expect(started.map((r) => r.body.data.attributes.client)).toEqual([
      SHARED.ref,
      OWN.ref,
    ]);
    expect(
      requests
        .filter((r) => r.path.startsWith('/_oauth/clients'))
        .map((r) => r.path),
    ).toEqual([
      `/_oauth/clients?realm=${encodeURIComponent(REALM)}`,
      '/_oauth/clients',
    ]);
  });

  it("refuses a client it can't find before starting a sign-in", async () => {
    let requests = serveConnect();
    let openBrowserFn = vi.fn(async () => true);
    for (let [client, realm] of [
      ['platform:gitlab', undefined],
      ['team forge', undefined],
      ['forge app', REALM],
    ] as const) {
      await expect(
        keysConnect('my forge', {
          profileManager: manager,
          client,
          realm,
          openBrowserFn,
        }),
      ).rejects.toThrow(/no client/);
    }
    await expect(
      keysConnect('my forge', {
        profileManager: manager,
        client: 'platform:github',
        timeout: 'soon',
        openBrowserFn,
      }),
    ).rejects.toThrow(/--timeout is a number of seconds/);
    expect(openBrowserFn).not.toHaveBeenCalled();
    expect(requests.some((r) => r.path === '/_oauth/connections')).toBe(false);
  });

  it('gives up when the sign-in is not finished in time, and says when the name was taken meanwhile', async () => {
    serveConnect({ appearsAfter: Infinity });
    let quiet = captureStdout();
    let errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        keysConnect('my forge', {
          profileManager: manager,
          client: 'platform:github',
          timeout: '0',
          openBrowserFn: async () => true,
          pollIntervalMs: 1,
        }),
      ).rejects.toThrow(/wasn't finished in the browser in time/);

      vi.unstubAllGlobals();
      serveConnect({
        appearsAfter: 0,
        appearing: { ...KEY, name: 'my forge' },
      });
      await expect(
        keysConnect('my forge', {
          profileManager: manager,
          client: 'platform:github',
          openBrowserFn: async () => true,
          pollIntervalMs: 1,
        }),
      ).rejects.toThrow(/was added while you were signing in/);
    } finally {
      quiet.restore();
      errors.mockRestore();
    }
  });
});
