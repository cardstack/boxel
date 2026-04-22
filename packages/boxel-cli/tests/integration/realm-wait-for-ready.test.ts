import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { waitForReady } from '../../src/commands/realm/wait-for-ready';
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

afterAll(async () => { cleanupProfile?.(); await stopTestRealmServer(); });

describe('realm wait-for-ready (integration)', () => {
  it('polls _readiness-check endpoint', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    try {
      let result = await waitForReady(realmUrl, { timeoutMs: 5000, profileManager });
      expect(result.ready).toBe(true);
      expect(fetchSpy).toHaveBeenCalled();
      let [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('_readiness-check');
      expect(init!.method).toBe('GET');
    } finally { fetchSpy.mockRestore(); }
  });

  it('returns not ready on timeout', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch').mockResolvedValue(new Response('Not Ready', { status: 503 }));
    try {
      let result = await waitForReady(realmUrl, { timeoutMs: 100, profileManager });
      expect(result.ready).toBe(false);
      expect(result.error).toContain('not ready after');
    } finally { fetchSpy.mockRestore(); }
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    await expect(waitForReady(realmUrl, { profileManager: emptyManager })).rejects.toThrow('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
