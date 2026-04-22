import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listFiles } from '../../src/commands/file/list';
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
      'hello.gts': 'export default class {}',
      'world.json': '{"data": {}}',
      'nested/deep.gts': 'export default class {}',
    },
  });

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

describe('file list (integration)', () => {
  it('returns sorted filenames from the realm', async () => {
    let result = await listFiles(realmUrl, { profileManager });

    expect(result.error).toBeUndefined();
    expect(result.filenames).toContain('hello.gts');
    expect(result.filenames).toContain('world.json');
    expect(result.filenames).toContain('nested/deep.gts');
    // Verify sorted order
    let sorted = [...result.filenames].sort();
    expect(result.filenames).toEqual(sorted);
  });

  it('returns JSON-serialisable output (--json mode)', async () => {
    let result = await listFiles(realmUrl, { profileManager });

    let json = JSON.parse(JSON.stringify(result));
    expect(json.filenames).toBeInstanceOf(Array);
    expect(json.filenames.length).toBeGreaterThan(0);
    expect(json.error).toBeUndefined();
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    await expect(
      listFiles(realmUrl, { profileManager: emptyManager }),
    ).rejects.toThrow('No active profile');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('returns error when fetch throws', async () => {
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmFetch')
      .mockRejectedValueOnce(new Error('network failure'));
    try {
      let result = await listFiles(realmUrl, { profileManager });
      expect(result.filenames).toEqual([]);
      expect(result.error).toContain('network failure');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('uses authedRealmFetch with Accept: application/vnd.api+json', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    try {
      await listFiles(realmUrl, { profileManager });

      expect(fetchSpy).toHaveBeenCalledOnce();
      let [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toContain('_mtimes');
      expect(init!.method).toBe('GET');
      let headers = init!.headers as Record<string, string>;
      expect(headers['Accept']).toBe('application/vnd.api+json');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
