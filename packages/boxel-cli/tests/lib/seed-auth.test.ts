import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  SeedAuthenticator,
  DEFAULT_REALM_BOT_USERNAME,
  MATRIX_SERVER_NAME_ENV,
  botUserId,
  deriveOwnerUserId,
  deriveRealmServerUrl,
  resolveMatrixServerName,
} from '../../src/lib/seed-auth.ts';

const SEED = 'shhh-its-a-secret';

// Seed mode names the Matrix server explicitly; nothing here may pick one up
// from the developer's shell.
let savedServerName: string | undefined;
beforeEach(() => {
  savedServerName = process.env[MATRIX_SERVER_NAME_ENV];
  delete process.env[MATRIX_SERVER_NAME_ENV];
});
afterEach(() => {
  if (savedServerName === undefined) {
    delete process.env[MATRIX_SERVER_NAME_ENV];
  } else {
    process.env[MATRIX_SERVER_NAME_ENV] = savedServerName;
  }
});

describe('resolveMatrixServerName', () => {
  it('prefers an explicit name over the environment', () => {
    process.env[MATRIX_SERVER_NAME_ENV] = 'env.example';
    expect(resolveMatrixServerName('explicit.example')).toBe(
      'explicit.example',
    );
  });

  it('reads MATRIX_SERVER_NAME when no name is given', () => {
    process.env[MATRIX_SERVER_NAME_ENV] = 'env.example';
    expect(resolveMatrixServerName()).toBe('env.example');
    expect(resolveMatrixServerName('  ')).toBe('env.example');
  });

  it('refuses to guess when neither names a server', () => {
    expect(() => resolveMatrixServerName()).toThrow(/MATRIX_SERVER_NAME/);
    expect(() => resolveMatrixServerName('')).toThrow(/paired/);
  });
});

describe('botUserId', () => {
  it('names the default realm_server account on the given server', () => {
    expect(botUserId('localhost')).toBe(
      `@${DEFAULT_REALM_BOT_USERNAME}:localhost`,
    );
    expect(botUserId('example.test')).toBe('@realm_server:example.test');
  });

  it('honors a username override', () => {
    expect(botUserId('localhost', 'node-test_realm-server')).toBe(
      '@node-test_realm-server:localhost',
    );
  });
});

describe('deriveOwnerUserId', () => {
  it("names the realm path's first segment on the given server", () => {
    expect(
      deriveOwnerUserId(
        'https://realms.example.test/example-owner/demo/',
        'example.test',
      ),
    ).toBe('@example-owner:example.test');
  });

  it('never takes the server from the realm hostname', () => {
    // A server named `example.test` may be served from any host.
    expect(
      deriveOwnerUserId(
        'https://realms-staging.other.example/example-owner/demo/',
        'example.test',
      ),
    ).toBe('@example-owner:example.test');
  });

  it('refuses a URL that is not <host>/<owner>/<realm>/', () => {
    expect(() =>
      deriveOwnerUserId('https://realms.example.test/', 'example.test'),
    ).toThrow(/not a <host>\/<owner>\/<realm>\/ realm URL/);
    expect(() =>
      deriveOwnerUserId('https://realms.example.test/only/', 'example.test'),
    ).toThrow(/Cannot derive realm owner/);
  });
});

describe('deriveRealmServerUrl', () => {
  it('returns origin with trailing slash', () => {
    expect(deriveRealmServerUrl('https://app.boxel.ai/demo/')).toBe(
      'https://app.boxel.ai/',
    );
    expect(
      deriveRealmServerUrl('https://realms-staging.stack.cards/hassan/my/'),
    ).toBe('https://realms-staging.stack.cards/');
    expect(deriveRealmServerUrl('http://localhost:4201/demo/')).toBe(
      'http://localhost:4201/',
    );
  });
});

