import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRealm } from '../../src/commands/realm/create.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration.ts';
import type { ProfileManager } from '../../src/lib/profile-manager.ts';

let profileManager: ProfileManager;
let cleanup: () => void;

beforeAll(async () => {
  await startTestRealmServer();

  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanup = testProfile.cleanup;
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  cleanup?.();
  await stopTestRealmServer();
});

describe('realm create (integration)', () => {
  it('creates a realm and stores the JWT in the profile', async () => {
    let realmName = uniqueRealmName();

    await createRealm(realmName, `Test ${realmName}`, { profileManager });

    let active = profileManager.getActiveProfile()!;
    let realmTokens = active.profile.realmTokens ?? {};
    let storedToken = Object.entries(realmTokens).find(([url]) =>
      url.includes(realmName),
    )?.[1];

    expect(storedToken).toBeDefined();
    expect(storedToken!.length).toBeGreaterThan(0);
    expect(profileManager.getRealmServerToken()).toBeDefined();
  });

  it('creates another realm reusing the cached server token', async () => {
    let cachedToken = profileManager.getRealmServerToken();
    expect(cachedToken).toBeDefined();

    let realmName = uniqueRealmName();

    await createRealm(realmName, `Test ${realmName}`, { profileManager });

    // Server token was reused, not re-fetched
    expect(profileManager.getRealmServerToken()).toBe(cachedToken);

    let active = profileManager.getActiveProfile()!;
    let realmTokens = active.profile.realmTokens ?? {};
    let storedToken = Object.entries(realmTokens).find(([url]) =>
      url.includes(realmName),
    )?.[1];
    expect(storedToken).toBeDefined();
  });
});
