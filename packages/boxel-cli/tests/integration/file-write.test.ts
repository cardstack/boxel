import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { write } from '../../src/commands/file/write';
import { createRealm } from '../../src/commands/realm/create';
import { ProfileManager } from '../../src/lib/profile-manager';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration';

let profileManager: ProfileManager;
let cleanupProfile: () => void;
let realmUrl: string;

async function createTestRealm(): Promise<string> {
  let name = uniqueRealmName();
  await createRealm(name, `Test ${name}`, { profileManager });

  let realmTokens =
    profileManager.getActiveProfile()!.profile.realmTokens ?? {};
  let entry = Object.entries(realmTokens).find(([url]) => url.includes(name));
  if (!entry) {
    throw new Error(`No realm JWT stored for ${name}`);
  }
  return entry[0];
}

beforeAll(async () => {
  await startTestRealmServer();

  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);

  realmUrl = await createTestRealm();
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('file write (integration)', () => {
  it('writes a file to the realm successfully', async () => {
    let result = await write(realmUrl, 'test-file.gts', 'export default class {}', {
      profileManager,
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('sends correct HTTP method and headers', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    try {
      await write(realmUrl, 'hello.gts', 'let x = 1;', {
        profileManager,
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      let [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain('hello.gts');
      expect(init!.method).toBe('POST');
      let headers = init!.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/vnd.card+source');
      expect(headers['Accept']).toBe('application/vnd.card+source');
      expect(init!.body).toBe('let x = 1;');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('reads content from a local file via --file option pattern', async () => {
    let tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-file-write-'));
    let tmpFile = path.join(tmpDir, 'source.gts');
    fs.writeFileSync(tmpFile, 'export const greeting = "hello";', 'utf-8');

    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    try {
      let content = fs.readFileSync(tmpFile, 'utf-8');
      let result = await write(realmUrl, 'greeting.gts', content, {
        profileManager,
      });

      expect(result.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledOnce();
      let [, init] = fetchSpy.mock.calls[0];
      expect(init!.body).toBe('export const greeting = "hello";');
    } finally {
      fetchSpy.mockRestore();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    await expect(
      write(realmUrl, 'test.gts', 'content', {
        profileManager: emptyManager,
      }),
    ).rejects.toThrow('No active profile');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('returns error on non-2xx HTTP response', async () => {
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmFetch')
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    try {
      let result = await write(realmUrl, 'missing.gts', 'content', {
        profileManager,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('404');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns error when fetch throws (network error)', async () => {
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmFetch')
      .mockRejectedValueOnce(new Error('network failure'));
    try {
      let result = await write(realmUrl, 'test.gts', 'content', {
        profileManager,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('network failure');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
