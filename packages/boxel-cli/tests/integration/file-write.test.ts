import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { write } from '../../src/commands/file/write.ts';
import { createRealm } from '../../src/commands/realm/create.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration.ts';
import { TINY_PNG_BYTES, TINY_PDF_BYTES } from '../helpers/binary-fixtures.ts';

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
            module: '@cardstack/base/card-api',
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

  it('writes a PNG byte-identically and reads it back', async () => {
    let writeResult = await write(realmUrl, 'image.png', TINY_PNG_BYTES, {
      profileManager,
    });
    expect(writeResult.ok, `write failed: ${writeResult.error}`).toBe(true);

    let response = await profileManager.authedRealmFetch(
      `${realmUrl}image.png`,
      { method: 'GET', headers: { Accept: 'application/vnd.card+source' } },
    );
    expect(response.ok).toBe(true);
    let remote = Buffer.from(await response.arrayBuffer());
    expect(remote.equals(Buffer.from(TINY_PNG_BYTES))).toBe(true);
  });

  it('writes a PDF byte-identically', async () => {
    let writeResult = await write(realmUrl, 'doc.pdf', TINY_PDF_BYTES, {
      profileManager,
    });
    expect(writeResult.ok).toBe(true);

    let response = await profileManager.authedRealmFetch(`${realmUrl}doc.pdf`, {
      method: 'GET',
      headers: { Accept: 'application/vnd.card+source' },
    });
    let remote = Buffer.from(await response.arrayBuffer());
    expect(remote.equals(Buffer.from(TINY_PDF_BYTES))).toBe(true);
  });

  it('returns error result when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    try {
      let result = await write(realmUrl, 'test.gts', 'content', {
        profileManager: emptyManager,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No active profile');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
