import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough, Writable } from 'stream';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import jwt from 'jsonwebtoken';

import {
  deletePlatformSecret,
  listPlatformSecrets,
  readSecretValue,
  setPlatformSecret,
  showPlatformSecret,
  type PlatformSecret,
} from '../../src/commands/realm-server/secrets.js';
import { buildBoxelProgram } from '../../src/build-program.js';

const SEED = 'a realm secret seed for tests';
const NAME = 'openrouter-batch-webhook-signing';
const VALUE = 'whsec-9f8e7d6c5b4a3928zqxv';

function platformSecret(
  overrides: Partial<PlatformSecret> = {},
): PlatformSecret {
  return {
    name: NAME,
    keyId: 'kms-0123456789abcdef',
    note: 'setting the webhook secret',
    setAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// A realm server that answers the platform-secrets endpoints from `answers`,
// in order, and records each request.
function fakeServer(answers: { status?: number; body: unknown }[]) {
  let requests: {
    method: string;
    url: string;
    authorization: string;
    body: string | undefined;
  }[] = [];
  let fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    let headers = new Headers(init?.headers);
    requests.push({
      method: init?.method ?? 'GET',
      url: String(input),
      authorization: headers.get('Authorization') ?? '',
      body: init?.body as string | undefined,
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

describe('boxel realm-server secrets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('asks the realm server with a minutes-long operator token for platform-secrets, signed with the seed', async () => {
    let { fetch, requests } = fakeServer([
      { body: { secrets: [platformSecret()] } },
    ]);
    let secrets = await listPlatformSecrets(options(fetch));

    expect(secrets).toEqual([platformSecret()]);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toBe(
      'https://realms.example.test/_platform-secrets',
    );
    let token = requests[0].authorization.replace(/^Bearer /, '');
    let claims = jwt.verify(token, SEED) as Record<string, unknown>;
    expect(claims.operator).toBe('platform-secrets');
    expect(claims.aud).toBe('https://realms.example.test');
    expect(claims).not.toHaveProperty('user');
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(
      15 * 60,
    );
  });

  it('shows, sets and deletes a secret by name, sending the value only in the body of a set', async () => {
    let { fetch, requests } = fakeServer([
      { body: { secret: platformSecret() } },
      { status: 201, body: { secret: platformSecret() } },
      { body: { deleted: platformSecret() } },
    ]);
    await showPlatformSecret(options(fetch), NAME);
    await setPlatformSecret(options(fetch), NAME, {
      value: VALUE,
      note: 'setting the webhook secret',
    });
    let deleted = await deletePlatformSecret(options(fetch), NAME, {
      note: 'retiring it',
    });

    expect(deleted.name).toBe(NAME);
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `GET https://realms.example.test/_platform-secrets/${NAME}`,
      `PUT https://realms.example.test/_platform-secrets/${NAME}`,
      `DELETE https://realms.example.test/_platform-secrets/${NAME}`,
    ]);
    expect(JSON.parse(requests[1].body!)).toEqual({
      value: VALUE,
      note: 'setting the webhook secret',
    });
    expect(JSON.parse(requests[2].body!)).toEqual({ note: 'retiring it' });
    for (let request of requests) {
      expect(request.url).not.toContain(VALUE);
      expect(request.authorization).not.toContain(VALUE);
    }
  });

  it("reports a refusal with the server's reason", async () => {
    let { fetch } = fakeServer([
      {
        status: 400,
        body: { errors: ['the note must not contain the value'] },
      },
    ]);
    await expect(
      setPlatformSecret(options(fetch), NAME, {
        value: VALUE,
        note: 'a note',
      }),
    ).rejects.toThrow(/HTTP 400: the note must not contain the value/);
  });

  it('masks every character at the prompt and reveals nothing of the value after Enter', async () => {
    let terminal = fakeTerminal();
    let reading = readSecretValue(
      {},
      { input: terminal.input, output: terminal.output },
    );
    terminal.type(`${VALUE}\r`);
    expect(await reading).toBe(VALUE);
    let written = terminal.written();
    expect(written).toBe(`Secret value: ${'*'.repeat(VALUE.length)}\n`);
  });

  it('reads the value from a file, dropping one trailing newline', async () => {
    let file = join(mkdtempSync(join(tmpdir(), 'secrets-')), 'value');
    writeFileSync(file, `${VALUE}\n`);
    expect(await readSecretValue({ keyFile: file })).toBe(VALUE);
  });

  it('no command prints the value, whole or in part', async () => {
    let file = join(mkdtempSync(join(tmpdir(), 'secrets-')), 'value');
    writeFileSync(file, VALUE);
    let { fetch, requests } = fakeServer([
      { status: 201, body: { secret: platformSecret() } },
      { body: { secrets: [platformSecret()] } },
      { body: { secret: platformSecret() } },
      { body: { deleted: platformSecret() } },
    ]);
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('BOXEL_REALM_SECRET_SEED', SEED);
    let printed = '';
    let record = (...args: unknown[]) => {
      printed += `${args.map(String).join(' ')}\n`;
    };
    vi.spyOn(console, 'log').mockImplementation(record);
    vi.spyOn(console, 'error').mockImplementation(record);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      record(chunk);
      return true;
    });
    let common = ['--realm-server', 'https://realms.example.test'];
    for (let args of [
      [
        'set',
        ...common,
        '--name',
        NAME,
        '--key-file',
        file,
        '--note',
        'setting the webhook secret',
      ],
      ['list', ...common],
      ['show', ...common, '--name', NAME],
      ['delete', ...common, '--name', NAME, '--note', 'retiring it'],
    ]) {
      await buildBoxelProgram('0.0.0').parseAsync([
        'node',
        'boxel',
        'realm-server',
        'secrets',
        ...args,
      ]);
    }

    expect(requests.map(({ method }) => method)).toEqual([
      'PUT',
      'GET',
      'GET',
      'DELETE',
    ]);
    expect(JSON.parse(requests[0].body!).value).toBe(VALUE);
    expect(printed).toContain(NAME);
    expect(printed).toContain('sealed under data key kms-0123456789abcdef');
    for (let fragment of [VALUE, VALUE.slice(-4), VALUE.slice(0, 8)]) {
      expect(printed).not.toContain(fragment);
    }
  });
});
