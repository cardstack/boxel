import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getTestPrerenderer } from '#realm-server/tests/helpers/index';
import { search } from '../../src/commands/search';
import { ProfileManager } from '../../src/lib/profile-manager';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupJwtTestProfile,
} from '../helpers/integration';

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
          'SearchTarget/1.json': JSON.stringify({
            data: {
              type: 'card',
              attributes: { cardInfo: { name: 'Searchable Card' } },
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
});

describe('federated search (integration)', () => {
  it('returns results from the realm', async () => {
    let result = await search(realmHref, {}, { profileManager });
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('finds the seeded SearchTarget card by title', async () => {
    let result = await search(realmHref, {}, { profileManager });
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    let titles = (result.data ?? []).map(
      (entry) =>
        (entry as { attributes?: { cardTitle?: string } }).attributes
          ?.cardTitle,
    );
    expect(titles).toContain('Searchable Card');
  });

  it('accepts an array of realm URLs', async () => {
    let result = await search([realmHref], {}, { profileManager });
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    expect(result.data).toBeDefined();
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
