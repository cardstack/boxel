import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  reloadProfile,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel file delete <path> --realm <url>` DELETEs a realm-relative path.
// We drive the installed binary and verify the effect by reading the file
// back from the realm in-process with the profile the CLI wrote to disk.

let home: string;
let cleanupProfile: () => void;
let realmUrl: string;

async function readBack(relPath: string): Promise<Response> {
  return reloadProfile(home).authedRealmFetch(`${realmUrl}${relPath}`, {
    method: 'GET',
    headers: { Accept: 'application/vnd.card+source' },
  });
}

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

  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('file delete (integration)', () => {
  it('deletes a file and confirms it no longer exists via read', async () => {
    // Verify the file exists first
    let before = await readBack('delete-me.json');
    expect(before.ok, 'file should exist before delete').toBe(true);

    // Delete it
    let res = await runBoxel(
      ['file', 'delete', 'delete-me.json', '--realm', realmUrl],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);

    // Verify it's gone
    let after = await readBack('delete-me.json');
    expect(after.ok).toBe(false);
    expect(after.status).toBe(404);
  });

  it('other files remain after deleting one', async () => {
    let result = await readBack('keep-this.json');
    expect(result.ok, 'unrelated file should still exist').toBe(true);
  });

  it('returns error result when no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    // Materialize an empty profile store so the CLI reaches the
    // no-active-profile guard rather than any first-run bootstrapping.
    new ProfileManager(path.join(emptyHome, '.boxel-cli'));
    try {
      let res = await runBoxel(
        ['file', 'delete', 'keep-this.json', '--realm', realmUrl],
        { home: emptyHome },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
