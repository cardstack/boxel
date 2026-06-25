import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { read } from '../../src/commands/file/read.ts';
import { write } from '../../src/commands/file/write.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  realmSecretSeed,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';

// The test realm grants `'*': ['read','write']`, so any token validly signed
// with `realmSecretSeed` may read and write — which is what the seed-auth path
// produces (a locally-minted JWT, no Matrix login).
let realmUrl: string;

beforeAll(async () => {
  await startTestRealmServer({
    fileSystem: { 'seed-existing.gts': 'export const existing = true;\n' },
  });
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
});

afterAll(async () => {
  await stopTestRealmServer();
});

describe('file read/write with seed-based auth (integration)', () => {
  it('writes then reads a file authenticating via the seed (no Matrix profile)', async () => {
    // Empty profile: no Matrix login exists, so success proves the seed path.
    let { profileManager, cleanup } = createTestProfileDir();
    try {
      let writeResult = await write(
        realmUrl,
        'seed-roundtrip.gts',
        'export const seeded = 42;\n',
        { realmSecretSeed, profileManager },
      );
      expect(writeResult.error).toBeUndefined();
      expect(writeResult.ok).toBe(true);

      let readResult = await read(realmUrl, 'seed-roundtrip.gts', {
        realmSecretSeed,
        profileManager,
      });
      expect(readResult.ok).toBe(true);
      expect(readResult.content).toContain('seeded = 42');
    } finally {
      cleanup();
    }
  });

  it('fails cleanly with "No active profile" when neither a seed nor a profile is configured', async () => {
    let { profileManager, cleanup } = createTestProfileDir();
    try {
      let result = await read(realmUrl, 'seed-existing.gts', {
        profileManager,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No active profile');
    } finally {
      cleanup();
    }
  });
});
