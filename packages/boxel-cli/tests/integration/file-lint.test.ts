import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lint } from '../../src/commands/file/lint';
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

describe('file lint (integration)', () => {
  it('sends POST to _lint with correct headers and body', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    try {
      await lint(realmUrl, 'let x = 1;', 'test.gts', { profileManager });
      expect(fetchSpy).toHaveBeenCalledOnce();
      let [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('_lint');
      expect(init!.method).toBe('POST');
      let headers = init!.headers as Record<string, string>;
      expect(headers['X-Filename']).toBe('test.gts');
      expect(headers['X-HTTP-Method-Override']).toBe('QUERY');
      expect(headers['Content-Type']).toBe('application/vnd.card+source');
      expect(init!.body).toBe('let x = 1;');
    } finally { fetchSpy.mockRestore(); }
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    await expect(lint(realmUrl, 'let x = 1;', 'test.gts', { profileManager: emptyManager })).rejects.toThrow('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('throws on non-2xx response', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch').mockResolvedValueOnce(new Response('Server Error', { status: 500 }));
    try {
      await expect(lint(realmUrl, 'let x = 1;', 'test.gts', { profileManager })).rejects.toThrow('500');
    } finally { fetchSpy.mockRestore(); }
  });

  it('throws when fetch fails', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch').mockRejectedValueOnce(new Error('network failure'));
    try {
      await expect(lint(realmUrl, 'let x = 1;', 'test.gts', { profileManager })).rejects.toThrow('network failure');
    } finally { fetchSpy.mockRestore(); }
  });
});
