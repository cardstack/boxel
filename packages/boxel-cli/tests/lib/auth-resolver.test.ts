import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveRealmAuthenticator } from '../../src/lib/auth-resolver';
import { SeedAuthenticator } from '../../src/lib/seed-auth';
import { ProfileManager } from '../../src/lib/profile-manager';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('resolveRealmAuthenticator', () => {
  let profileDir: string;
  let pm: ProfileManager;

  beforeEach(() => {
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-auth-resolver-'));
    pm = new ProfileManager(profileDir);
    delete process.env.BOXEL_REALM_SECRET_SEED;
  });

  afterEach(() => {
    fs.rmSync(profileDir, { recursive: true, force: true });
    delete process.env.BOXEL_REALM_SECRET_SEED;
  });

  it('returns a SeedAuthenticator when --realm-secret-seed is passed', () => {
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

  it('falls back to BOXEL_REALM_SECRET_SEED env var when the flag is absent', () => {
    process.env.BOXEL_REALM_SECRET_SEED = 'env-seed';
    const result = resolveRealmAuthenticator({
      realmUrl: 'https://app.boxel.ai/demo/',
      profileManager: pm,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('seed');
    }
  });

  it('prefers the explicit flag over the env var', () => {
    process.env.BOXEL_REALM_SECRET_SEED = 'env-seed';
    const result = resolveRealmAuthenticator({
      realmUrl: 'https://app.boxel.ai/demo/',
      realmSecretSeed: 'flag-seed',
      profileManager: pm,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('seed');
    }
  });

  it('returns the profile manager when no seed is supplied and a profile is active', async () => {
    await pm.addProfile(
      '@ctse:stack.cards',
      'password',
      'Test',
      'https://matrix-staging.stack.cards',
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
});
