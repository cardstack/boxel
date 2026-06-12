import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listFiles } from '../../src/commands/file/list.ts';
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
  it('returns sorted filenames including seeded files', async () => {
    let result = await listFiles(realmUrl, { profileManager });

    expect(result.error).toBeUndefined();
    expect(result.filenames).toContain('hello.gts');
    expect(result.filenames).toContain('world.json');
    expect(result.filenames).toContain('nested/deep.gts');
    let sorted = [...result.filenames].sort();
    expect(result.filenames).toEqual(sorted);
  });

  it('returns error for an unreachable realm', async () => {
    let result = await listFiles('http://127.0.0.1:1/', { profileManager });
    expect(result.filenames).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it('returns error result when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    let result = await listFiles(realmUrl, { profileManager: emptyManager });
    expect(result.filenames).toEqual([]);
    expect(result.error).toContain('No active profile');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
