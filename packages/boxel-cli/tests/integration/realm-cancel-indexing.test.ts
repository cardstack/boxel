import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cancelIndexing } from '../../src/commands/realm/cancel-indexing';
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

describe('realm cancel-indexing (integration)', () => {
  it('cancels indexing on a running realm and returns ok', async () => {
    let result = await cancelIndexing(realmUrl, { profileManager });
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns error for an unreachable realm', async () => {
    let result = await cancelIndexing('http://127.0.0.1:1/fake/', {
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    await expect(
      cancelIndexing(realmUrl, { profileManager: emptyManager }),
    ).rejects.toThrow('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
