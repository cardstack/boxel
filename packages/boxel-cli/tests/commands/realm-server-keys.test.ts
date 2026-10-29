import { describe, it, expect } from 'vitest';
import { PassThrough, Writable } from 'stream';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import jwt from 'jsonwebtoken';

import {
  addPlatformClient,
  addSystemKey,
  deletePlatformClient,
  deleteSystemKey,
  listPlatformClients,
  listSystemKeys,
  replacePlatformClientSecret,
  readKeyValue,
  replaceSystemKey,
  resolveSystemKeyId,
  type SystemKey,
} from '../../src/commands/realm-server/keys.js';
import { buildBoxelProgram } from '../../src/build-program.js';

const SEED = 'a realm secret seed for tests';
const VALUE = 'sk-or-v1-0123456789abcdef';

function systemKey(overrides: Partial<SystemKey> = {}): SystemKey {
  return {
    id: '6c1f3f8e-4a0e-4b9e-9a51-3c1d2b7a9e10',
    destination: 'https://openrouter.ai/api/v1/chat/completions',
    authMethod: 'header',
    paramName: null,
    creditStrategy: 'openrouter',
    supportsStreaming: true,
    hasValue: true,
    keyId: 'kms-0123456789abcdef',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// A realm server that answers the system-keys endpoints from `answers`, in
// order, and records each request.
function fakeServer(answers: { status?: number; body: unknown }[]) {
  let requests: {
    method: string;
    url: string;
    authorization: string;
    body: string | undefined;
    redirect: RequestRedirect | undefined;
  }[] = [];
  let fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    let headers = new Headers(init?.headers);
    requests.push({
      method: init?.method ?? 'GET',
      url: String(input),
      authorization: headers.get('Authorization') ?? '',
      body: init?.body as string | undefined,
      redirect: init?.redirect,
    });
    let { status = 200, body } = answers.shift()!;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const options = (fetch: typeof globalThis.fetch) => ({
  realmServerUrl: 'https://realms.example.test',
  realmSecretSeed: SEED,
  fetch,
});

// A terminal stdin that the test types into, and an output that records
// everything the prompt writes to the terminal.
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

describe('boxel realm-server keys', () => {
  it('asks the realm server with a minutes-long operator token for system-keys, signed with the seed', async () => {
    let { fetch, requests } = fakeServer([{ body: { keys: [systemKey()] } }]);
    let keys = await listSystemKeys(options(fetch));

    expect(keys).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toBe('https://realms.example.test/_system-keys');
    let token = requests[0].authorization.replace(/^Bearer /, '');
    let claims = jwt.verify(token, SEED) as Record<string, unknown>;
    expect(claims.operator).toBe('system-keys');
    expect(claims.aud).toBe('https://realms.example.test');
    expect(claims).not.toHaveProperty('user');
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(
      15 * 60,
    );
    expect(requests[0].authorization).not.toContain(SEED);
  });

  it('refuses redirects, so a body is never sent on to another origin', async () => {
    let { fetch, requests } = fakeServer([
      { status: 201, body: { key: systemKey() } },
    ]);
    await addSystemKey(options(fetch), {
      destination: 'https://openrouter.ai/api/v1/chat/completions',
      creditStrategy: 'openrouter',
      value: VALUE,
      note: 'adding the OpenRouter key',
    });
    expect(requests[0].redirect).toBe('error');
  });

  it('sends nothing to a realm server over plain http, except on this machine', async () => {
    for (let realmServerUrl of [
      'http://realms.example.test',
      'http://10.0.0.5:4201',
    ]) {
      let { fetch, requests } = fakeServer([]);
      await expect(
        addSystemKey(
          { realmServerUrl, realmSecretSeed: SEED, fetch },
          {
            destination: 'https://openrouter.ai/api/v1/chat/completions',
            creditStrategy: 'openrouter',
            value: VALUE,
            note: 'adding the OpenRouter key',
          },
        ),
      ).rejects.toThrow(/is not https/);
      expect(requests).toHaveLength(0);
    }
    for (let realmServerUrl of [
      'http://localhost:4201',
      'http://127.0.0.1:4201/',
      'http://[::1]:4201',
    ]) {
      let { fetch, requests } = fakeServer([{ body: { keys: [] } }]);
      await listSystemKeys({ realmServerUrl, realmSecretSeed: SEED, fetch });
      let token = requests[0].authorization.replace(/^Bearer /, '');
      expect((jwt.verify(token, SEED) as Record<string, unknown>).aud).toBe(
        new URL(realmServerUrl).origin,
      );
    }
  });

  it('adds, replaces and deletes a key with its note, sending the value only in the body', async () => {
    let { fetch, requests } = fakeServer([
      { status: 201, body: { key: systemKey() } },
      { body: { key: systemKey() } },
      { body: { deleted: systemKey() } },
    ]);
    let id = systemKey().id;
    await addSystemKey(options(fetch), {
      destination: 'https://openrouter.ai/api/v1/chat/completions',
      creditStrategy: 'openrouter',
      supportsStreaming: true,
      value: VALUE,
      note: 'adding the OpenRouter key',
    });
    await replaceSystemKey(options(fetch), id, {
      value: `${VALUE}-2`,
      note: 'rotating it',
    });
    let deleted = await deleteSystemKey(options(fetch), id, {
      note: 'retiring it',
    });

    expect(deleted.id).toBe(id);
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST https://realms.example.test/_system-keys',
      `PATCH https://realms.example.test/_system-keys/${id}`,
      `DELETE https://realms.example.test/_system-keys/${id}`,
    ]);
    expect(JSON.parse(requests[0].body!)).toEqual({
      destination: 'https://openrouter.ai/api/v1/chat/completions',
      creditStrategy: 'openrouter',
      supportsStreaming: true,
      value: VALUE,
      note: 'adding the OpenRouter key',
    });
    expect(JSON.parse(requests[1].body!)).toEqual({
      value: `${VALUE}-2`,
      note: 'rotating it',
    });
    expect(JSON.parse(requests[2].body!)).toEqual({ note: 'retiring it' });
    for (let { url } of requests) {
      expect(url).not.toContain(VALUE);
    }
  });

  it('finds a key by its destination, as the server spells it', async () => {
    let { fetch } = fakeServer([
      {
        body: {
          keys: [
            systemKey({ id: 'a', destination: 'https://vendor.test/' }),
            systemKey({ id: 'b', destination: 'https://other.test/v1' }),
          ],
        },
      },
    ]);
    expect(
      await resolveSystemKeyId(options(fetch), {
        destination: 'https://VENDOR.test',
      }),
    ).toBe('a');
    await expect(
      resolveSystemKeyId(options(fetch), { id: 'a', destination: 'x' }),
    ).rejects.toThrow(/not both/);
  });

  it("reports a refusal with the server's reason", async () => {
    let { fetch } = fakeServer([
      {
        status: 409,
        body: {
          errors: ['a system key for https://vendor.test/ already exists'],
        },
      },
    ]);
    await expect(
      addSystemKey(options(fetch), {
        destination: 'https://vendor.test/',
        creditStrategy: 'none',
        value: VALUE,
        note: 'n',
      }),
    ).rejects.toThrow(
      /HTTP 409: a system key for https:\/\/vendor.test\/ already exists/,
    );
  });

  describe('platform clients (--kind oauth-client)', () => {
    const GITHUB = {
      name: 'github',
      label: 'Boxel (read-only)',
      secret: 'github-client-secret-0123456789',
      oauth: {
        clientId: 'Iv23.boxel',
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        apiHosts: ['https://api.github.com/'],
      },
    };
    const client = {
      id: '0a4b5c6d-7e8f-4a0b-9c1d-2e3f4a5b6c7d',
      name: 'github',
      label: 'Boxel (read-only)',
      clientId: 'Iv23.boxel',
      grantType: 'authorization_code',
      authorizeURL: 'https://github.com/login/oauth/authorize',
      tokenURL: 'https://github.com/login/oauth/access_token',
      scopes: '',
      tokenAuth: 'client_secret_post',
      apiHosts: ['https://api.github.com/'],
      state: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('lists, adds, replaces the secret of and deletes a platform client with a system-keys operator token, the secret only in a body', async () => {
      let { fetch, requests } = fakeServer([
        { body: { clients: [client] } },
        { status: 201, body: { client } },
        { body: { client } },
        { body: { deleted: 'github' } },
      ]);
      expect(await listPlatformClients(options(fetch))).toEqual([client]);
      expect(await addPlatformClient(options(fetch), GITHUB)).toEqual(client);
      await replacePlatformClientSecret(
        options(fetch),
        'github',
        'github-client-secret-rotated',
      );
      await deletePlatformClient(options(fetch), 'github');

      expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
        'GET https://realms.example.test/_platform-oauth-clients',
        'POST https://realms.example.test/_platform-oauth-clients',
        'PATCH https://realms.example.test/_platform-oauth-clients/github',
        'DELETE https://realms.example.test/_platform-oauth-clients/github',
      ]);
      expect(JSON.parse(requests[1].body!)).toEqual(GITHUB);
      expect(JSON.parse(requests[2].body!)).toEqual({
        secret: 'github-client-secret-rotated',
      });
      for (let { url, authorization, redirect } of requests) {
        expect(url).not.toContain('secret');
        expect(redirect).toBe('error');
        let claims = jwt.verify(
          authorization.replace(/^Bearer /, ''),
          SEED,
        ) as Record<string, unknown>;
        expect(claims.operator).toBe('system-keys');
      }
    });

    it('takes a platform client by --name, its settings as flags, and refuses what belongs to a system key', async () => {
      let keys = buildBoxelProgram('0.0.0')
        .commands.find((command) => command.name() === 'realm-server')!
        .commands.find((command) => command.name() === 'keys')!;
      let add = keys.commands.find((command) => command.name() === 'add')!;
      expect(add.options.map((option) => option.long)).toEqual(
        expect.arrayContaining([
          '--kind',
          '--name',
          '--label',
          '--client-id',
          '--authorize-url',
          '--token-url',
          '--scopes',
          '--token-auth',
          '--api-host',
        ]),
      );
      for (let name of ['show', 'replace', 'delete']) {
        let command = keys.commands.find((c) => c.name() === name)!;
        expect(command.options.map((option) => option.long)).toEqual(
          expect.arrayContaining(['--kind', '--name']),
        );
      }
    });
  });

  describe('reading the value', () => {
    it('masks every character at the prompt and reveals only the last few after Enter', async () => {
      let terminal = fakeTerminal();
      let reading = readKeyValue(
        {},
        { input: terminal.input, output: terminal.output },
      );
      terminal.type(VALUE.slice(0, 10));
      terminal.type(`${VALUE.slice(10)}\r`);
      expect(await reading).toBe(VALUE);

      let written = terminal.written();
      expect(written).toContain('Key value: ');
      expect(written).toContain('*'.repeat(VALUE.length));
      expect(written).toContain(`ending in ${VALUE.slice(-4)}`);
      expect(written).not.toContain(VALUE.slice(0, -4));
      expect(written).not.toContain(VALUE.slice(-5));
    });

    it('strips bracketed-paste markers but keeps the same text typed without their escape', async () => {
      let terminal = fakeTerminal();
      let reading = readKeyValue(
        {},
        { input: terminal.input, output: terminal.output },
      );
      terminal.type('\u001b[200~sk-a[201~bcdefgh\u001b[201~\r');
      expect(await reading).toBe('sk-a[201~bcdefgh');
    });

    it('reveals nothing of a short value', async () => {
      let terminal = fakeTerminal();
      let reading = readKeyValue(
        {},
        { input: terminal.input, output: terminal.output },
      );
      terminal.type('abc\n');
      expect(await reading).toBe('abc');
      expect(terminal.written()).toBe('Key value: ***\n');
    });

    it('reads stdin or a file, dropping one trailing newline', async () => {
      let stdin = new PassThrough();
      stdin.end(`${VALUE}\n`);
      expect(
        await readKeyValue(
          { stdin: true },
          { input: stdin as unknown as NodeJS.ReadStream },
        ),
      ).toBe(VALUE);

      let file = join(mkdtempSync(join(tmpdir(), 'system-key-')), 'key');
      writeFileSync(file, `${VALUE}\r\n`);
      expect(await readKeyValue({ keyFile: file })).toBe(VALUE);
    });

    it('refuses without a terminal, --stdin or --key-file', async () => {
      let stdin = new PassThrough() as unknown as NodeJS.ReadStream;
      await expect(readKeyValue({}, { input: stdin })).rejects.toThrow(
        /stdin is not a terminal. Pass --stdin or --key-file/,
      );
      await expect(
        readKeyValue({ stdin: true, keyFile: 'x' }, { input: stdin }),
      ).rejects.toThrow(/not both/);
    });
  });

  it('takes no value as an argument, and stays out of the general help', () => {
    let program = buildBoxelProgram('0.0.0');
    expect(program.helpInformation()).not.toContain('realm-server');
    let keys = program.commands
      .find((command) => command.name() === 'realm-server')
      ?.commands.find((command) => command.name() === 'keys');
    expect(keys?.commands.map((command) => command.name())).toEqual([
      'list',
      'show',
      'add',
      'replace',
      'delete',
    ]);
    for (let command of keys!.commands) {
      for (let option of command.options) {
        expect(option.long).not.toMatch(/^--(value|key|api-key|secret)$/);
      }
    }
  });
});
