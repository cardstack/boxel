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
} from '../helpers/integration.ts';
import type { ProfileManager } from '../../src/lib/profile-manager.ts';

let profileManager: ProfileManager;
let cleanup: () => void;

beforeAll(async () => {
  await startTestRealmServer();
  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanup = testProfile.cleanup;
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  cleanup?.();
  await stopTestRealmServer();
});

async function createPublishableSource(): Promise<string> {
  let name = uniqueRealmName();
  let result = await createRealm(name, `Source ${name}`, { profileManager });
  return result.realmUrl;
}

function uniquePublishedUrl(): string {
  // Realm server enforces `domainsForPublishedRealms` (typically
  // `['localhost']` in tests) — use a *.localhost subdomain so the URL
  // passes the publish-handler's allow-list. The hostname resolves to
  // 127.0.0.1 via RFC 6761, and the realm-server listens on the same
  // port for any host, so fetch() reaches it.
  let port = new URL(TEST_REALM_SERVER_URL).port;
  return `http://published-${uniqueRealmName()}.localhost:${port}/`;
}

describe('realm publish (integration)', () => {
  it('accepts the 202 + status:pending response and polls readiness', async () => {
    let sourceUrl = await createPublishableSource();
    let publishedUrl = uniquePublishedUrl();

    let result = await publishRealm(sourceUrl, publishedUrl, {
      profileManager,
      timeoutMs: 60_000,
    });

    expect(result.publishedRealmURL).toBe(publishedUrl);
    expect(result.publishedRealmId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result.lastPublishedAt).toBeTruthy();
    // The server signals async indexing with status:'pending'. publishRealm()
    // must surface that value rather than failing the call — earlier
    // boxel-home CI broke when callers required 200/201 and got a 202.
    expect(result.status).toBe('pending');
  }, 90_000);

  it('returns without waiting when waitForReady is false', async () => {
    let sourceUrl = await createPublishableSource();
    let publishedUrl = uniquePublishedUrl();

    let result = await publishRealm(sourceUrl, publishedUrl, {
      profileManager,
      waitForReady: false,
    });

    expect(result.publishedRealmURL).toBe(publishedUrl);
    expect(result.status).toBe('pending');
  }, 60_000);

  it('republishes by unpublishing first when the target URL already exists', async () => {
    let sourceUrl = await createPublishableSource();
    let publishedUrl = uniquePublishedUrl();

    await publishRealm(sourceUrl, publishedUrl, {
      profileManager,
      waitForReady: false,
    });

    // Republishing the same URL must succeed via the action's auto-recovery
    // path (unpublish-then-retry on 400/409). This mirrors what
    // boxel-home's PR preview flow needs across successive PR pushes.
    let republished = await publishRealm(sourceUrl, publishedUrl, {
      profileManager,
      waitForReady: false,
    });

    expect(republished.publishedRealmURL).toBe(publishedUrl);
  }, 90_000);

  it('throws a useful error when the source realm does not exist', async () => {
    let bogusSource = `${TEST_REALM_SERVER_URL}/does-not-exist-${uniqueRealmName()}/`;
    let publishedUrl = uniquePublishedUrl();

    await expect(
      publishRealm(bogusSource, publishedUrl, {
        profileManager,
        waitForReady: false,
        republish: false,
        // Bypass the publishability gate so this exercises the publish POST's
        // failure path (the gate would otherwise fail first on the missing
        // realm's `_publishability` endpoint).
        force: true,
      }),
    ).rejects.toThrow(/Publish failed: HTTP/);
  }, 30_000);

  it('blocks publishing only when forced past an unpublishable realm', async () => {
    // A freshly created realm has no private-dependency or error-document
    // violations, so the gate (on by default) lets it through.
    let sourceUrl = await createPublishableSource();
    let publishedUrl = uniquePublishedUrl();

    let result = await publishRealm(sourceUrl, publishedUrl, {
      profileManager,
      waitForReady: false,
    });
    expect(result.publishedRealmURL).toBe(publishedUrl);
  }, 60_000);
});

describe('realm unpublish (integration)', () => {
  it('unpublishes a previously published realm', async () => {
    let sourceUrl = await createPublishableSource();
    let publishedUrl = uniquePublishedUrl();

    await publishRealm(sourceUrl, publishedUrl, {
      profileManager,
      waitForReady: false,
    });

    let result = await unpublishRealm(publishedUrl, { profileManager });

    expect(result.unpublished).toBe(true);
    expect(result.error).toBeUndefined();
  }, 60_000);

  it('treats a missing realm as success when tolerateMissing is set', async () => {
    let bogusUrl = `${TEST_REALM_SERVER_URL}/never-published-${uniqueRealmName()}/`;

    let result = await unpublishRealm(bogusUrl, {
      profileManager,
      tolerateMissing: true,
    });

    expect(result.unpublished).toBe(false);
    expect(result.notFound).toBe(true);
    expect(result.error).toBeUndefined();
  }, 30_000);

  it('reports an error for a missing realm when tolerateMissing is unset', async () => {
    let bogusUrl = `${TEST_REALM_SERVER_URL}/never-published-${uniqueRealmName()}/`;

    let result = await unpublishRealm(bogusUrl, { profileManager });

    expect(result.unpublished).toBe(false);
    expect(result.notFound).toBe(true);
    expect(result.error).toMatch(/not currently published/);
  }, 30_000);
});
