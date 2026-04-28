import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listRealms } from '../../src/commands/realm/list';
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
  await startTestRealmServer();
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

describe('realm list (integration)', () => {
  it('returns the test realm in --all-accessible mode', async () => {
    let result = await listRealms({
      allAccessible: true,
      profileManager,
    });
    expect(result.error).toBeUndefined();
    let urls = result.realms.map((r) => r.url);
    expect(urls).toContain(realmUrl);
  });

  it('marks the realm as hidden when not in the user UI realm list', async () => {
    let result = await listRealms({
      allAccessible: true,
      profileManager,
    });
    let entry = result.realms.find((r) => r.url === realmUrl);
    expect(entry).toBeDefined();
    expect(entry!.hidden).toBe(true);
  });

  it('--hidden filters to hidden-only realms', async () => {
    let result = await listRealms({ hidden: true, profileManager });
    expect(result.error).toBeUndefined();
    expect(result.realms.length).toBeGreaterThan(0);
    expect(result.realms.every((r) => r.hidden)).toBe(true);
    expect(result.realms.map((r) => r.url)).toContain(realmUrl);
  });

  it('default mode excludes hidden realms', async () => {
    let result = await listRealms({ profileManager });
    expect(result.error).toBeUndefined();
    expect(result.realms.every((r) => !r.hidden)).toBe(true);
    expect(result.realms.map((r) => r.url)).not.toContain(realmUrl);
  });

  it('default mode includes the realm after addToUserRealms', async () => {
    await profileManager.addToUserRealms(realmUrl);
    let result = await listRealms({ profileManager });
    expect(result.error).toBeUndefined();
    let entry = result.realms.find((r) => r.url === realmUrl);
    expect(entry).toBeDefined();
    expect(entry!.hidden).toBe(false);
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
