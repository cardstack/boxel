import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCommand } from '../../src/commands/run-command.ts';
import { createRealm } from '../../src/commands/realm/create.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration.ts';

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

describe('run-command (integration)', () => {
  it('executes a command and returns a ready result', async () => {
    let result = await runCommand(
      '@cardstack/boxel-host/commands/get-card-type-schema/default',
      realmUrl,
      { profileManager },
    );

    expect(result.status).toBe('ready');
  });

  it('sends correct JSON:API request shape', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmServerFetch');
    try {
      await runCommand(
        '@cardstack/boxel-host/commands/get-card-type-schema/default',
        realmUrl,
        {
          input: { cardURL: `${realmUrl}MyCard` },
          profileManager,
        },
      );

      expect(fetchSpy).toHaveBeenCalledOnce();
      let [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain('/_run-command');
      expect(init!.method).toBe('POST');
      let headers = init!.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/vnd.api+json');
      expect(headers['Accept']).toBe('application/vnd.api+json');

      let body = JSON.parse(init!.body as string);
      expect(body).toEqual({
        data: {
          type: 'run-command',
          attributes: {
            realmURL: realmUrl,
            command:
              '@cardstack/boxel-host/commands/get-card-type-schema/default',
            commandInput: { cardURL: `${realmUrl}MyCard` },
          },
        },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('sends null commandInput when no input provided', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmServerFetch');
    try {
      await runCommand(
        '@cardstack/boxel-host/commands/get-card-type-schema/default',
        realmUrl,
        { profileManager },
      );

      let body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.data.attributes.commandInput).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    await expect(
      runCommand(
        '@cardstack/boxel-host/commands/get-card-type-schema/default',
        realmUrl,
        { profileManager: emptyManager },
      ),
    ).rejects.toThrow('No active profile');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('returns error status on non-2xx HTTP response', async () => {
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmServerFetch')
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    try {
      let result = await runCommand('some/command', realmUrl, {
        profileManager,
      });
      expect(result.status).toBe('error');
      expect(result.error).toContain('404');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns error status when response body is not valid JSON', async () => {
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmServerFetch')
      .mockResolvedValueOnce(new Response('not json', { status: 200 }));
    try {
      let result = await runCommand('some/command', realmUrl, {
        profileManager,
      });
      expect(result.status).toBe('error');
      expect(result.error).toContain('not valid JSON');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns error status when fetch throws', async () => {
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmServerFetch')
      .mockRejectedValueOnce(new Error('network failure'));
    try {
      let result = await runCommand('some/command', realmUrl, {
        profileManager,
      });
      expect(result.status).toBe('error');
      expect(result.error).toContain('network failure');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('strips trailing slash from realm server URL before appending endpoint', async () => {
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmServerFetch');
    try {
      await runCommand(
        '@cardstack/boxel-host/commands/get-card-type-schema/default',
        realmUrl,
        { profileManager },
      );

      let [url] = fetchSpy.mock.calls[0];
      expect(url).toContain('/_run-command');
      expect(url).not.toContain('//_run-command');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
