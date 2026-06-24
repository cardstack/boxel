import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRealm } from '../../src/commands/realm/create.ts';
import { publishRealm } from '../../src/commands/realm/publish.ts';
import { unpublishRealm } from '../../src/commands/realm/unpublish.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
  TEST_REALM_SERVER_URL,
  TEST_USERNAME,
} from '../helpers/integration.ts';
import type { ProfileManager } from '../../src/lib/profile-manager.ts';

// The test realm server signs JWTs with this seed (see helpers/integration.ts),
// and grants `@<TEST_USERNAME>:localhost` the `realm-owner` permission. The
// publish endpoint authorizes the token's `user` as realm-owner, so a
// seed-minted server token impersonating that owner is what we assert works.
const TEST_REALM_SECRET_SEED = `shhh! it's a secret`;
const OWNER_USER_ID = `@${TEST_USERNAME}:localhost`;

let profileManager: ProfileManager;
let cleanup: () => void;

beforeAll(async () => {
  await startTestRealmServer();
  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanup = testProfile.cleanup;
  // Used only to create the source realm (owned by OWNER_USER_ID); publishing
  // below authenticates purely from the seed.
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  cleanup?.();
  await stopTestRealmServer();
});

function uniquePublishedUrl(): string {
  let port = new URL(TEST_REALM_SERVER_URL).port;
  return `http://published-${uniqueRealmName()}.localhost:${port}/`;
}

describe('realm publish with seed-based auth (integration)', () => {
  it('publishes using a seed-minted owner-scoped server token (no Matrix profile)', async () => {
    let { realmUrl: sourceUrl } = await createRealm(
      uniqueRealmName(),
      'Seed publish source',
      { profileManager },
    );
    let publishedUrl = uniquePublishedUrl();

    // Empty profile: no Matrix login exists, so a successful publish proves the
    // realm server accepted the seed-minted owner-scoped server token.
    let emptyProfile = createTestProfileDir();
    try {
      let result = await publishRealm(sourceUrl, publishedUrl, {
        realmSecretSeed: TEST_REALM_SECRET_SEED,
        asUser: OWNER_USER_ID,
        profileManager: emptyProfile.profileManager,
        force: true, // skip the publishability gate (noop prerenderer → error docs)
        waitForReady: false, // isolate the assertion to the /_publish-realm call
      });

      expect(result.publishedRealmURL).toBe(publishedUrl);
      expect(result.publishedRealmId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(result.lastPublishedAt).toBeTruthy();
    } finally {
      // Clean up via the same seed path (also exercises /_unpublish-realm).
      await unpublishRealm(publishedUrl, {
        realmSecretSeed: TEST_REALM_SECRET_SEED,
        asUser: OWNER_USER_ID,
        tolerateMissing: true,
      });
      emptyProfile.cleanup();
    }
  });

  it('rejects a seed publish whose impersonated user lacks realm-owner', async () => {
    let { realmUrl: sourceUrl } = await createRealm(
      uniqueRealmName(),
      'Seed publish non-owner',
      { profileManager },
    );
    let publishedUrl = uniquePublishedUrl();
    let emptyProfile = createTestProfileDir();
    try {
      // A validly-signed seed token, but for a user without realm-owner on the
      // source realm — the server must refuse.
      await expect(
        publishRealm(sourceUrl, publishedUrl, {
          realmSecretSeed: TEST_REALM_SECRET_SEED,
          asUser: '@nobody-not-an-owner:localhost',
          profileManager: emptyProfile.profileManager,
          force: true,
          waitForReady: false,
        }),
      ).rejects.toThrow();
    } finally {
      emptyProfile.cleanup();
    }
  });
});
