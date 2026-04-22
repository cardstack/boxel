import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { write } from '../../src/commands/file/write';
import { createRealm } from '../../src/commands/realm/create';
import { ProfileManager } from '../../src/lib/profile-manager';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration';

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

describe('file write (integration)', () => {
  it('writes a .gts file and can read it back from the realm', async () => {
    let source = 'export const hello = "world";';
    let writeResult = await write(realmUrl, 'roundtrip.gts', source, {
      profileManager,
    });
    expect(writeResult.ok).toBe(true);

    // Verify by reading back via the realm
    let response = await profileManager.authedRealmFetch(
      `${realmUrl}roundtrip.gts`,
      { method: 'GET', headers: { Accept: 'application/vnd.card+source' } },
    );
    expect(response.ok).toBe(true);
    let content = await response.text();
    expect(content).toContain('hello');
  });

  it('writes a .json card and can read it back', async () => {
    let card = JSON.stringify({
      data: {
        type: 'card',
        attributes: { title: 'Written Card' },
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/card-api',
            name: 'CardDef',
          },
        },
      },
    });
    let writeResult = await write(realmUrl, 'WrittenCard/1.json', card, {
      profileManager,
    });
    expect(writeResult.ok).toBe(true);

    let response = await profileManager.authedRealmFetch(
      `${realmUrl}WrittenCard/1.json`,
      { method: 'GET', headers: { Accept: 'application/vnd.card+source' } },
    );
    expect(response.ok).toBe(true);
    let doc = await response.json();
    expect((doc as any).data.attributes.title).toBe('Written Card');
  });

  it('returns error result when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    let result = await write(realmUrl, 'test.gts', 'content', {
      profileManager: emptyManager,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No active profile');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
