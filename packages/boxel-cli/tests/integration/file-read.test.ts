import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { read } from '../../src/commands/file/read.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { TINY_PNG_BYTES } from '../helpers/binary-fixtures.ts';

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
          module: '@cardstack/base/card-api',
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
  it('reads a .json file and returns raw text content', async () => {
    let result = await read(realmUrl, 'test-card.json', { profileManager });

    expect(result.ok, `read failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.status).toBe(200);
    expect(result.content).toBeTruthy();
    expect(typeof result.content).toBe('string');
    // Caller can parse JSON themselves
    let parsed = JSON.parse(result.content!);
    expect(parsed).toHaveProperty('data');
  });

  it('reads a .gts file and returns raw text content', async () => {
    let result = await read(realmUrl, 'file-read-check.gts', {
      profileManager,
    });

    expect(result.ok, `read failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.status).toBe(200);
    expect(result.content).toBeTruthy();
    expect(result.content!.length).toBeGreaterThan(0);
  });

  it('reads a file via a non-URL @cardstack/ realm identifier', async () => {
    // `@cardstack/<realm>/` resolves against the active profile's
    // realm-server URL, so `@cardstack/test/` names the test realm.
    let result = await read('@cardstack/test/', 'test-card.json', {
      profileManager,
    });

    expect(result.ok, `read failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.status).toBe(200);
    let parsed = JSON.parse(result.content!);
    expect(parsed).toHaveProperty('data');
  });

  it('returns a not-ok result for an unsupported realm identifier scope', async () => {
    let result = await read('@unknown-scope/test/', 'test-card.json', {
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('only @cardstack/<realm>/');
  });

  it('returns a not-ok result with 404 status for a nonexistent file', async () => {
    let result = await read(realmUrl, 'does-not-exist.json', {
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain('404');
  });

  it('reads a binary PNG byte-identically (returns bytes, not content)', async () => {
    // Seed via direct octet-stream POST — startTestRealmServer's
    // fileSystem option only accepts strings.
    let pngUrl = `${realmUrl}image.png`;
    let seed = await profileManager.authedRealmFetch(pngUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: TINY_PNG_BYTES,
    });
    expect(seed.ok, `seed POST failed: ${seed.status}`).toBe(true);

    let result = await read(realmUrl, 'image.png', { profileManager });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.content).toBeUndefined();
    expect(result.bytes).toBeDefined();
    expect(Buffer.from(result.bytes!).equals(Buffer.from(TINY_PNG_BYTES))).toBe(
      true,
    );
  });

  it('returns error result when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    let result = await read(realmUrl, 'test-card.json', {
      profileManager: emptyManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active profile');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
