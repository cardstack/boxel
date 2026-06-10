import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { waitForReady } from '../../src/commands/realm/wait-for-ready.ts';
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

describe('realm wait-for-ready (integration)', () => {
  it('returns ready for a running realm', async () => {
    let result = await waitForReady(realmUrl, {
      timeoutMs: 5000,
      profileManager,
    });
    expect(result.ready).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns not ready when realm URL is unreachable', async () => {
    let result = await waitForReady('http://127.0.0.1:1/fake/', {
      timeoutMs: 500,
      profileManager,
    });
    expect(result.ready).toBe(false);
    expect(result.error).toContain('not ready after');
  });

  it('returns an error when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await waitForReady(realmUrl, { profileManager: emptyManager });
    expect(result.ready).toBe(false);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
