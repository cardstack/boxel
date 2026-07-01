import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRealm } from '../../src/commands/realm/create.ts';
import { archiveRealm } from '../../src/commands/realm/archive.ts';
import { listRealms } from '../../src/commands/realm/list.ts';
import type { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration.ts';

let profileManager: ProfileManager;
let cleanupProfile: () => void;

beforeAll(async () => {
  await startTestRealmServer();
  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm list with archived realms (integration)', () => {
  it('hides archived realms by default', async () => {
    let name = uniqueRealmName();
    let { realmUrl } = await createRealm(name, `Test ${name}`, {
      profileManager,
    });

    let beforeArchive = await listRealms({ profileManager });
    expect(beforeArchive.error).toBeUndefined();
    expect(beforeArchive.realms.map((r) => r.url)).toContain(realmUrl);

    let archive = await archiveRealm({ realmUrl, profileManager });
    expect(archive.archived).toBe(true);

    let afterArchive = await listRealms({ profileManager });
    expect(afterArchive.error).toBeUndefined();
    expect(afterArchive.realms.map((r) => r.url)).not.toContain(realmUrl);

    let allAccessible = await listRealms({
      allAccessible: true,
      profileManager,
    });
    expect(allAccessible.error).toBeUndefined();
    expect(allAccessible.realms.map((r) => r.url)).not.toContain(realmUrl);
  });

  it('--include-archived surfaces archived realms with an archived marker', async () => {
    let name = uniqueRealmName();
    let { realmUrl } = await createRealm(name, `Test ${name}`, {
      profileManager,
    });
    await archiveRealm({ realmUrl, profileManager });

    let result = await listRealms({
      includeArchived: true,
      profileManager,
    });

    expect(result.error).toBeUndefined();
    let entry = result.realms.find((r) => r.url === realmUrl);
    expect(entry).toBeDefined();
    expect(entry?.archived).toBe(true);
  });

  it('lists multiple archived realms together when --include-archived is set', async () => {
    let nameA = uniqueRealmName();
    let nameB = uniqueRealmName();
    let { realmUrl: urlA } = await createRealm(nameA, `Test ${nameA}`, {
      profileManager,
    });
    let { realmUrl: urlB } = await createRealm(nameB, `Test ${nameB}`, {
      profileManager,
    });
    await archiveRealm({ realmUrl: urlA, profileManager });
    await archiveRealm({ realmUrl: urlB, profileManager });

    let result = await listRealms({
      includeArchived: true,
      profileManager,
    });

    expect(result.error).toBeUndefined();
    let archivedUrls = result.realms
      .filter((r) => r.archived)
      .map((r) => r.url);
    expect(archivedUrls).toEqual(expect.arrayContaining([urlA, urlB]));
  });
});
