import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cancelIndexing } from '../../src/commands/realm/cancel-indexing.ts';
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

  it('POSTs `{ cancelPending: false }` by default (running-only)', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    try {
      await cancelIndexing(realmUrl, { profileManager });

      expect(fetchSpy).toHaveBeenCalledOnce();
      let [url, init] = fetchSpy.mock.calls[0];
      expect(String(url)).toBe(`${realmUrl}_cancel-indexing-job`);
      expect(init!.method).toBe('POST');
      let headers = init!.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Accept']).toBe('application/json');
      expect(JSON.parse(init!.body as string)).toEqual({
        cancelPending: false,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('POSTs `{ cancelPending: true }` when cancelPending option is set', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    try {
      await cancelIndexing(realmUrl, {
        profileManager,
        cancelPending: true,
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      let [, init] = fetchSpy.mock.calls[0];
      expect(JSON.parse(init!.body as string)).toEqual({ cancelPending: true });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns an error with HTTP status when the realm responds non-2xx', async () => {
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmFetch')
      .mockResolvedValueOnce(
        new Response('forbidden', {
          status: 403,
          statusText: 'Forbidden',
        }),
      );
    try {
      let result = await cancelIndexing(realmUrl, { profileManager });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('HTTP 403');
      expect(result.error).toContain('forbidden');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns error result when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await cancelIndexing(realmUrl, {
      profileManager: emptyManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
