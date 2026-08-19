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
                  module: '@cardstack/base/card-api',
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
                  module: '@cardstack/base/card-api',
                  name: 'CardDef',
                },
              },
            },
          }),
          // A plain (non-card) file: it has only a `file` row, so it must still
          // appear in a mixed list-all after the card `.json` file rows are
          // deduped away.
          'readme.txt': 'plain file contents',
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
  it('returns each card once (no `.json` file-row dupe) plus plain files', async () => {
    let result = await search(realmHref, {}, { profileManager });
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    let entries = (result.data ?? []) as {
      id?: string;
      type?: string;
      attributes?: { cardTitle?: string };
    }[];

    // Each card `.json` is dual-indexed (an instance row + a file row); the
    // dedup drops the file row so the card appears exactly once.
    let cardTitles = entries
      .filter((e) => e.type === 'card')
      .map((e) => e.attributes?.cardTitle)
      .sort();
    expect(cardTitles).toEqual(['Other Card', 'Shared Card']);

    // No id appears twice.
    let ids = entries.map((e) => e.id);
    expect(ids.length).toBe(new Set(ids).size);

    // The plain (non-card) file is still listed.
    let fileIds = entries
      .filter((e) => e.type === 'file-meta')
      .map((e) => e.id);
    expect(fileIds).toContain(`${realmHref}readme.txt`);
    // ...and neither card's `.json` file row leaked in.
    expect(fileIds).not.toContain(`${realmHref}shared-card.json`);
    expect(fileIds).not.toContain(`${realmHref}other-card.json`);
  });

  it('returns a single entry for a cardUrls `.json` lookup', async () => {
    let result = await search(
      realmHref,
      { cardUrls: [`${realmHref}shared-card.json`] },
      { profileManager },
    );
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    let entries = result.data ?? [];
    expect(entries.length).toBe(1);
    expect((entries[0] as { id?: string }).id).toBe(`${realmHref}shared-card`);
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

  it('accepts a non-URL @cardstack/ realm identifier in the realm list', async () => {
    // `@cardstack/<realm>/` resolves against the profile's realm-server
    // URL, so `@cardstack/test/` names the same realm as realmHref.
    let result = await search(['@cardstack/test/'], {}, { profileManager });
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
