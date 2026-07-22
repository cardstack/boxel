import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  setupTestProfile,
  createTestRealmViaCli,
  uniqueRealmName,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// Drives `boxel realm publish` / `boxel realm unpublish` as subprocesses.
// The action goes through the installed CLI (argv + profile on disk); we
// read the `--json` result off stdout, and error cases off stderr + a
// non-zero exit code.

// Shape of the `--json` payload the publish command prints on success.
interface PublishResultJson {
  publishedRealmURL: string;
  publishedRealmId: string;
  lastPublishedAt: string;
  status: string;
}

// Shape of the `--json` payload the unpublish command prints.
interface UnpublishResultJson {
  publishedRealmURL: string;
  unpublished: boolean;
  notFound?: boolean;
  error?: string;
}

let home: string;
let cleanupProfile: () => void;

beforeAll(async () => {
  await startTestRealmServer();
  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

// Creates a fresh source realm to publish from. This harness uses a noop
// prerenderer (see `integration.ts`), so every indexed instance becomes an
// error document and the realm is never publishable — tests exercising the
// publish/unpublish flow itself pass `--force` to bypass the publishability
// gate, which is covered directly by the gate test below.
async function createSourceRealm(): Promise<string> {
  let { realmUrl } = await createTestRealmViaCli(home);
  return realmUrl;
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
    let sourceUrl = await createSourceRealm();
    let publishedUrl = uniquePublishedUrl();

    let res = await runBoxel(
      [
        'realm',
        'publish',
        sourceUrl,
        publishedUrl,
        '--force',
        '--timeout',
        '60000',
        '--json',
      ],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
    let result = res.json<PublishResultJson>();

    expect(result.publishedRealmURL).toBe(publishedUrl);
    expect(result.publishedRealmId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result.lastPublishedAt).toBeTruthy();
    // The server signals async indexing with status:'pending'. publish
    // must surface that value rather than failing the call — earlier
    // boxel-home CI broke when callers required 200/201 and got a 202.
    expect(result.status).toBe('pending');
  }, 90_000);

  it('returns without waiting when waitForReady is false', async () => {
    let sourceUrl = await createSourceRealm();
    let publishedUrl = uniquePublishedUrl();

    let res = await runBoxel(
      [
        'realm',
        'publish',
        sourceUrl,
        publishedUrl,
        '--force',
        '--no-wait',
        '--json',
      ],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
    let result = res.json<PublishResultJson>();

    expect(result.publishedRealmURL).toBe(publishedUrl);
    expect(result.status).toBe('pending');
  }, 60_000);

  it('republishes by unpublishing first when the target URL already exists', async () => {
    let sourceUrl = await createSourceRealm();
    let publishedUrl = uniquePublishedUrl();

    let first = await runBoxel(
      ['realm', 'publish', sourceUrl, publishedUrl, '--force', '--no-wait'],
      { home },
    );
    expect(first.ok, first.stderr).toBe(true);

    // Republishing the same URL must succeed via the command's auto-recovery
    // path (unpublish-then-retry on 400/409). This mirrors what
    // boxel-home's PR preview flow needs across successive PR pushes.
    let res = await runBoxel(
      [
        'realm',
        'publish',
        sourceUrl,
        publishedUrl,
        '--force',
        '--no-wait',
        '--json',
      ],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
    let republished = res.json<PublishResultJson>();

    expect(republished.publishedRealmURL).toBe(publishedUrl);
  }, 90_000);

  it('throws a useful error when the source realm does not exist', async () => {
    let bogusSource = `${TEST_REALM_SERVER_URL}/does-not-exist-${uniqueRealmName()}/`;
    let publishedUrl = uniquePublishedUrl();

    // Bypass the publishability gate with --force so this exercises the
    // publish POST's failure path (the gate would otherwise fail first on
    // the missing realm's `_publishability` endpoint).
    let res = await runBoxel(
      [
        'realm',
        'publish',
        bogusSource,
        publishedUrl,
        '--no-wait',
        '--no-republish',
        '--force',
      ],
      { home },
    );
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('Publish failed: HTTP');
  }, 30_000);

  it('blocks publishing an unpublishable realm unless forced', async () => {
    // The noop prerenderer makes every indexed instance an error document, so
    // a freshly created realm trips the publishability gate. The gate (on by
    // default) refuses to publish; --force bypasses it.
    let sourceUrl = await createSourceRealm();
    let publishedUrl = uniquePublishedUrl();

    let blocked = await runBoxel(
      ['realm', 'publish', sourceUrl, publishedUrl, '--no-wait'],
      { home },
    );
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain('not publishable');

    let res = await runBoxel(
      [
        'realm',
        'publish',
        sourceUrl,
        publishedUrl,
        '--no-wait',
        '--force',
        '--json',
      ],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
    let result = res.json<PublishResultJson>();
    expect(result.publishedRealmURL).toBe(publishedUrl);
  }, 90_000);
});

describe('realm unpublish (integration)', () => {
  it('unpublishes a previously published realm', async () => {
    let sourceUrl = await createSourceRealm();
    let publishedUrl = uniquePublishedUrl();

    let published = await runBoxel(
      ['realm', 'publish', sourceUrl, publishedUrl, '--force', '--no-wait'],
      { home },
    );
    expect(published.ok, published.stderr).toBe(true);

    let res = await runBoxel(['realm', 'unpublish', publishedUrl, '--json'], {
      home,
    });
    expect(res.ok, res.stderr).toBe(true);
    let result = res.json<UnpublishResultJson>();

    expect(result.unpublished).toBe(true);
    expect(result.error).toBeUndefined();
  }, 60_000);

  it('treats a missing realm as success when tolerateMissing is set', async () => {
    let bogusUrl = `${TEST_REALM_SERVER_URL}/never-published-${uniqueRealmName()}/`;

    let res = await runBoxel(
      ['realm', 'unpublish', bogusUrl, '--tolerate-missing', '--json'],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
    let result = res.json<UnpublishResultJson>();

    expect(result.unpublished).toBe(false);
    expect(result.notFound).toBe(true);
    expect(result.error).toBeUndefined();
  }, 30_000);

  it('reports an error for a missing realm when tolerateMissing is unset', async () => {
    let bogusUrl = `${TEST_REALM_SERVER_URL}/never-published-${uniqueRealmName()}/`;

    let res = await runBoxel(['realm', 'unpublish', bogusUrl, '--json'], {
      home,
    });
    // In --json mode the command prints the result payload to stdout and
    // still exits non-zero when it carries an error.
    expect(res.exitCode).toBe(1);
    let result = res.json<UnpublishResultJson>();

    expect(result.unpublished).toBe(false);
    expect(result.notFound).toBe(true);
    expect(result.error).toMatch(/not currently published/);
  }, 30_000);
});
