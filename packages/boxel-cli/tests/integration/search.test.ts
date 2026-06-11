import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getTestPrerenderer,
  stopTestPrerenderServer,
} from '#realm-server/tests/helpers/index';
import { baseCardRef } from '@cardstack/runtime-common';
import { search } from '../../src/commands/search.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupJwtTestProfile,
} from '../helpers/integration.ts';

const ownerUserId = '@cli-test:localhost';
const testRealmURL = new URL('http://127.0.0.1:4444/test/');

let realmHref: string;
let profileManager: ProfileManager;
let cleanupProfile: () => void;

beforeAll(async () => {
  let { realms } = await startTestRealmServer({
    realms: [
      {
        realmURL: testRealmURL,
        fileSystem: {
          // Card the filter test should match.
          'shared-card.json': JSON.stringify({
            data: {
              type: 'card',
              attributes: { cardInfo: { name: 'Shared Card' } },
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/card-api',
                  name: 'CardDef',
                },
              },
            },
          }),
          // Card that should be excluded by the filter.
          'other-card.json': JSON.stringify({
            data: {
              type: 'card',
              attributes: { cardInfo: { name: 'Other Card' } },
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/card-api',
                  name: 'CardDef',
                },
              },
            },
          }),
        },
        permissions: {
          [ownerUserId]: ['read', 'write', 'realm-owner'],
        },
      },
    ],
    prerenderer: await getTestPrerenderer(),
    registerMatrixUser: false,
  });
  realmHref = realms.find((r) => r.url === testRealmURL.href)!.url;

  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupJwtTestProfile(profileManager, {
    user: ownerUserId,
    realmServerUrl: `${testRealmURL.origin}/`,
  });
}, 600_000);

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
  // The prerender server is memoized per module registry, but vitest gives
  // each test file a fresh registry — stop the OS-level server so the next
  // suite's getTestPrerenderer() doesn't hit EADDRINUSE.
  await stopTestPrerenderServer();
});

describe('federated search (integration)', () => {
  it('returns all results when no filter is supplied', async () => {
    let result = await search(realmHref, {}, { profileManager });
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    let titles = (result.data ?? []).map(
      (entry) =>
        (entry as { attributes?: { cardTitle?: string } }).attributes
          ?.cardTitle,
    );
    expect(titles).toEqual(
      expect.arrayContaining(['Shared Card', 'Other Card']),
    );
  });

  it('filters by cardTitle and returns only the matching card', async () => {
    let result = await search(
      realmHref,
      {
        filter: {
          on: baseCardRef,
          eq: { cardTitle: 'Shared Card' },
        },
      },
      { profileManager },
    );
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    let entries = result.data ?? [];
    expect(entries.length).toBe(1);
    let entry = entries[0] as {
      id?: string;
      attributes?: { cardTitle?: string };
    };
    expect(entry.attributes?.cardTitle).toBe('Shared Card');
    expect(entry.id).toBe(`${realmHref}shared-card`);
  });

  it('returns no results when the filter matches nothing', async () => {
    let result = await search(
      realmHref,
      {
        filter: {
          on: baseCardRef,
          eq: { cardTitle: 'Nonexistent Card' },
        },
      },
      { profileManager },
    );
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    expect(result.data ?? []).toEqual([]);
  });

  it('accepts an array of realm URLs', async () => {
    let result = await search([realmHref], {}, { profileManager });
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('returns ok: false for search on unknown realm URL', async () => {
    let unknownRealm = new URL('nonexistent/', new URL(realmHref)).href;
    let result = await search(unknownRealm, {}, { profileManager });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns error result when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await search(realmHref, {}, { profileManager: emptyManager });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