describe('SeedAuthenticator', () => {
  it('refuses an empty seed', () => {
    expect(
      () => new SeedAuthenticator({ seed: '', matrixServerName: 'localhost' }),
    ).toThrow(/non-empty seed/);
  });

  it('refuses to construct without a Matrix server name', () => {
    expect(() => new SeedAuthenticator({ seed: SEED })).toThrow(
      /MATRIX_SERVER_NAME/,
    );
  });

  it('reads the Matrix server name from the environment', () => {
    process.env[MATRIX_SERVER_NAME_ENV] = 'env.example';
    const auth = new SeedAuthenticator({ seed: SEED });
    expect(auth.buildClaims('https://realms.example.test/demo/').user).toBe(
      '@realm_server:env.example',
    );
  });

  it('builds claims with bot user id, realm URL, realmServerURL, and empty permissions', () => {
    const auth = new SeedAuthenticator({
      seed: SEED,
      matrixServerName: 'example.test',
    });
    const claims = auth.buildClaims('https://realms.example.test/demo/');
    expect(claims).toEqual({
      user: '@realm_server:example.test',
      realm: 'https://realms.example.test/demo/',
      sessionRoom: undefined,
      permissions: [],
      realmServerURL: 'https://realms.example.test/',
    });
  });

  it('names the bot on the configured server, whatever host serves the realm', () => {
    const auth = new SeedAuthenticator({
      seed: SEED,
      matrixServerName: 'example.test',
    });
    expect(
      auth.buildClaims('https://realms-staging.other.example/demo/').user,
    ).toBe('@realm_server:example.test');
  });

  it('normalizes realm URLs without trailing slash', () => {
    const auth = new SeedAuthenticator({
      seed: SEED,
      matrixServerName: 'example.test',
    });
    const claims = auth.buildClaims('https://realms.example.test/demo');
    expect(claims.realm).toBe('https://realms.example.test/demo/');
  });

  it('mints a JWT that verifies against the seed and decodes to the expected payload', () => {
    const auth = new SeedAuthenticator({
      seed: SEED,
      matrixServerName: 'example.test',
    });
    const token = auth.mintTokenForRealm('https://realms.example.test/demo/');
    const decoded = jwt.verify(token, SEED) as Record<string, unknown>;
    expect(decoded.user).toBe('@realm_server:example.test');
    expect(decoded.realm).toBe('https://realms.example.test/demo/');
    expect(decoded.realmServerURL).toBe('https://realms.example.test/');
    expect(decoded.permissions).toEqual([]);
    expect(typeof decoded.exp).toBe('number');
    expect(typeof decoded.iat).toBe('number');
    // 7-day default expiry is in the ballpark of 7 * 24 * 3600 seconds
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(
      7 * 24 * 3600,
    );
  });

  it('caches tokens per realm URL (same call returns identical string)', () => {
    const auth = new SeedAuthenticator({
      seed: SEED,
      matrixServerName: 'example.test',
    });
    const realmUrl = 'https://realms.example.test/demo/';
    const first = auth.mintTokenForRealm(realmUrl);
    const second = auth.mintTokenForRealm(realmUrl);
    expect(second).toBe(first);
  });

  it('honors a botUserId override, which needs no server name', () => {
    const auth = new SeedAuthenticator({
      seed: SEED,
      botUserId: '@node-test_realm-server:localhost',
    });
    const claims = auth.buildClaims('http://127.0.0.1:4446/test/');
    expect(claims.user).toBe('@node-test_realm-server:localhost');
    // realmServerURL is still derived from the realm URL origin
    expect(claims.realmServerURL).toBe('http://127.0.0.1:4446/');
  });

  it('honors a botUsername override on the configured server', () => {
    const auth = new SeedAuthenticator({
      seed: SEED,
      matrixServerName: 'example.test',
      botUsername: 'custom_bot',
    });
    const claims = auth.buildClaims('https://realms.example.test/demo/');
    expect(claims.user).toBe('@custom_bot:example.test');
  });
});
