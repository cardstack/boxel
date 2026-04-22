import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { search } from '../../src/commands/file/search';
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

describe('file search (integration)', () => {
  it('sends QUERY to _search with correct headers', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    try {
      await search(realmUrl, { filter: { type: { name: 'CardDef' } } }, { profileManager });
      expect(fetchSpy).toHaveBeenCalledOnce();
      let [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('_search');
      expect(init!.method).toBe('QUERY');
      let headers = init!.headers as Record<string, string>;
      expect(headers['Accept']).toBe('application/vnd.card+json');
      expect(headers['Content-Type']).toBe('application/json');
    } finally { fetchSpy.mockRestore(); }
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    await expect(search(realmUrl, {}, { profileManager: emptyManager })).rejects.toThrow('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('returns error when fetch throws', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch').mockRejectedValueOnce(new Error('network failure'));
    try {
      let result = await search(realmUrl, {}, { profileManager });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('network failure');
    } finally { fetchSpy.mockRestore(); }
  });

  it('returns error on non-2xx response', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch').mockResolvedValueOnce(new Response('Server Error', { status: 500 }));
    try {
      let result = await search(realmUrl, {}, { profileManager });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('500');
    } finally { fetchSpy.mockRestore(); }
  });
});
