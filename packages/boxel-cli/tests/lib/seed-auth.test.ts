import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  SeedAuthenticator,
  DEFAULT_REALM_BOT_USERNAME,
  deriveBotUserId,
  deriveHostFromRealmUrl,
  deriveRealmServerUrl,
} from '../../src/lib/seed-auth.ts';

const SEED = 'shhh-its-a-secret';

describe('deriveHostFromRealmUrl', () => {
  it('collapses *.localhost to localhost', () => {
    expect(
      deriveHostFromRealmUrl('http://realm.localhost:4201/hassan/demo/'),
    ).toBe('localhost');
  });

  it('treats bare localhost as localhost', () => {
    expect(deriveHostFromRealmUrl('http://localhost:4201/hassan/demo/')).toBe(
      'localhost',
    );
  });

  it('returns the last two labels for three-label domains', () => {
    expect(
      deriveHostFromRealmUrl('https://realms-staging.stack.cards/hassan/my/'),
    ).toBe('stack.cards');
    expect(deriveHostFromRealmUrl('https://app.boxel.ai/')).toBe('boxel.ai');
  });

  it('returns the whole hostname for two-label domains', () => {
    expect(deriveHostFromRealmUrl('https://boxel.ai/')).toBe('boxel.ai');
  });

  it('returns the whole hostname for single-label hosts', () => {
    expect(deriveHostFromRealmUrl('http://myhost/x/y/')).toBe('myhost');
  });
});

describe('deriveBotUserId', () => {
  it('uses the default realm_server username', () => {
    expect(deriveBotUserId('http://localhost:4201/demo/')).toBe(
      `@${DEFAULT_REALM_BOT_USERNAME}:localhost`,
    );
    expect(
      deriveBotUserId('https://realms-staging.stack.cards/hassan/my/'),
    ).toBe('@realm_server:stack.cards');
    expect(deriveBotUserId('https://app.boxel.ai/demo/')).toBe(
      '@realm_server:boxel.ai',
    );
  });

  it('honors a username override', () => {
    expect(
      deriveBotUserId('http://localhost:4201/demo/', 'node-test_realm-server'),
    ).toBe('@node-test_realm-server:localhost');
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
    expect(() => new SeedAuthenticator({ seed: '' })).toThrow(/non-empty seed/);
  });

  it('builds claims with bot user id, realm URL, realmServerURL, and empty permissions', () => {
    const auth = new SeedAuthenticator({ seed: SEED });
    const claims = auth.buildClaims('https://app.boxel.ai/demo/');
    expect(claims).toEqual({
      user: '@realm_server:boxel.ai',
      realm: 'https://app.boxel.ai/demo/',
      sessionRoom: undefined,
      permissions: [],
      realmServerURL: 'https://app.boxel.ai/',
    });
  });

  it('normalizes realm URLs without trailing slash', () => {
    const auth = new SeedAuthenticator({ seed: SEED });
    const claims = auth.buildClaims('https://app.boxel.ai/demo');
    expect(claims.realm).toBe('https://app.boxel.ai/demo/');
  });

  it('mints a JWT that verifies against the seed and decodes to the expected payload', () => {
    const auth = new SeedAuthenticator({ seed: SEED });
    const token = auth.mintTokenForRealm('https://app.boxel.ai/demo/');
    const decoded = jwt.verify(token, SEED) as Record<string, unknown>;
    expect(decoded.user).toBe('@realm_server:boxel.ai');
    expect(decoded.realm).toBe('https://app.boxel.ai/demo/');
    expect(decoded.realmServerURL).toBe('https://app.boxel.ai/');
    expect(decoded.permissions).toEqual([]);
    expect(typeof decoded.exp).toBe('number');
    expect(typeof decoded.iat).toBe('number');
    // 7-day default expiry is in the ballpark of 7 * 24 * 3600 seconds
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(
      7 * 24 * 3600,
    );
  });

  it('caches tokens per realm URL (same call returns identical string)', () => {
    const auth = new SeedAuthenticator({ seed: SEED });
    const realmUrl = 'https://app.boxel.ai/demo/';
    const first = auth.mintTokenForRealm(realmUrl);
    const second = auth.mintTokenForRealm(realmUrl);
    expect(second).toBe(first);
  });

  it('honors a botUserId override (used by integration tests against IP realms)', () => {
    const auth = new SeedAuthenticator({
      seed: SEED,
      botUserId: '@node-test_realm-server:localhost',
    });
    const claims = auth.buildClaims('http://127.0.0.1:4446/test/');
    expect(claims.user).toBe('@node-test_realm-server:localhost');
    // realmServerURL is still derived from the realm URL origin
    expect(claims.realmServerURL).toBe('http://127.0.0.1:4446/');
  });

  it('honors a botUsername override on top of the derived host', () => {
    const auth = new SeedAuthenticator({
      seed: SEED,
      botUsername: 'custom_bot',
    });
    const claims = auth.buildClaims('https://app.boxel.ai/demo/');
    expect(claims.user).toBe('@custom_bot:boxel.ai');
  });
});
