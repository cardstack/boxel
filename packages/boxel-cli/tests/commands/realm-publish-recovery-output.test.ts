import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The republish recovery path (unpublish-then-retry on 400/409) emits a
// progress line. Under `--json` the command treats stdout as JSON-only, so
// that progress must land on stderr — never stdout — or it corrupts the
// caller's parse. Reproducing a real 400/409 from the server is timing- and
// state-dependent, so we mock the shared realm operations to throw a 409 on
// the first publish and succeed on the retry, exercising the recovery path
// deterministically and asserting where its progress lands.

let publishCallCount = 0;

vi.mock('@cardstack/runtime-common/realm-operations', async (importActual) => {
  let actual =
    await importActual<
      typeof import('@cardstack/runtime-common/realm-operations')
    >();
  return {
    ...actual,
    fetchPublishabilityReport: vi.fn(async () => ({
      publishable: true,
      violations: [],
    })),
    waitForReady: vi.fn(async () => undefined),
    // publish.ts imports this export as `publishRealmOperation`; the real
    // export name here is `publishRealm`.
    publishRealm: vi.fn(async (_client, input) => {
      publishCallCount += 1;
      if (publishCallCount === 1) {
        throw new actual.RealmOperationError('conflict', {
          status: 409,
          body: 'already published',
        });
      }
      return {
        sourceRealmURL: input.sourceRealmURL,
        publishedRealmURL: input.publishedRealmURL,
        publishedRealmId: 'pub-id',
        lastPublishedAt: '2026-01-01T00:00:00.000Z',
        status: 'pending',
      };
    }),
  };
});

vi.mock('../../src/commands/realm/unpublish.ts', () => ({
  unpublishRealm: vi.fn(async (publishedRealmURL: string) => ({
    publishedRealmURL,
    unpublished: true,
  })),
}));

import { publishRealm } from '../../src/commands/realm/publish.ts';
import type { ProfileManager } from '../../src/lib/profile-manager.ts';

// Minimal ProfileManager — buildCliRealmClient only reads the active profile's
// realmServerUrl; every network call is routed through the mocked operations.
const fakeProfileManager = {
  getActiveProfile: () => ({
    name: 'test',
    profile: { realmServerUrl: 'http://localhost:4201/' },
  }),
} as unknown as ProfileManager;

describe('publishRealm republish-recovery output routing', () => {
  beforeEach(() => {
    publishCallCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes the 409 recovery progress to stderr, keeping stdout clean', async () => {
    let stdout: string[] = [];
    let stderr: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    let result = await publishRealm(
      'http://localhost:4201/source/',
      'http://published.localhost:4201/',
      { profileManager: fakeProfileManager, waitForReady: false },
    );

    // The retry after unpublish succeeds.
    expect(result.publishedRealmURL).toBe('http://published.localhost:4201/');

    // The progress line is emitted (recovery path was taken) — on stderr only.
    expect(stderr.join('')).toContain('Unpublishing and retrying');
    expect(stdout.join('')).not.toContain('Unpublishing and retrying');
  });
});
