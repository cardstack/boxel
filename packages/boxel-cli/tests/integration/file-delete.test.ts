import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deleteFile } from '../../src/commands/file/delete';
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
    fileSystem: {
      'to-delete.json': JSON.stringify({
        data: { type: 'card', attributes: { title: 'Delete Me' }, meta: { adoptsFrom: { module: 'https://cardstack.com/base/card-api', name: 'CardDef' } } },
      }),
    },
  });
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);
});

afterAll(async () => { cleanupProfile?.(); await stopTestRealmServer(); });

describe('file delete (integration)', () => {
  it('sends DELETE request with correct method', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    try {
      await deleteFile(realmUrl, 'to-delete.json', { profileManager });
      expect(fetchSpy).toHaveBeenCalledOnce();
      let [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('to-delete.json');
      expect(init!.method).toBe('DELETE');
    } finally { fetchSpy.mockRestore(); }
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    await expect(deleteFile(realmUrl, 'to-delete.json', { profileManager: emptyManager })).rejects.toThrow('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('returns error when fetch throws', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch').mockRejectedValueOnce(new Error('network failure'));
    try {
      let result = await deleteFile(realmUrl, 'to-delete.json', { profileManager });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('network failure');
    } finally { fetchSpy.mockRestore(); }
  });

  it('returns error on non-2xx response', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch').mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    try {
      let result = await deleteFile(realmUrl, 'nonexistent.json', { profileManager });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('404');
    } finally { fetchSpy.mockRestore(); }
  });
});
