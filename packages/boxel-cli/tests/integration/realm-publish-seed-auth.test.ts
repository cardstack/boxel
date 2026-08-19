import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  setupTestProfile,
  createTestRealmViaCli,
  uniqueRealmName,
  realmSecretSeed,
  TEST_REALM_SERVER_URL,
  TEST_USERNAME,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// The test realm server signs JWTs with `realmSecretSeed` and grants
// `@<TEST_USERNAME>:localhost` the `realm-owner` permission. The publish
// endpoint authorizes the token's `user` as realm-owner, so a seed-minted
// server token impersonating that owner is what we assert works. Seed mode
// is driven through the CLI via `--realm-secret-seed` + `--as-user`, with
// the seed itself supplied out-of-band in `BOXEL_REALM_SECRET_SEED` (the
// CLI never accepts a seed on argv).
const OWNER_USER_ID = `@${TEST_USERNAME}:localhost`;

// Shape of the `--json` payload the publish command prints on success.
interface PublishResultJson {
  publishedRealmURL: string;
  publishedRealmId: string;
  lastPublishedAt: string;
  status: string;
}

let home: string;
let cleanupProfile: () => void;

beforeAll(async () => {
  await startTestRealmServer();
  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  // Used only to create the source realm (owned by OWNER_USER_ID); publishing
  // below authenticates purely from the seed, in a separate empty home.
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

function uniquePublishedUrl(): string {
  let port = new URL(TEST_REALM_SERVER_URL).port;
  return `http://published-${uniqueRealmName()}.localhost:${port}/`;
}

describe('realm publish with seed-based auth (integration)', () => {
  it('publishes using a seed-minted owner-scoped server token (no Matrix profile)', async () => {
    let { realmUrl: sourceUrl } = await createTestRealmViaCli(home);
    let publishedUrl = uniquePublishedUrl();

    // Empty home: no Matrix login exists, so a successful publish proves the
    // realm server accepted the seed-minted owner-scoped server token.
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-seed-'));
    try {
      let res = await runBoxel(
        [
          'realm',
          'publish',
          sourceUrl,
          publishedUrl,
          '--realm-secret-seed',
          '--as-user',
          OWNER_USER_ID,
          '--force', // skip the publishability gate (noop prerenderer → error docs)
          '--no-wait', // isolate the assertion to the /_publish-realm call
          '--json',
        ],
        { home: emptyHome, env: { BOXEL_REALM_SECRET_SEED: realmSecretSeed } },
      );
      expect(res.ok, res.stderr).toBe(true);
      let result = res.json<PublishResultJson>();

      expect(result.publishedRealmURL).toBe(publishedUrl);
      expect(result.publishedRealmId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(result.lastPublishedAt).toBeTruthy();
    } finally {
      // Clean up via the same seed path (also exercises /_unpublish-realm).
      await runBoxel(
        [
          'realm',
          'unpublish',
          publishedUrl,
          '--realm-secret-seed',
          '--as-user',
          OWNER_USER_ID,
          '--tolerate-missing',
        ],
        { home: emptyHome, env: { BOXEL_REALM_SECRET_SEED: realmSecretSeed } },
      );
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it('rejects a seed publish whose impersonated user lacks realm-owner', async () => {
    let { realmUrl: sourceUrl } = await createTestRealmViaCli(home);
    let publishedUrl = uniquePublishedUrl();
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-seed-'));
    try {
      // A validly-signed seed token, but for a user without realm-owner on the
      // source realm — the server must refuse.
      let res = await runBoxel(
        [
          'realm',
          'publish',
          sourceUrl,
          publishedUrl,
          '--realm-secret-seed',
          '--as-user',
          '@nobody-not-an-owner:localhost',
          '--force',
          '--no-wait',
        ],
        { home: emptyHome, env: { BOXEL_REALM_SECRET_SEED: realmSecretSeed } },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).not.toBe('');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
