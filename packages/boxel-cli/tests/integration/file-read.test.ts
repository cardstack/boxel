import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { read } from '../../src/commands/file/read';
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

const SOURCE_GTS = `import {
  CardDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class FileReadCheck extends CardDef {
  static displayName = 'File Read Check';
  @field label = contains(StringField);
}
`;

const SOURCE_JSON = JSON.stringify(
  {
    data: {
      type: 'card',
      attributes: { title: 'Test Card' },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/card-api',
          name: 'CardDef',
        },
      },
    },
  },
  null,
  2,
);

beforeAll(async () => {
  await startTestRealmServer({
    fileSystem: {
      'file-read-check.gts': SOURCE_GTS,
      'test-card.json': SOURCE_JSON,
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

describe('file read (integration)', () => {
  it('reads a .json file and returns parsed document', async () => {
    let result = await read(realmUrl, 'test-card.json', { profileManager });

    expect(result.ok, `read failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.status).toBe(200);
    expect(result.document).toBeTruthy();
    expect(result.document).toHaveProperty('data');
    expect(result.content).toBeUndefined();
  });

  it('reads a .gts file and returns raw text content', async () => {
    let result = await read(realmUrl, 'file-read-check.gts', {
      profileManager,
    });

    expect(result.ok, `read failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.status).toBe(200);
    expect(result.content).toBeTruthy();
    expect(result.content!.length).toBeGreaterThan(0);
    expect(result.document).toBeUndefined();
  });

  it('returns a not-ok result with 404 status for a nonexistent file', async () => {
    let result = await read(realmUrl, 'does-not-exist.json', {
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain('404');
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    await expect(
      read(realmUrl, 'test-card.json', { profileManager: emptyManager }),
    ).rejects.toThrow('No active profile');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
