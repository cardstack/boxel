import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveRealmSecretSeed } from '../../src/lib/prompt';

describe('resolveRealmSecretSeed', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.BOXEL_REALM_SECRET_SEED;
    delete process.env.BOXEL_REALM_SECRET_SEED;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BOXEL_REALM_SECRET_SEED;
    } else {
      process.env.BOXEL_REALM_SECRET_SEED = originalEnv;
    }
  });

  it('returns undefined when the flag is absent and no env var is set', async () => {
    await expect(resolveRealmSecretSeed(false)).resolves.toBeUndefined();
  });

  it('returns the env var silently, even when the flag is absent', async () => {
    process.env.BOXEL_REALM_SECRET_SEED = 'env-seed';
    await expect(resolveRealmSecretSeed(false)).resolves.toBe('env-seed');
  });

  it('prefers the env var over prompting when both would apply', async () => {
    // If the env var is present, we must NOT prompt the TTY — this test
    // would hang on stdin if the implementation reached promptPassword.
    process.env.BOXEL_REALM_SECRET_SEED = 'env-seed';
    await expect(resolveRealmSecretSeed(true)).resolves.toBe('env-seed');
  });
});
