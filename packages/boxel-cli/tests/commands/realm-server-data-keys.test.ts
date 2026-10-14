import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';

import {
  dataKeysReseal,
  dataKeysStatus,
  type DataKeyStatus,
} from '../../src/commands/realm-server/data-keys.js';
import { buildBoxelProgram } from '../../src/build-program.js';

const SEED = 'a realm secret seed for tests';

function status(overrides: Partial<DataKeyStatus> = {}): DataKeyStatus {
  return {
    currentKeyId: 'kms-new',
    loadedKeyIds: ['kms-new', 'kms-old'],
    columns: [
      {
        field: 'proxy_endpoints.api_key',
        rowsByKeyId: { 'kms-old': 2, 'kms-new': 1 },
      },
    ],
    rowsToReseal: 2,
    retirableKeyIds: [],
    unloadedKeyIds: [],
    pass: { running: false },
    ...overrides,
  };
}

// A realm server that answers the data-keys endpoints from `answers`, in
// order, and records each request.
function fakeServer(answers: unknown[]) {
  let requests: { method: string; url: string; authorization: string }[] = [];
  let fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    let headers = new Headers(init?.headers);
    requests.push({
      method: init?.method ?? 'GET',
      url: String(input),
      authorization: headers.get('Authorization') ?? '',
    });
    let body = answers.shift();
    return new Response(JSON.stringify(body), {
      status: init?.method === 'POST' ? 202 : 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

describe('boxel realm-server data-keys', () => {
  it('asks the realm server with a minutes-long operator token for data-keys, signed with the seed', async () => {
    let { fetch, requests } = fakeServer([status()]);
    let result = await dataKeysStatus({
      realmServerUrl: 'https://realms.example.test',
      realmSecretSeed: SEED,
      fetch,
    });

    expect(result.rowsToReseal).toBe(2);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toBe('https://realms.example.test/_data-keys');
    let token = requests[0].authorization.replace(/^Bearer /, '');
    let claims = jwt.verify(token, SEED) as Record<string, unknown>;
    expect(claims.operator).toBe('data-keys');
    expect(claims).not.toHaveProperty('user');
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(
      15 * 60,
    );
    expect(requests[0].authorization).not.toContain(SEED);
  });

  it('starts a pass and, with --wait, polls until no row is left to re-seal', async () => {
    let { fetch, requests } = fakeServer([
      { started: true, pass: { running: true } },
      status({ pass: { running: true } }),
      status({ rowsToReseal: 1, pass: { running: true } }),
      status({
        rowsToReseal: 0,
        retirableKeyIds: ['kms-old'],
        pass: { running: false },
      }),
    ]);
    let { started, status: final } = await dataKeysReseal({
      realmServerUrl: 'https://realms.example.test/',
      realmSecretSeed: SEED,
      fetch,
      wait: true,
      pollIntervalMs: 1,
    });

    expect(started).toBe(true);
    expect(final.rowsToReseal).toBe(0);
    expect(final.retirableKeyIds).toEqual(['kms-old']);
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST https://realms.example.test/_data-keys/reseal',
      'GET https://realms.example.test/_data-keys',
      'GET https://realms.example.test/_data-keys',
      'GET https://realms.example.test/_data-keys',
    ]);
  });

  it('reports a refused call with its status', async () => {
    let fetch = (async () =>
      new Response('Token invalid', {
        status: 401,
      })) as unknown as typeof globalThis.fetch;
    await expect(
      dataKeysStatus({
        realmServerUrl: 'https://realms.example.test',
        realmSecretSeed: SEED,
        fetch,
      }),
    ).rejects.toThrow(/HTTP 401: Token invalid/);
  });

  it('keeps the realm-server namespace out of the general help', () => {
    let program = buildBoxelProgram('0.0.0');
    expect(program.helpInformation()).not.toContain('realm-server');
    let realmServer = program.commands.find(
      (command) => command.name() === 'realm-server',
    );
    expect(
      realmServer?.commands
        .find((command) => command.name() === 'data-keys')
        ?.commands.map((command) => command.name()),
    ).toEqual(['status', 'reseal']);
  });
});
