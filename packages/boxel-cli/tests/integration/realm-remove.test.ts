import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRealm } from '../../src/commands/realm/create';
import { removeRealm } from '../../src/commands/realm/remove';
import { ProfileManager } from '../../src/lib/profile-manager';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
  registerUser,
  matrixURL,
  matrixRegistrationSecret,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration';

let profileManager: ProfileManager;
let cleanupProfile: () => void;

beforeAll(async () => {
  await startTestRealmServer();
  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm remove (integration)', () => {
  it('hard-deletes the realm on the server and unlinks from Matrix', async () => {
    let name = uniqueRealmName();
    let { realmUrl } = await createRealm(name, `Test ${name}`, {
      profileManager,
    });

    let result = await removeRealm({ realmUrl, profileManager });

    expect(result.error).toBeUndefined();
    expect(result.removed).toBe(true);
    expect(result.serverDeleted).toBe(true);
    expect(result.unlinked).toBe(true);
    expect(result.realmUrl).toBe(realmUrl);
    expect(result.nextCount).toBe(result.previousCount - 1);

    let userRealms = await profileManager.getUserRealms();
    expect(userRealms).not.toContain(realmUrl);
  });

  it('frees the realm name so it can be recreated', async () => {
    let name = uniqueRealmName();
    let first = await createRealm(name, `Test ${name}`, { profileManager });
    let removed = await removeRealm({
      realmUrl: first.realmUrl,
      profileManager,
    });
    expect(removed.removed).toBe(true);

    let second = await createRealm(name, `Test ${name}`, { profileManager });
    expect(second.created).toBe(true);
    expect(second.realmUrl).toBe(first.realmUrl);

    await removeRealm({ realmUrl: second.realmUrl, profileManager });
  });

  it('reports notInList when the URL is not in the user list', async () => {
    let result = await removeRealm({
      realmUrl: `${TEST_REALM_SERVER_URL}/never-added-${Date.now()}/`,
      profileManager,
    });
    expect(result.removed).toBe(false);
    expect(result.serverDeleted).toBe(false);
    expect(result.unlinked).toBe(false);
    expect(result.notInList).toBe(true);
    expect(result.error).toContain('Nothing to remove');
    expect(result.previousCount).toBe(result.nextCount);
  });

  it('dry-run does not hit the server or modify Matrix', async () => {
    let name = uniqueRealmName();
    let { realmUrl } = await createRealm(name, `Test ${name}`, {
      profileManager,
    });
    let before = await profileManager.getUserRealms();

    let result = await removeRealm({
      realmUrl,
      dryRun: true,
      profileManager,
    });

    expect(result.error).toBeUndefined();
    expect(result.removed).toBe(false);
    expect(result.serverDeleted).toBe(false);
    expect(result.unlinked).toBe(false);
    expect(result.previousCount).toBe(before.length);
    expect(result.nextCount).toBe(before.length - 1);

    let after = await profileManager.getUserRealms();
    expect(after).toContain(realmUrl);

    let stillThere = await removeRealm({ realmUrl, profileManager });
    expect(stillThere.serverDeleted).toBe(true);
  });

  it('normalizes trailing-slash on input', async () => {
    let name = uniqueRealmName();
    let { realmUrl } = await createRealm(name, `Test ${name}`, {
      profileManager,
    });

    let withoutSlash = realmUrl.replace(/\/$/, '');
    let result = await removeRealm({
      realmUrl: withoutSlash,
      profileManager,
    });
    expect(result.error).toBeUndefined();
    expect(result.removed).toBe(true);
    expect(result.realmUrl).toBe(realmUrl);

    let after = await profileManager.getUserRealms();
    expect(after).not.toContain(realmUrl);
  });

  it('removes legacy duplicate entries (with and without trailing slash)', async () => {
    let name = uniqueRealmName();
    let { realmUrl } = await createRealm(name, `Test ${name}`, {
      profileManager,
    });
    let withoutSlash = realmUrl.replace(/\/$/, '');

    // createRealm adds the trailing-slash form. Inject the trailing-slash-less
    // form directly so the list looks like a legacy account_data with both
    // shapes for the same realm.
    await profileManager.addToUserRealms(withoutSlash);
    let beforeRemove = await profileManager.getUserRealms();
    expect(beforeRemove).toContain(realmUrl);
    expect(beforeRemove).toContain(withoutSlash);

    let result = await removeRealm({ realmUrl, profileManager });
    expect(result.error).toBeUndefined();
    expect(result.removed).toBe(true);
    expect(result.serverDeleted).toBe(true);
    expect(result.unlinked).toBe(true);
    expect(result.previousCount - result.nextCount).toBe(2);

    let after = await profileManager.getUserRealms();
    expect(after).not.toContain(realmUrl);
    expect(after).not.toContain(withoutSlash);
  });

  it('fails with a 403 error when the caller does not own the realm', async () => {
    let realmName = uniqueRealmName();
    let { realmUrl } = await createRealm(realmName, `Test ${realmName}`, {
      profileManager,
    });

    let userBSuffix = `userb-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    let userBUsername = `cli-test-${userBSuffix}`;
    let userBPassword = 'test-password-userb';
    await registerUser({
      matrixURL,
      displayname: 'CLI Test User B',
      username: userBUsername,
      password: userBPassword,
      registrationSecret: matrixRegistrationSecret,
    });

    let userBProfile = createTestProfileDir();
    try {
      await userBProfile.profileManager.addProfile(
        `@${userBUsername}:localhost`,
        userBPassword,
        'CLI Test User B',
        matrixURL.href,
        `${TEST_REALM_SERVER_URL}/`,
      );
      await userBProfile.profileManager.addToUserRealms(realmUrl);

      let result = await removeRealm({
        realmUrl,
        profileManager: userBProfile.profileManager,
      });

      expect(result.removed).toBe(false);
      expect(result.serverDeleted).toBe(false);
      expect(result.unlinked).toBe(false);
      expect(result.error).toMatch(/403/);
      expect(result.error).toMatch(/do not own this realm/);

      let listAfter = await profileManager.getUserRealms();
      expect(listAfter).toContain(realmUrl);
    } finally {
      userBProfile.cleanup();
    }

    let cleanup = await removeRealm({ realmUrl, profileManager });
    expect(cleanup.removed).toBe(true);
  });

  it('returns an error when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await removeRealm({
      realmUrl: `${TEST_REALM_SERVER_URL}/anything/`,
      profileManager: emptyManager,
    });
    expect(result.removed).toBe(false);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
