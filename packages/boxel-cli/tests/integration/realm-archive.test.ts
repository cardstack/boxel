import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRealm } from '../../src/commands/realm/create.ts';
import { archiveRealm } from '../../src/commands/realm/archive.ts';
import { restoreRealm } from '../../src/commands/realm/restore.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
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
} from '../helpers/integration.ts';

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

describe('realm archive (integration)', () => {
  it('archives a realm for the owner', async () => {
    let name = uniqueRealmName();
    let { realmUrl } = await createRealm(name, `Test ${name}`, {
      profileManager,
    });

    let result = await archiveRealm({ realmUrl, profileManager });

    expect(result.error).toBeUndefined();
    expect(result.archived).toBe(true);
    expect(result.realmUrl).toBe(realmUrl);
  });

  it('normalizes a trailing-slash-less input', async () => {
    let name = uniqueRealmName();
    let { realmUrl } = await createRealm(name, `Test ${name}`, {
      profileManager,
    });

    let withoutSlash = realmUrl.replace(/\/$/, '');
    let result = await archiveRealm({
      realmUrl: withoutSlash,
      profileManager,
    });

    expect(result.error).toBeUndefined();
    expect(result.archived).toBe(true);
    expect(result.realmUrl).toBe(realmUrl);
  });

  it('returns a 403 error when the caller does not own the realm', async () => {
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

      let result = await archiveRealm({
        realmUrl,
        profileManager: userBProfile.profileManager,
      });

      expect(result.archived).toBe(false);
      expect(result.error).toMatch(/403/);
      expect(result.error).toMatch(/do not own this realm/);
    } finally {
      userBProfile.cleanup();
    }
  });

  it('returns an error when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await archiveRealm({
      realmUrl: `${TEST_REALM_SERVER_URL}/anything/`,
      profileManager: emptyManager,
    });
    expect(result.archived).toBe(false);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe('realm restore (integration)', () => {
  it('restores a previously archived realm for the owner', async () => {
    let name = uniqueRealmName();
    let { realmUrl } = await createRealm(name, `Test ${name}`, {
      profileManager,
    });
    let archive = await archiveRealm({ realmUrl, profileManager });
    expect(archive.archived).toBe(true);

    let result = await restoreRealm({ realmUrl, profileManager });

    expect(result.error).toBeUndefined();
    expect(result.restored).toBe(true);
    expect(result.realmUrl).toBe(realmUrl);
  });

  it('returns a 403 error when the caller does not own the realm', async () => {
    let realmName = uniqueRealmName();
    let { realmUrl } = await createRealm(realmName, `Test ${realmName}`, {
      profileManager,
    });
    await archiveRealm({ realmUrl, profileManager });

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

      let result = await restoreRealm({
        realmUrl,
        profileManager: userBProfile.profileManager,
      });

      expect(result.restored).toBe(false);
      expect(result.error).toMatch(/403/);
      expect(result.error).toMatch(/do not own this realm/);
    } finally {
      userBProfile.cleanup();
    }

    // Cleanup: restore the realm so it doesn't leak into other tests.
    await restoreRealm({ realmUrl, profileManager });
  });

  it('returns an error when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await restoreRealm({
      realmUrl: `${TEST_REALM_SERVER_URL}/anything/`,
      profileManager: emptyManager,
    });
    expect(result.restored).toBe(false);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
