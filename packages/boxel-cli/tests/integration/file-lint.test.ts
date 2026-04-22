import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lint } from '../../src/commands/file/lint';
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

describe('file lint (integration)', () => {
  it('lints source via the realm _lint endpoint and returns a result', async () => {
    let source = 'export const x = 1;\n';
    let result = await lint(realmUrl, source, 'test.gts', { profileManager });

    expect(result).toHaveProperty('messages');
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result).toHaveProperty('output');
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    await expect(
      lint(realmUrl, 'let x = 1;', 'test.gts', { profileManager: emptyManager }),
    ).rejects.toThrow('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
