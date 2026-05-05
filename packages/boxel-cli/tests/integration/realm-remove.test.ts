import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listRealms } from '../../src/commands/realm/list';
import { removeRealm } from '../../src/commands/realm/remove';
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

const realmAUrl = `${TEST_REALM_SERVER_URL}/realm-a/`;
const realmBUrl = `${TEST_REALM_SERVER_URL}/realm-b/`;

beforeAll(async () => {
  await startTestRealmServer({
    realms: [
      {
        realmURL: new URL(realmAUrl),
        permissions: { '*': ['read', 'write'] },
      },
      {
        realmURL: new URL(realmBUrl),
        permissions: { '*': ['read', 'write'] },
      },
    ],
  });
  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);

  await profileManager.addToUserRealms(realmAUrl);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm remove (integration)', () => {
  it('removes a realm that is in the user list', async () => {
    let result = await removeRealm({
      realmUrl: realmAUrl,
      profileManager,
    });
    expect(result.error).toBeUndefined();
    expect(result.removed).toBe(true);
    expect(result.realmUrl).toBe(realmAUrl);
    expect(result.previousCount).toBeGreaterThanOrEqual(1);
    expect(result.nextCount).toBe(result.previousCount - 1);

    let userRealms = await profileManager.getUserRealms();
    expect(userRealms).not.toContain(realmAUrl);
  });

  it('reports notInList when the URL is not in the user list', async () => {
    let result = await removeRealm({
      realmUrl: realmBUrl,
      profileManager,
    });
    expect(result.removed).toBe(false);
    expect(result.notInList).toBe(true);
    expect(result.error).toContain('Nothing to remove');
    expect(result.previousCount).toBe(result.nextCount);
  });

  it('dry-run computes nextCount but does not write', async () => {
    await profileManager.addToUserRealms(realmAUrl);
    let before = await profileManager.getUserRealms();

    let result = await removeRealm({
      realmUrl: realmAUrl,
      dryRun: true,
      profileManager,
    });
    expect(result.error).toBeUndefined();
    expect(result.removed).toBe(false);
    expect(result.previousCount).toBe(before.length);
    expect(result.nextCount).toBe(before.length - 1);

    let after = await profileManager.getUserRealms();
    expect(after.sort()).toEqual(before.sort());
    expect(after).toContain(realmAUrl);
  });

  it('normalizes trailing-slash on input', async () => {
    let userRealms = await profileManager.getUserRealms();
    expect(userRealms).toContain(realmAUrl);

    let withoutSlash = realmAUrl.replace(/\/$/, '');
    let result = await removeRealm({
      realmUrl: withoutSlash,
      profileManager,
    });
    expect(result.error).toBeUndefined();
    expect(result.removed).toBe(true);
    expect(result.realmUrl).toBe(realmAUrl);

    let after = await profileManager.getUserRealms();
    expect(after).not.toContain(realmAUrl);
  });

  it('does not delete realm files from the server (soft remove)', async () => {
    // Realm A is still missing from the user list at this point. The realm
    // server should still know about it — re-adding restores visibility, and
    // listRealms({ allAccessible }) finds it via the server's _realm-auth.
    let accessible = await listRealms({
      allAccessible: true,
      profileManager,
    });
    expect(accessible.error).toBeUndefined();
    expect(accessible.realms.map((r) => r.url)).toContain(realmAUrl);

    await profileManager.addToUserRealms(realmAUrl);
    let visible = await listRealms({ profileManager });
    expect(visible.error).toBeUndefined();
    expect(visible.realms.map((r) => r.url)).toContain(realmAUrl);
  });

  it('returns an error when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await removeRealm({
      realmUrl: realmAUrl,
      profileManager: emptyManager,
    });
    expect(result.removed).toBe(false);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
