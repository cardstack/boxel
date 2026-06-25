import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { deleteFile } from '../../src/commands/file/delete.ts';
import { BoxelCLIClient } from '../../src/lib/boxel-cli-client.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';

let profileManager: ProfileManager;
let client: BoxelCLIClient;
let cleanupProfile: () => void;
let realmUrl: string;

beforeAll(async () => {
  await startTestRealmServer({
    fileSystem: {
      'keep-this.json': JSON.stringify({
        data: {
          type: 'card',
          attributes: { title: 'Keep' },
          meta: {
            adoptsFrom: {
              module: '@cardstack/base/card-api',
              name: 'CardDef',
            },
          },
        },
      }),
      'delete-me.json': JSON.stringify({
        data: {
          type: 'card',
          attributes: { title: 'Delete' },
          meta: {
            adoptsFrom: {
              module: '@cardstack/base/card-api',
              name: 'CardDef',
            },
          },
        },
      }),
    },
  });
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);
  client = new BoxelCLIClient(profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('file delete (integration)', () => {
  it('deletes a file and confirms it no longer exists via read', async () => {
    // Verify the file exists first
    let before = await client.read(realmUrl, 'delete-me.json');
    expect(before.ok, 'file should exist before delete').toBe(true);

    // Delete it
    let result = await deleteFile(realmUrl, 'delete-me.json', {
      profileManager,
    });
    expect(result.ok).toBe(true);

    // Verify it's gone
    let after = await client.read(realmUrl, 'delete-me.json');
    expect(after.ok).toBe(false);
    expect(after.status).toBe(404);
  });

  it('other files remain after deleting one', async () => {
    let result = await client.read(realmUrl, 'keep-this.json');
    expect(result.ok, 'unrelated file should still exist').toBe(true);
  });

  it('returns error result when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    let result = await deleteFile(realmUrl, 'keep-this.json', {
      profileManager: emptyManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
