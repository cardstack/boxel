import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCard } from '../../src/commands/card/read';
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

const SOURCE_JSON = JSON.stringify(
  {
    data: {
      attributes: { cardTitle: 'Card Read Test' },
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
      'card-read-test.json': SOURCE_JSON,
    },
    useCardPrerenderer: true,
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

describe('card read (integration)', () => {
  it('reads a .json card and returns parsed document', async () => {
    let result = await readCard(realmUrl, 'card-read-test.json', {
      profileManager,
    });
    console.log('Read card result:', JSON.stringify(result, null, 2));
    console.log(result);

    expect(result.ok, `readCard failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.status).toBe(200);
    expect(result.document).toBeTruthy();
    expect(result.document).toHaveProperty('data');

    let data = result.document!.data as Record<string, unknown>;
    expect(data.attributes).toHaveProperty('cardTitle', 'Card Read Test');
  });

  it('returns a not-ok result with 404 status for a nonexistent card', async () => {
    let result = await readCard(realmUrl, 'does-not-exist.json', {
      profileManager,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain('404');
  });

  it('returns error result when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    let result = await readCard(realmUrl, 'card-read-test.json', {
      profileManager: emptyManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active profile');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
