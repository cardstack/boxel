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
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel file list --realm <url> --json` prints `{ filenames, error? }` on
// stdout. We drive the installed binary and parse its JSON payload.

interface ListJson {
  filenames: string[];
  error?: string;
}

let home: string;
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

  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('file list (integration)', () => {
  it('returns sorted filenames including seeded files', async () => {
    let res = await runBoxel(['file', 'list', '--realm', realmUrl, '--json'], {
      home,
    });
    expect(res.ok, res.stderr).toBe(true);

    let result = res.json<ListJson>();
    expect(result.error).toBeUndefined();
    expect(result.filenames).toContain('hello.gts');
    expect(result.filenames).toContain('world.json');
    expect(result.filenames).toContain('nested/deep.gts');
    let sorted = [...result.filenames].sort();
    expect(result.filenames).toEqual(sorted);
  });

  it('returns error for an unreachable realm', async () => {
    let res = await runBoxel(
      ['file', 'list', '--realm', 'http://127.0.0.1:1/', '--json'],
      { home },
    );
    expect(res.exitCode).toBe(1);

    let result = res.json<ListJson>();
    expect(result.filenames).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it('returns error result when no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    new ProfileManager(path.join(emptyHome, '.boxel-cli'));
    try {
      let res = await runBoxel(
        ['file', 'list', '--realm', realmUrl, '--json'],
        { home: emptyHome },
      );
      expect(res.exitCode).toBe(1);

      let result = res.json<ListJson>();
      expect(result.filenames).toEqual([]);
      expect(result.error).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
