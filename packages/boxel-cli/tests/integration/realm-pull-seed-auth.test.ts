import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pull } from '../../src/commands/realm/pull.ts';
import { SeedAuthenticator } from '../../src/lib/seed-auth.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';

// The test realm server in helpers/integration.ts uses `realmSecretSeed =
// "shhh! it's a secret"` to sign realm JWTs and
// `username = 'node-test_realm-server'` for the realm's matrix client, so the
// bot id the realm short-circuits on is `@node-test_realm-server:localhost`.
//
// In real deployments this would just be `@realm_server:<host>`, but the test
// helper deviates from the convention — we feed the exact expected bot id to
// SeedAuthenticator via the `botUserId` override.
const TEST_REALM_SECRET_SEED = `shhh! it's a secret`;
const TEST_REALM_BOT_USER_ID = '@node-test_realm-server:localhost';

let realmUrl: string;
let localDirs: string[] = [];

function makeLocalDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-pull-seed-int-'));
  localDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  await startTestRealmServer({
    fileSystem: {
      'hello.gts': 'export const hello = "world";\n',
      'nested/card.gts': 'export const nested = true;\n',
    },
  });
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
});

afterAll(async () => {
  for (let dir of localDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await stopTestRealmServer();
});

describe('realm pull with seed-based auth (integration)', () => {
  it('pulls files authenticating via a locally-minted JWT (no Matrix login)', async () => {
    let localDir = makeLocalDir();

    // Empty profile: no Matrix login credentials exist at all. The CLI must
    // authenticate purely from the seed.
    let { profileManager, cleanup } = createTestProfileDir();

    try {
      let authenticator = new SeedAuthenticator({
        seed: TEST_REALM_SECRET_SEED,
        botUserId: TEST_REALM_BOT_USER_ID,
      });

      let result = await pull(realmUrl, localDir, {
        authenticator,
        profileManager,
      });

      expect(result.error).toBeUndefined();
      expect(result.files).toContain('hello.gts');
      expect(result.files).toContain('nested/card.gts');

      let helloPath = path.join(localDir, 'hello.gts');
      expect(fs.existsSync(helloPath)).toBe(true);
      expect(fs.readFileSync(helloPath, 'utf8')).toContain('hello = "world"');
    } finally {
      cleanup();
    }
  });

  it('fails cleanly with the "No active profile" error when neither a seed nor a profile is configured', async () => {
    let localDir = makeLocalDir();
    let { profileManager, cleanup } = createTestProfileDir();
    try {
      let result = await pull(realmUrl, localDir, { profileManager });
      expect(result.files).toEqual([]);
      expect(result.error).toContain('No active profile');
    } finally {
      cleanup();
    }
  });

  it('resolves --realm-secret-seed through the CLI resolver without requiring a profile', async () => {
    // Exercises the flag-driven path end-to-end: the CLI builds a
    // SeedAuthenticator from the seed using the default `realm_server`
    // username, no Matrix login is attempted, and no "No active profile"
    // error surfaces even with an empty profile dir. The test realm permits
    // read access to any authenticated user (`'*': ['read','write']`), so
    // the download succeeds whenever the JWT is signed with the right seed.
    let localDir = makeLocalDir();
    let emptyProfile = createTestProfileDir();
    try {
      let result = await pull(realmUrl, localDir, {
        realmSecretSeed: TEST_REALM_SECRET_SEED,
        profileManager: emptyProfile.profileManager,
      });
      expect(result.error).toBeUndefined();
      expect(result.files).toContain('hello.gts');
    } finally {
      emptyProfile.cleanup();
    }
  });
});
