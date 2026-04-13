import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProfileManager } from '../../src/lib/profile-manager.js';

function encodeJwt(payload: object): string {
  let header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  let body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('ProfileManager.authedFetch', () => {
  let tmpDir: string;
  let manager: ProfileManager;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-authed-fetch-'));
    manager = new ProfileManager(tmpDir);
    await manager.addProfile(
      '@test:localhost',
      'pass',
      'Test',
      'http://matrix.test',
      'http://realm-server.test/',
    );
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('retries with a refreshed server token after a 401', async () => {
    let nowSec = Math.floor(Date.now() / 1000);
    let initialToken = encodeJwt({ exp: nowSec + 3600 });
    let refreshedToken = encodeJwt({ exp: nowSec + 3600 });
    manager.setRealmServerToken(initialToken);

    let refreshCalls = 0;
    manager.refreshServerToken = async () => {
      refreshCalls++;
      manager.setRealmServerToken(refreshedToken);
      return refreshedToken;
    };

    let observed: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      observed.push(new Headers(init?.headers).get('Authorization') ?? '');
      if (observed.length === 1) {
        return new Response('unauthorized', { status: 401 });
      }
      return new Response('ok', { status: 200 });
    }) as typeof globalThis.fetch;

    let response = await manager.authedFetch('http://target.test/foo');

    expect(response.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(observed).toEqual([initialToken, refreshedToken]);
  });

  it('proactively refreshes a cached server token that is about to expire', async () => {
    let nowSec = Math.floor(Date.now() / 1000);
    // Within the 60s default lead time → treated as expiring.
    let nearlyExpiredToken = encodeJwt({ exp: nowSec + 30 });
    let refreshedToken = encodeJwt({ exp: nowSec + 3600 });
    manager.setRealmServerToken(nearlyExpiredToken);

    let refreshCalls = 0;
    manager.refreshServerToken = async () => {
      refreshCalls++;
      manager.setRealmServerToken(refreshedToken);
      return refreshedToken;
    };

    let observed: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      observed.push(new Headers(init?.headers).get('Authorization') ?? '');
      return new Response('ok', { status: 200 });
    }) as typeof globalThis.fetch;

    let response = await manager.authedFetch('http://target.test/foo');

    expect(response.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(observed).toEqual([refreshedToken]);
  });

  it('uses the cached per-realm token when given { realmUrl }', async () => {
    let nowSec = Math.floor(Date.now() / 1000);
    let realmUrl = 'http://realm-server.test/my-realm/';
    let realmToken = encodeJwt({ exp: nowSec + 3600 });
    manager.setRealmToken(realmUrl, realmToken);

    let observed: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      observed.push(new Headers(init?.headers).get('Authorization') ?? '');
      return new Response('ok', { status: 200 });
    }) as typeof globalThis.fetch;

    let response = await manager.authedFetch(`${realmUrl}_info`, undefined, {
      realmUrl,
    });

    expect(response.status).toBe(200);
    expect(observed).toEqual([realmToken]);
  });

  it('refreshes the per-realm token after a 401 when given { realmUrl }', async () => {
    let nowSec = Math.floor(Date.now() / 1000);
    let realmUrl = 'http://realm-server.test/my-realm/';
    let initialRealmToken = encodeJwt({ exp: nowSec + 3600 });
    let refreshedRealmToken = encodeJwt({ exp: nowSec + 3600 });
    let serverToken = encodeJwt({ exp: nowSec + 3600 });
    manager.setRealmToken(realmUrl, initialRealmToken);
    manager.setRealmServerToken(serverToken);

    let fetchAndStoreCalls = 0;
    manager.fetchAndStoreRealmToken = async (target) => {
      fetchAndStoreCalls++;
      expect(target).toBe(realmUrl);
      manager.setRealmToken(realmUrl, refreshedRealmToken);
      return refreshedRealmToken;
    };

    let observed: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      observed.push(new Headers(init?.headers).get('Authorization') ?? '');
      if (observed.length === 1) {
        return new Response('unauthorized', { status: 401 });
      }
      return new Response('ok', { status: 200 });
    }) as typeof globalThis.fetch;

    let response = await manager.authedFetch(`${realmUrl}_info`, undefined, {
      realmUrl,
    });

    expect(response.status).toBe(200);
    expect(fetchAndStoreCalls).toBe(1);
    expect(observed).toEqual([initialRealmToken, refreshedRealmToken]);
  });
});
