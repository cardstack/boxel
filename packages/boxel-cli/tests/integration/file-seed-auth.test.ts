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

function cardWithTitle(title: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title },
      meta: {
        adoptsFrom: { module: '@cardstack/base/card-api', name: 'CardDef' },
      },
    },
  });
}

// `file read --json` reports a textual file as `content` and any other as
// base64 `bytesBase64`; an extensionless file is served as an octet-stream.
function servedText(res: Awaited<ReturnType<typeof runBoxel>>): string {
  let { content, bytesBase64 } = res.json<{
    content?: string;
    bytesBase64?: string;
  }>();
  return (
    content ??
    (bytesBase64 ? Buffer.from(bytesBase64, 'base64').toString('utf8') : '')
  );
}

const seedEnv = () => ({
  BOXEL_REALM_SECRET_SEED: realmSecretSeed,
  MATRIX_SERVER_NAME: 'localhost',
});

beforeAll(async () => {
  await startTestRealmServer({
    fileSystem: {
      'seed-existing.gts': 'export const existing = true;\n',
      // A card, and a stray copy of its JSON at the card's own id with no
      // extension: two files whose paths differ only by the `.json`.
      'stray-copy.json': cardWithTitle('The card'),
      'stray-copy': cardWithTitle('A stray copy'),
    },
  });
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
});

afterAll(async () => {
  await stopTestRealmServer();
});

describe('file read/write/delete with seed-based auth (integration)', () => {
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
          env: {
            BOXEL_REALM_SECRET_SEED: realmSecretSeed,
            MATRIX_SERVER_NAME: 'localhost',
          },
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
        {
          home,
          env: {
            BOXEL_REALM_SECRET_SEED: realmSecretSeed,
            MATRIX_SERVER_NAME: 'localhost',
          },
        },
      );
      expect(readRes.ok, readRes.stderr).toBe(true);
      let result = readRes.json<{ ok: boolean; content?: string }>();
      expect(result.ok).toBe(true);
      expect(result.content).toContain('seeded = 42');
    } finally {
      cleanup();
    }
  });

  it('deletes the file at exactly the given path authenticating via the seed (no Matrix profile)', async () => {
    let { home, cleanup } = createTestHome();
    try {
      let readSource = (path: string) =>
        runBoxel(
          [
            'file',
            'read',
            path,
            '--realm',
            realmUrl,
            '--realm-secret-seed',
            '--json',
          ],
          { home, env: seedEnv() },
        );

      let before = await readSource('stray-copy');
      expect(before.ok, before.stderr).toBe(true);
      expect(servedText(before)).toContain('A stray copy');

      let deleteRes = await runBoxel(
        [
          'file',
          'delete',
          'stray-copy',
          '--realm',
          realmUrl,
          '--realm-secret-seed',
        ],
        { home, env: seedEnv() },
      );
      expect(deleteRes.ok, deleteRes.stderr).toBe(true);

      // With the extensionless file gone, its path resolves to the card's
      // `.json`, which is untouched.
      let after = await readSource('stray-copy');
      expect(after.ok, after.stderr).toBe(true);
      expect(servedText(after)).toContain('The card');
      expect(servedText(after)).not.toContain('A stray copy');
      let card = await readSource('stray-copy.json');
      expect(card.ok, card.stderr).toBe(true);
      expect(servedText(card)).toContain('The card');
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
