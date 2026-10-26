import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { PassThrough, Writable } from 'stream';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  keysAdd,
  keysDelete,
  keysList,
  keysShow,
  runKeysCommand,
} from '../../src/commands/keys/manage.ts';
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

  it('asks for --yes to delete under --json, after listing nothing and changing nothing', async () => {
    let requests = stubServer(({ path }) =>
      path === '/_secure-session'
        ? { status: 204 }
        : path === '/_user-keys'
          ? { body: { data: [{ id: KEY.id, attributes: KEY }] } }
          : { body: { data: [] } },
    );
    await expect(
      keysDelete('weather', { profileManager: manager, json: true }),
    ).rejects.toThrow(/--yes/);
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
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
      ]),
    );
    for (let name of ['add', 'replace']) {
      let command = keys!.commands.find((c) => c.name() === name)!;
      expect(command.registeredArguments.map((a) => a.name())).toEqual([
        'name',
      ]);
      expect(command.options.map((o) => o.long)).toEqual([
        '--stdin',
        '--key-file',
        '--json',
      ]);
    }
  });
});
