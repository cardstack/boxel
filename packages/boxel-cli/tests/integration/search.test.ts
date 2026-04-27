import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { search } from '../../src/commands/search';
import { ProfileManager } from '../../src/lib/profile-manager';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration';

let profileManager: ProfileManager;
let cleanupProfile: () => void;
let realmUrl: string;

beforeAll(async () => {
  await startTestRealmServer({
    useRealPrerenderer: true,
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
  });
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('federated search (integration)', () => {
  it('returns results from the realm', async () => {
    let result = await search(realmUrl, {}, { profileManager });
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('finds the seeded SearchTarget card by title', async () => {
    let result = await search(realmUrl, {}, { profileManager });
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    let titles = (result.data ?? []).map(
      (entry) =>
        (entry as { attributes?: { cardTitle?: string } }).attributes
          ?.cardTitle,
    );
    expect(titles).toContain('Searchable Card');
  });

  it('accepts an array of realm URLs', async () => {
    let result = await search([realmUrl], {}, { profileManager });
    expect(result.ok, `search failed: ${result.error}`).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('returns ok: false for search on unknown realm URL', async () => {
    let result = await search(
      `${TEST_REALM_SERVER_URL}/nonexistent/`,
      {},
      { profileManager },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns error result when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await search(realmUrl, {}, { profileManager: emptyManager });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
