import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveRealmAuthenticator } from '../../src/lib/auth-resolver.ts';
import { SeedAuthenticator } from '../../src/lib/seed-auth.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('resolveRealmAuthenticator', () => {
  let profileDir: string;
  let pm: ProfileManager;
  let priorBotUsername: string | undefined;

  beforeEach(() => {
    priorBotUsername = process.env.BOXEL_REALM_BOT_USERNAME;
    delete process.env.BOXEL_REALM_BOT_USERNAME;
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-auth-resolver-'));
    pm = new ProfileManager(profileDir);
  });

  afterEach(() => {
    if (priorBotUsername === undefined) {
      delete process.env.BOXEL_REALM_BOT_USERNAME;
    } else {
      process.env.BOXEL_REALM_BOT_USERNAME = priorBotUsername;
    }
    fs.rmSync(profileDir, { recursive: true, force: true });
  });

  it('returns a SeedAuthenticator when a seed is supplied', () => {
    const result = resolveRealmAuthenticator({
      realmUrl: 'https://app.boxel.ai/demo/',
      realmSecretSeed: 'my-seed',
      profileManager: pm,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('seed');
      expect(result.authenticator).toBeInstanceOf(SeedAuthenticator);
    }
  });

  it('can target a non-default local Realm Server identity', () => {
    process.env.BOXEL_REALM_BOT_USERNAME = 'deck_worker';
    const result = resolveRealmAuthenticator({
      realmUrl: 'https://localhost:4201/pretui/',
      realmSecretSeed: 'my-seed',
      profileManager: pm,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        (result.authenticator as SeedAuthenticator).buildClaims(
          'https://localhost:4201/pretui/',
        ).user,
      ).toBe('@deck_worker:localhost');
    }
  });

  it('returns the profile manager when no seed is supplied and a profile is active', async () => {
    // Bypass the Matrix login round-trip — this test only cares that a
    // profile is present, not that it was minted by a real login.
    await pm.addProfileWithAuth(
      '@ctse:stack.cards',
      {
        accessToken: 'test-access-token',
        userId: '@ctse:stack.cards',
        deviceId: 'TEST_DEVICE',
        matrixUrl: 'https://matrix-staging.stack.cards',
      },
      'Test',
      'https://realms-staging.stack.cards/',
    );
    const result = resolveRealmAuthenticator({
      realmUrl: 'https://realms-staging.stack.cards/demo/',
      profileManager: pm,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('profile');
      expect(result.authenticator).toBe(pm);
    }
  });

  it('returns an error when no seed and no active profile exist', () => {
    const result = resolveRealmAuthenticator({
      realmUrl: 'https://app.boxel.ai/demo/',
      profileManager: pm,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No active profile');
    }
  });

  it('returns a friendly error (not a throw) when the realm URL is malformed in seed mode', () => {
    const result = resolveRealmAuthenticator({
      realmUrl: 'not-a-url',
      realmSecretSeed: 'my-seed',
      profileManager: pm,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Invalid realm URL/);
    }
  });
});
