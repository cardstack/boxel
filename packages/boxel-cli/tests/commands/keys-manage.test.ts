import * as fs from 'fs';
import http from 'http';
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

  // A realm server for `connect`. `complete` answers the CLI finishing the
  // sign-in.
  function serveConnect({
    clients = [PLATFORM, SHARED, OWN],
    complete = { connected: CONNECTION.id, reconnected: false } as Record<
      string,
      unknown
    >,
  }: { clients?: unknown[]; complete?: Record<string, unknown> } = {}) {
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
      if (method === 'POST' && path === '/_oauth/connections/complete') {
        return {
          status: 'connected' in complete ? 201 : 200,
          body: {
            data: { type: 'oauth-connection-result', attributes: complete },
          },
        };
      }
      if (method === 'GET' && path === '/_user-keys') {
        return {
          body: {
            data: [
              { type: 'user-key', id: CONNECTION.id, attributes: CONNECTION },
            ],
          },
        };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
  }

  // Posts to the CLI's loopback listener as the secure window's `connected`
  // page does, with node's own HTTP client: `fetch` is the stubbed realm
  // server here.
  function postToListener(
    cli: { port: number; state: string },
    fields: Record<string, string>,
  ): Promise<number> {
    let body = new URLSearchParams({ state: cli.state, ...fields }).toString();
    return new Promise((resolve, reject) => {
      let req = http.request(
        {
          host: '127.0.0.1',
          port: cli.port,
          path: '/callback',
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  // Stands in for the browser: once the CLI opens the service's page, the
  // service sends it back and the `connected` page hands `fields` to the
  // listener the sign-in named.
  function browserHandingBack(
    requests: { method: string; path: string; body: any }[],
    fields: Record<string, string>,
  ) {
    let opened: string[] = [];
    return {
      opened,
      openBrowserFn: async (url: string) => {
        opened.push(url);
        let started = requests
          .filter(
            (r) => r.method === 'POST' && r.path === '/_oauth/connections',
          )
          .at(-1)!;
        setTimeout(
          () => void postToListener(started.body.data.attributes.cli, fields),
          0,
        );
        return true;
      },
    };
  }

  it('connects through a platform client: the browser hands the code back to the CLI, which finishes the sign-in with its own session', async () => {
    let requests = serveConnect();
    let browser = browserHandingBack(requests, {
      oauth_code: 'one-use-code',
      oauth_state: 'sign-in-state',
    });
    let stdout = captureStdout();
    let key;
    try {
      key = await keysConnect('my forge', {
        profileManager: manager,
        client: 'platform:github',
        openBrowserFn: browser.openBrowserFn,
      });
    } finally {
      stdout.restore();
    }
    expect(key.id).toBe(CONNECTION.id);
    expect(browser.opened).toEqual([
      'https://github.com/login/oauth/authorize?state=s',
    ]);
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /_oauth/clients',
      'GET /_secure-session',
      'POST /_key-write-tickets',
      'POST /_oauth/connections',
      'POST /_oauth/connections/complete',
      'GET /_user-keys',
    ]);
    expect(requests[2].body.data.attributes).toEqual({ action: 'add' });
    let { cli, ...attributes } = requests[3].body.data.attributes;
    expect(attributes).toEqual({ name: 'my forge', client: PLATFORM.ref });
    expect(cli).toEqual({
      port: expect.any(Number),
      state: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(requests[3].body.meta).toEqual({ ticket: 'ticket-1' });
    expect(requests[4].body).toEqual({
      data: {
        type: 'oauth-callback',
        attributes: { code: 'one-use-code', state: 'sign-in-state' },
      },
    });
    expect(stdout.text()).toContain(
      'Connected my forge through Boxel (read-only).',
    );
    expect(stdout.text()).not.toContain('one-use-code');
  });

  it("ends the wait on a hand-off that doesn't carry the listener's state, finishing nothing", async () => {
    let requests = serveConnect();
    let refused: Promise<number> | undefined;
    let quiet = captureStdout();
    try {
      await expect(
        keysConnect('my forge', {
          profileManager: manager,
          client: 'platform:github',
          openBrowserFn: async () => {
            let { cli } = requests.find(
              (r) => r.path === '/_oauth/connections',
            )!.body.data.attributes;
            refused = postToListener(
              { ...cli, state: 'f'.repeat(32) },
              { oauth_code: 'someone-elses', oauth_state: 'theirs' },
            );
            return true;
          },
        }),
      ).rejects.toThrow(/did not carry the expected state/);
    } finally {
      quiet.restore();
    }
    expect(await refused).toBe(400);
    expect(
      requests.filter((r) => r.path === '/_oauth/connections/complete'),
    ).toEqual([]);
  });

  it('names a shared client by its label in the --realm, and one of your own by its name, with or without --realm', async () => {
    let requests = serveConnect();
    let quiet = captureStdout();
    try {
      for (let [client, realm] of [
        ['team forge', REALM],
        ['forge app', undefined],
        ['forge app', REALM],
      ] as const) {
        await keysConnect('my forge', {
          profileManager: manager,
          client,
          realm,
          openBrowserFn: browserHandingBack(requests, {
            oauth_code: 'one-use-code',
            oauth_state: 'sign-in-state',
          }).openBrowserFn,
        });
      }
    } finally {
      quiet.restore();
    }
    let started = requests.filter((r) => r.path === '/_oauth/connections');
    expect(started.map((r) => r.body.data.attributes.client)).toEqual([
      SHARED.ref,
      OWN.ref,
      OWN.ref,
    ]);
  });

  it("refuses a client it can't find, or a bad --timeout, before signing in or starting anything", async () => {
    manager.clearSecureSession();
    let requests = serveConnect();
    let openBrowserFn = vi.fn(async () => true);
    for (let [client, realm] of [
      ['platform:gitlab', undefined],
      ['team forge', undefined],
      ['nobody', REALM],
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
    expect(
      requests.filter((r) => !r.path.startsWith('/_oauth/clients')),
    ).toEqual([]);
  });

  it('says why a sign-in ended without a connection, from the browser or the realm server', async () => {
    let quiet = captureStdout();
    try {
      let requests = serveConnect();
      await expect(
        keysConnect('my forge', {
          profileManager: manager,
          client: 'platform:github',
          openBrowserFn: browserHandingBack(requests, { oauth_error: 'denied' })
            .openBrowserFn,
        }),
      ).rejects.toThrow(/didn't give Boxel access/);
      expect(
        requests.some((r) => r.path === '/_oauth/connections/complete'),
      ).toBe(false);

      vi.unstubAllGlobals();
      requests = serveConnect({ complete: { error: 'name-taken' } });
      await expect(
        keysConnect('my forge', {
          profileManager: manager,
          client: 'platform:github',
          openBrowserFn: browserHandingBack(requests, {
            oauth_code: 'one-use-code',
            oauth_state: 'sign-in-state',
          }).openBrowserFn,
        }),
      ).rejects.toThrow(/was added while you were signing in/);
    } finally {
      quiet.restore();
    }
  });

  it('gives up when nothing comes back in time', async () => {
    serveConnect();
    let quiet = captureStdout();
    try {
      await expect(
        keysConnect('my forge', {
          profileManager: manager,
          client: 'platform:github',
          timeout: '0.05',
          openBrowserFn: async () => true,
        }),
      ).rejects.toThrow(/wasn't finished in the browser in time/);
    } finally {
      quiet.restore();
    }
  });
});
