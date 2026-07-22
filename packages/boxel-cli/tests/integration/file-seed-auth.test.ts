import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  realmSecretSeed,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// The test realm grants `'*': ['read','write']`, so any token validly signed
// with `realmSecretSeed` may read and write — which is what the seed-auth path
// produces (a locally-minted JWT, no Matrix login). The CLI takes the seed via
// `--realm-secret-seed` reading `BOXEL_REALM_SECRET_SEED` from the env
// (run-boxel strips inherited BOXEL_* vars, so we opt it back in explicitly).
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
    // Empty profile home: no Matrix login exists, so success proves the seed
    // path.
    let { home, cleanup } = createTestHome();
    try {
      let writeRes = await runBoxel(
        [
          'file',
          'write',
          'seed-roundtrip.gts',
          '--realm',
          realmUrl,
          '--realm-secret-seed',
        ],
        {
          home,
          input: 'export const seeded = 42;\n',
          env: { BOXEL_REALM_SECRET_SEED: realmSecretSeed },
        },
      );
      expect(writeRes.ok, writeRes.stderr).toBe(true);

      let readRes = await runBoxel(
        [
          'file',
          'read',
          'seed-roundtrip.gts',
          '--realm',
          realmUrl,
          '--realm-secret-seed',
          '--json',
        ],
        { home, env: { BOXEL_REALM_SECRET_SEED: realmSecretSeed } },
      );
      expect(readRes.ok, readRes.stderr).toBe(true);
      let result = readRes.json<{ ok: boolean; content?: string }>();
      expect(result.ok).toBe(true);
      expect(result.content).toContain('seeded = 42');
    } finally {
      cleanup();
    }
  });

  it('fails cleanly with "No active profile" when neither a seed nor a profile is configured', async () => {
    let { home, cleanup } = createTestHome();
    try {
      let res = await runBoxel(
        ['file', 'read', 'seed-existing.gts', '--realm', realmUrl],
        { home },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      cleanup();
    }
  });
});
