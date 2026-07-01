import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listRealms } from '../../src/commands/realm/list.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';

let profileManager: ProfileManager;
let cleanupProfile: () => void;

const visibleUrl = `${TEST_REALM_SERVER_URL}/visible/`;
const hiddenUrl = `${TEST_REALM_SERVER_URL}/hidden/`;
const pendingUrl = `${TEST_REALM_SERVER_URL}/pending/`;

beforeAll(async () => {
  await startTestRealmServer({
    realms: [
      {
        realmURL: new URL(visibleUrl),
        permissions: { '*': ['read', 'write'] },
      },
      {
        realmURL: new URL(hiddenUrl),
        permissions: { '*': ['read', 'write'] },
      },
      {
        realmURL: new URL(pendingUrl),
        permissions: { '*': ['read', 'write'] },
      },
    ],
  });
  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);

  // Seed only `visibleUrl` into the user's app.boxel.realms account data so
  // the suite starts with a mixed visible/hidden state.
  await profileManager.addToUserRealms(visibleUrl);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm list (integration)', () => {
  it('--all-accessible returns every realm with the correct hidden flag', async () => {
    let result = await listRealms({
      allAccessible: true,
      profileManager,
    });
    expect(result.error).toBeUndefined();
    expect(result.realms).toHaveLength(3);
    let byUrl = new Map(result.realms.map((r) => [r.url, r]));
    expect(byUrl.get(visibleUrl)).toEqual({
      url: visibleUrl,
      hidden: false,
      archived: false,
    });
    expect(byUrl.get(hiddenUrl)).toEqual({
      url: hiddenUrl,
      hidden: true,
      archived: false,
    });
    expect(byUrl.get(pendingUrl)).toEqual({
      url: pendingUrl,
      hidden: true,
      archived: false,
    });
  });

  it('returns an error when --all-accessible and --hidden are both set', async () => {
    let result = await listRealms({
      allAccessible: true,
      hidden: true,
      profileManager,
    });
    expect(result.realms).toEqual([]);
    expect(result.error).toContain('mutually exclusive');
  });

  it('default mode lists only the realm in account data', async () => {
    let result = await listRealms({ profileManager });
    expect(result.error).toBeUndefined();
    expect(result.realms).toEqual([
      { url: visibleUrl, hidden: false, archived: false },
    ]);
  });

  it('--hidden lists only realms missing from account data', async () => {
    let result = await listRealms({ hidden: true, profileManager });
    expect(result.error).toBeUndefined();
    let urls = result.realms.map((r) => r.url).sort();
    expect(urls).toEqual([hiddenUrl, pendingUrl].sort());
    expect(result.realms.every((r) => r.hidden)).toBe(true);
    expect(urls).not.toContain(visibleUrl);
  });

  it('addToUserRealms moves a realm from hidden to visible', async () => {
    await profileManager.addToUserRealms(pendingUrl);

    let visible = await listRealms({ profileManager });
    expect(visible.error).toBeUndefined();
    let visibleUrls = visible.realms.map((r) => r.url).sort();
    expect(visibleUrls).toEqual([visibleUrl, pendingUrl].sort());
    expect(visible.realms.every((r) => !r.hidden)).toBe(true);

    let hidden = await listRealms({ hidden: true, profileManager });
    expect(hidden.error).toBeUndefined();
    expect(hidden.realms).toEqual([
      { url: hiddenUrl, hidden: true, archived: false },
    ]);
  });

  it('returns an error when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await listRealms({ profileManager: emptyManager });
    expect(result.realms).toEqual([]);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
